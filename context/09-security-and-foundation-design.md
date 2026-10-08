# 09 — Security and Foundation Design

## 1. Executive Decision Summary

This document establishes the formal, frozen security and architectural foundation for the Anonymous Messaging Platform before database migration, cryptography implementation, or application coding begins.

The five primary foundation decisions are resolved as follows:

| Decision Area | Selected v1 Architecture | Core Justification |
| :--- | :--- | :--- |
| **1. E2EE Protocol & Key Lifecycle** | **Libsodium Sealed Boxes (`crypto_box_seal` / X25519 + XSalsa20-Poly1305)** with client-side IndexedDB key storage and user-held 256-bit recovery phrase. | Tailor-made for one-way anonymous dropboxes; battle-tested; sender cannot decrypt after sealing; recipient cannot identify sender; zero bespoke crypto. |
| **2. Organization Admission** | **Verified Google Hosted Domain Match (`hd` / email domain)** validated server-side against an `organizations.allowed_domains` database registry. | Minimal onboarding friction; automated tenant assignment; zero hardcoded organization names; natively multi-tenant ready. |
| **3. Message Read API Anonymity** | **Dual Defense: PostgreSQL Security Barrier View (`recipient_inbox_messages`) + Next.js Server Actions / Route Handlers** with direct `SELECT` revoked from base `messages` table. | Schema-level impossibility of returning `sender_id` to recipients; impervious to client-side GraphQL/PostgREST column injection. |
| **4. Abuse Reporting & Disclosure** | **Explicit Plaintext Disclosure with Informed Consent** stored in an isolated, moderator-only `reports` audit table. | Normal messages remain strictly E2EE; user explicitly consents to share abusive content with authorized human moderators; zero global backdoor keys. |
| **5. Message Deletion Semantics** | **Recipient-side soft delete (`deleted_by_recipient = true`) with a 30-day automated ciphertext purge**; account deletion purges recipient keys and recipient messages immediately. | Balances recipient privacy and clean inbox with short-window server abuse accountability and investigation timelines. |

---

## 2. E2EE Protocol Design

### 2.1 Comparative Analysis

The product invariant mandates a **one-way, non-conversational** messaging model. A sender composes an individual message to a recipient; there are no threads, sessions, replies, or chat histories.

Three candidate cryptographic approaches were evaluated:

| Criterion | Signal-Style Protocol (X3DH + Double Ratchet) | Hybrid Public Key Encryption (HPKE — RFC 9180) | Libsodium Sealed Box (`crypto_box_seal`) |
| :--- | :--- | :--- | :--- |
| **One-Way Model Fit** | **Poor**: Engineered for bidirectional asynchronous sessions and continuous ratcheting. | **Good**: Designed for one-shot public key encryption (Base mode). | **Excellent**: Purpose-built specifically for anonymous, one-way recipient-only sealed delivery. |
| **Sender Anonymity to Recipient** | **Complex**: Requires stripping identity pre-keys; sender authenticity is baked into X3DH. | **Native**: Base mode provides anonymous sender encapsulation. | **Native**: Ephemeral keypair is generated per message and discarded; recipient cannot identify sender. |
| **Cryptographic Primitives** | Curve25519, HMAC-SHA256, AES-256-CBC / AEAD. | DHKEM(X25519), HKDF-SHA256, ChaCha20-Poly1305 / AES-GCM. | Curve25519 (X25519 ECDH), BLAKE2b (KDF/nonce), XSalsa20-Poly1305 (AEAD). |
| **Key Management Complexity** | **Very High**: Identity keys, signed prekeys, one-time prekey pools, ratchet states. | **Moderate**: Single recipient public key; ephemeral key per message. | **Low**: Single recipient public key; ephemeral key generated and wiped in one function call. |
| **Replay & Tampering Defense** | Managed by session state and ratchet counters. | AEAD tag + AAD (Authenticated Associated Data). | AEAD Poly1305 authentication tag; server enforces non-replay via message UUIDs. |
| **Browser & TypeScript Maturity** | Libsignal-client is heavy, Rust-compiled, complex to bind in Next.js. | Standards exist (`@hpke/core`), but ecosystem tooling is evolving. | `libsodium-wrappers` is universally audited, mature, Wasm-backed with constant-time guarantees. |
| **Implementation Risk** | **Extreme**: Substantial risk of state desynchronization or prekey exhaustion. | **Low to Moderate**: Low protocol risk, moderate library integration surface. | **Minimal**: High-level, misuse-resistant API (`crypto_box_seal` / `crypto_box_seal_open`). |

### 2.2 Recommendation for v1: Libsodium Sealed Box

**Selected Construction**: Libsodium `crypto_box_seal` (Curve25519 + XSalsa20-Poly1305) via `libsodium-wrappers`.

#### Rationale:
1. **Misuse Resistance**: `crypto_box_seal` provides an atomic high-level API. The sender client cannot accidentally reuse nonces or mismanage ephemeral secrets.
2. **True Ephemeral Anonymity**: For each message, the client generates a random, single-use ephemeral Curve25519 keypair `(ephem_pk, ephem_sk)`. It computes a shared secret with the recipient's public key, encrypts the message with XSalsa20-Poly1305, and prepends `ephem_pk` to the ciphertext. As soon as the operation completes, `ephem_sk` is wiped from memory. The sender cannot decrypt what they just encrypted, and the recipient cannot deduce the sender from `ephem_pk`.
3. **Audited Security**: Libsodium has undergone extensive third-party security audits and has been trusted in production for over a decade.
4. **Why Signal is Rejected**: Signal's Double Ratchet and prekey lifecycle introduce massive stateful overhead that is completely counterproductive for independent one-way messages.
5. **Why Raw HPKE is Deferred**: While HPKE (RFC 9180) is an excellent standard, Libsodium's sealed box is functionally equivalent for this use case and offers superior, battle-tested library ergonomics in TypeScript/Wasm without risks of primitive misconfiguration.

### 2.3 Exact Cryptographic Primitives & Parameters

* **Key Agreement (KEM)**: X25519 (ECDH over Curve25519, 32-byte public keys).
* **Key Derivation (KDF)**: BLAKE2b keyed hashing over `(ephem_pk || recipient_pk)`.
* **Authenticated Encryption (AEAD)**: XSalsa20-Poly1305 (24-byte nonce, 16-byte Poly1305 MAC tag).
* **Wire Format**:
  $$\text{Ciphertext Payload} = \text{ephem\_pk (32 bytes)} \mathbin{\Vert} \text{ciphertext} \mathbin{\Vert} \text{mac (16 bytes)}$$
  Encoded in standard Base64 for database persistence and JSON transit.
* **Public Key Encoding**: 32-byte X25519 public key, Base64-encoded.
* **Failure Handling**: If decryption fails (corrupt ciphertext, tampered MAC, wrong private key), `crypto_box_seal_open` returns `false` or throws. The client UI displays a calm, generic error: *"This message could not be decrypted with your current key."* No cryptographic trace or raw error details are leaked to console logs or server telemetry.
* **Key Rotation**: When a user rotates their encryption key, a new row is inserted into `public_keys` with a new `key_id`. Previous public keys are marked inactive for new incoming messages. Existing messages continue to link to the specific `key_id` they were encrypted with.

---

## 3. Private Key Lifecycle

```text
[ Browser Client ]                                     [ Supabase Database ]
User Setup / Login
       ↓
Generate X25519 Keypair
  (CSPRNG / Libsodium)
       ├── Private Key (32 bytes) ──> IndexedDB (Never Leaves Browser)
       ├── Recovery Phrase ─────────> Displayed to User (One-Time Backup)
       └── Public Key (32 bytes) ───> POST /api/keys ────────> INSERT public_keys
```

### 3.1 Generation
* **Where**: Generated strictly in the user's browser client via WebAssembly/Web Crypto CSPRNG (`sodium.randombytes_buf` wrapping `crypto.getRandomValues`).
* **When**: During initial account setup after first Google OAuth sign-in, or when explicitly initiating a key rotation.
* **Entropy**: High-quality OS-level entropy sourced via the browser's cryptographic subsystem.

### 3.2 Storage
* **Browser Storage Mechanism**: Local **IndexedDB** using a dedicated, restricted database (`cih_keystore_v1`) and object store (`identity_keys`).
* **Why IndexedDB**: Unlike `localStorage` and `sessionStorage`, IndexedDB is not vulnerable to synchronous cross-site script reads in window properties, supports binary typed arrays (`Uint8Array`), and provides structured storage.
* **At-Rest Protection**: Keys are stored as raw binary buffers in IndexedDB. Private keys are never mirrored into `localStorage`, `sessionStorage`, cookies, state variables in global window scope, or browser caches.
* **Memory Management**: When private keys are loaded into browser RAM for decryption, they are held in scoped closures and explicitly zeroized (`sodium.memzero`) when the inbox view unmounts or after batch decryption completes.

### 3.3 Server Boundary
* **Sent to Supabase**:
  * `id` (`key_id` UUID)
  * `user_id` (foreign key to `auth.users`)
  * `public_key` (Base64 string)
  * `algorithm` (`"x25519-xsalsa20poly1305"`)
  * `is_active` (`boolean`)
  * `created_at` (`timestamptz`)
* **NEVER Sent to Supabase**:
  * Private keys / secret scalars
  * Seed entropy
  * Ephemeral sender secret keys
  * User recovery phrases / backup codes

### 3.4 Multi-Device Behavior & Device Changes
Because private keys reside in local browser storage, accessing the account from a new browser or device requires a deterministic key reconciliation strategy.

#### v1 Multi-Device Policy:
1. **Single Active Identity Key per Account**: Each account publishes one active `public_key` on the platform. All incoming messages for that user are sealed against that public key.
2. **Accessing from a New Device**:
   * **Path A (Restore via Recovery Phrase — Recommended)**: The user enters their 24-word or 32-byte Base64 Recovery Phrase on the new device. The client derives the identical Curve25519 private key, stores it in the new browser's IndexedDB, and the user can immediately read all past and future messages.
   * **Path B (Generate New Key / Replace)**: If the recovery phrase is unavailable, the user can choose *"Reset Encryption Key"*. This generates a fresh keypair, registers the new `public_key` as active in Supabase, and invalidates the old public key for future messages. **Tradeoff**: Historical messages encrypted to the lost key remain unreadable on the new device, but the user is unblocked from receiving new messages.

### 3.5 Recovery Strategy
* **Evaluated Options**:
  * *No recovery (device-only)*: High risk of permanent data loss if browser storage is cleared.
  * *Passphrase-encrypted server backup*: Requires zero-knowledge remote key escrow, complex client-side KDFs (Argon2id), and risks user lockouts if passphrases are forgotten.
  * *Supabase Auth password reset*: **Prohibited**. Supabase has no knowledge of private keys; auth recovery cannot recover E2EE data.
  * *Recovery Phrase / Secret Key Backup*: The standard, user-sovereign pattern used in privacy systems (Signal, Proton, Matrix).
* **Selected v1 Strategy**: **User Recovery Phrase**.
  * At onboarding, the client displays a 256-bit recovery code (or 24-word mnemonic) derived from the root private key seed.
  * The user is instructed: *"Save this recovery key in a safe place. If you switch browsers or clear your data, this key is the only way to read your messages."*
  * The platform provides a simple *"Copy Key"* and *"Download Key File"* action.

### 3.6 Account Deletion
When a user deletes their account:
1. **Client**: Destroys the local IndexedDB database and zeroizes all cached memory keys.
2. **Server**:
   * Deletes the user's records from `public_keys` (preventing any sender from sealing new messages).
   * Deletes all unread and read messages where `recipient_id = user_id`.
   * Clears the user's `profiles` record.
   * Sent message metadata (`sender_id = user_id`) is transitioned to a tombstoned state for a 90-day abuse audit window (to prevent malicious actors from deleting accounts to erase harassment investigations), after which metadata is hard-purged.

---

## 4. Message Encryption Format

### 4.1 Encrypted Message Envelope Structure

All encrypted messages persist in the database and transit the network encapsulated in a standardized, versioned envelope:

```typescript
export type EncryptedMessageEnvelope = {
  v: 1;                                  // Protocol / envelope version
  alg: "x25519-xsalsa20poly1305";         // Cryptographic suite identifier
  kid: string;                           // Recipient public key UUID
  payload: string;                       // Base64(ephem_pk [32 bytes] || ciphertext || tag [16 bytes])
};
```

### 4.2 Separation of Concerns

```text
Database Column / Field              Exposure Scope              Plaintext Risk
---------------------------------    -----------------------     --------------
messages.id                          Platform + Recipient        Zero (UUIDv4)
messages.recipient_id                Platform + Recipient        Zero (UUIDv4)
messages.sender_id                   Platform ONLY (Hidden)      Zero (UUIDv4)
messages.key_id                      Platform + Recipient        Zero (References public_keys.id)
messages.protocol_version            Platform + Recipient        Zero (Integer)
messages.ciphertext                  Platform + Recipient        Zero (Encrypted payload string)
messages.created_at                  Platform + Recipient        Zero (Timestamp)
```

**Security Invariant**: The database table, API routes, and envelope contain **zero** plaintext fields, zero subjects, and zero preview snippets.

---

## 5. Message Authenticity, Integrity, and Abuse Considerations

### 5.1 Cryptographic Guarantees vs Non-Guarantees

| Security Property | Guaranteed by Cryptography? | Mechanism |
| :--- | :--- | :--- |
| **Confidentiality** | **YES** | Only the holder of the recipient's private key can decrypt the XSalsa20 ciphertext. |
| **Integrity** | **YES** | Poly1305 MAC tag detects any single-bit tampering or corruption of the payload. |
| **Sender Anonymity to Recipient** | **YES** | Ephemeral X25519 keypair contains zero sender identity bits; sender private key is never used in the crypto handshake. |
| **Sender Authenticity to Recipient** | **NO (By Design)** | The recipient cannot cryptographically prove which user sent the message. Authenticity is intentionally withheld to preserve anonymity. |
| **Server Accountability** | **NO (Enforced by Server Layer)** | Cryptography does not prove sender identity to the server; the server enforces identity via **Supabase Auth session tokens** at the API mutation gateway. |
| **Spam / Abuse Prevention** | **NO (Enforced by Server Layer)** | Cryptography cannot stop an authenticated user from sending abusive ciphertext. The server enforces rate limits, blocking, and abuse controls. |

### 5.2 Tampering, Replay, and Injections
* **Ciphertext Tampering**: Any modification of the ciphertext or ephemeral public key results in a Poly1305 MAC failure during `crypto_box_seal_open`, discarding the message safely.
* **Message Replay**: The server assigns a server-side `id` (UUIDv4) and `created_at` timestamp upon insertion. Clients cannot submit arbitrary message IDs or force message duplicates.
* **Cross-Recipient Relaying**: The envelope binds to `kid` (recipient's key ID). If a malicious client attempts to resubmit intercepted ciphertext to another recipient, decryption will fail because the shared secret relies on the original recipient's private key.

---

## 6. Organization Admission & Provisioning

### 6.1 Evaluation of Admission Models

* **Option A: Google Hosted Domain (`hd` Claim / Domain Match)**: Matches user's authenticated Google email domain against allowed domains. Simple, robust, zero-friction onboarding.
* **Option B: Invitation System**: Requires invite link tokens and distribution infrastructure. Adds onboarding friction.
* **Option C: Pre-Approved User List**: Requires admin manual pre-seeding of all employee emails. High operational burden.
* **Option D: Hybrid (Domain Match + Admin Approval)**: Overly complex for initial internal organizational launch.

### 6.2 Selected v1 Architecture: Verified Google Domain Match

**Mechanism**:
1. Organizations define their eligible email domains in `organizations.allowed_domains` (e.g. `["cih.org", "internal.cih.org"]`).
2. When a user authenticates via Supabase Google OAuth:
   * Supabase Auth completes the OAuth 2.0 handshake, verifying the user's Google email address.
   * A server-side Next.js Auth Callback / Database Trigger executes:
     * Extracts `domain = email.split('@')[1]`.
     * Queries `organizations` for an active organization where `domain = ANY(allowed_domains)`.
3. **If Match Found**:
   * Finds or creates the `profiles` record.
   * Inserts an `organization_members` record: `{ organization_id, user_id, role: 'member', status: 'active' }`.
   * User proceeds to onboarding/directory.
4. **If No Match Found (Rejected User)**:
   * The user is not assigned any organization membership.
   * The server-side session terminates or redirects to an unauthenticated status screen: *"Your email domain is not authorized for this organization network."*
   * The user is prevented from viewing profiles, searching the directory, or sending messages.

### 6.3 Multi-Tenant Invariant
* No organization name, domain, or ID is hardcoded in application logic.
* The system is multi-tenant capable: adding a second organization is simply a database record insert with its corresponding domain list.

---

## 7. Message Read API and Anonymity Enforcement

### 7.1 The Threat: Accidental `sender_id` Leakage
The `messages` table must store `sender_id` so the server can enforce blocking, rate limits, and abuse investigations. However, **invariant #1** dictates that the recipient must **NEVER** receive `sender_id`.

Relying on client-side exclusion (`const { sender_id, ...safe } = msg`) or client-side SQL projection (`supabase.from('messages').select('id, ciphertext')`) is unsafe: a malicious recipient using browser DevTools or `curl` could query `select sender_id from messages`.

### 7.2 Selected Dual Defense Architecture

```text
[ Client (Browser) ]
       │
       │  Invokes typed Server Action: getInboxMessages()
       ▼
[ Next.js Server Action / Route Handler ]
       │
       │  1. Authenticates session: auth.uid()
       │  2. Executes parameterized query against PostgreSQL View
       ▼
[ PostgreSQL Security Barrier View: recipient_inbox_messages ]
       │
       │  Projects ONLY safe columns:
       │  (id, recipient_id, ciphertext, key_id, protocol_version, created_at, is_read, is_starred)
       ▼
[ PostgreSQL Base Table: messages ]
       │
       │  RLS: Direct SELECT on base `messages` table is REVOKED from authenticated role!
```

#### Layer 1: PostgreSQL Security Barrier View (`recipient_inbox_messages`)
A dedicated view is defined in the database:

```sql
CREATE VIEW recipient_inbox_messages 
WITH (security_barrier = true) AS
SELECT 
    m.id,
    m.recipient_id,
    m.ciphertext,
    m.key_id,
    m.protocol_version,
    m.created_at,
    m.is_read,
    m.is_starred
FROM messages m
WHERE m.recipient_id = auth.uid()
  AND m.deleted_by_recipient = false;
```

* **Notice**: `sender_id` is completely absent from the view schema. It is physically impossible for any query to return `sender_id` through this view.

#### Layer 2: Next.js Server Layer (Server Actions / Route Handlers)
* Client components never call `supabase.from('messages')` directly.
* All reads pass through a typed Server Action: `getInboxMessages()`.
* The server action verifies the session, fetches rows from `recipient_inbox_messages`, and casts the return value to a strict TypeScript type `RecipientInboxMessage`:

```typescript
export type RecipientInboxMessage = {
  id: string;
  recipient_id: string;
  ciphertext: string;
  key_id: string;
  protocol_version: number;
  created_at: string;
  is_read: boolean;
  is_starred: boolean;
};
```

#### Layer 3: Row Level Security on Base Table
* The base `messages` table has RLS enabled.
* Direct `SELECT` permission on `messages` is restricted. Regular authenticated clients cannot issue arbitrary `select * from messages` queries via PostgREST.

---

## 8. Message Sending Security Flow

```text
[ Sender Client ]                    [ Next.js Server Action ]             [ PostgreSQL ]
       │                                        │                                │
1. Select recipient                             │                                │
2. Fetch recipient public key                   │                                │
       ├───────────────────────────────────────>│ (Verify org membership)        │
       │<───────────────────────────────────────┼── Return public_key            │
3. Compose plaintext in memory                  │                                │
4. Libsodium crypto_box_seal()                  │                                │
5. Clear plaintext from RAM                     │                                │
6. POST sendMessage(payload) ──────────────────>│                                │
                                                │ 7. Validate sender session     │
                                                │ 8. Validate recipient exists   │
                                                │ 9. Verify same active org      │
                                                │ 10. Check blocks table         │
                                                │ 11. Enforce rate limits        │
                                                │ 12. Validate envelope syntax   │
                                                │                                │
                                                │ 13. INSERT messages ──────────>│
                                                │     (stores ciphertext,        │
                                                │      sender_id, recipient_id)  │
                                                │<───────────────────────────────┤
7. Return { success: true } <───────────────────┤                                │
8. Close & unmount composer                     │                                │
```

### 8.1 Server Verifications on Send Mutation
Every send mutation must execute the following server-side checks in order:
1. **Authenticated Session**: Sender identity `sender_id = session.user.id` is derived strictly from the verified session cookie. The client is never allowed to specify `sender_id`.
2. **Recipient Validation**: Verify `recipient_id` exists, is active, and is not suspended.
3. **Organization Boundary**: Verify both sender and recipient share an active `organization_members` record in the current organization scope.
4. **Block Enforcement**: Query `blocks` table:
   $$\text{SELECT 1 FROM blocks WHERE blocker\_id = recipient\_id AND blocked\_id = sender\_id}$$
   If a block exists, reject the request with a generic error code (`RECIPIENT_UNAVAILABLE`) to prevent timing/oracle attacks.
5. **Rate Limiting**: Enforce sliding-window rate limits (e.g., maximum 5 messages per minute per sender, maximum 50 messages per day per sender).
6. **Payload Size**: Restrict envelope ciphertext size to a strict limit (e.g., max 16 KB, corresponding to ~4,000 characters of plaintext).
7. **Envelope Syntax Validation**: Zod schema validation ensuring `v = 1`, `alg = 'x25519-xsalsa20poly1305'`, and valid Base64 payload.
8. **Persistence**: Insert into `messages` table using server client.

---

## 9. Abuse Reporting and E2EE

### 9.1 The Challenge
Because the server stores only ciphertext and cannot decrypt message content, automated server-side content scanning is impossible. The system must provide a mechanism for victims of harassment or abuse to report messages to human organization moderators without compromising the E2EE model.

### 9.2 Evaluated Reporting Approaches
* **Option A: Explicit Plaintext Disclosure with Informed Consent**: The recipient voluntarily decrypts the abusive message on their device and submits the plaintext alongside the message identifier directly to authorized moderators.
* **Option B: Moderator Public-Key Re-encryption**: The client re-encrypts the message using a moderator team public key. Adds key distribution and rotation complexity; fundamentally achieves the same goal as Option A.
* **Option C: Metadata-Only Reporting**: Only timestamps and message IDs are submitted. Completely prevents moderators from assessing harassment severity.

### 9.3 Selected v1 Architecture: Explicit Plaintext Disclosure

```text
[ Recipient Client ]                           [ Server Action: reportMessage ]         [ Database: reports ]
User opens message -> Clicks "Report"
       │
Displays Consent Modal:
"Reporting will submit the decrypted
 message text to moderators for review."
       │
User confirms & selects reason
       │
POST /api/reports ─────────────────────────────> 1. Verify reporter = recipient_id
 { message_id, reason, plaintext }               2. Resolve sender_id from messages
                                                 3. INSERT into reports table ────────> Store in isolated
                                                 4. Log moderation audit event          moderation record
```

#### Protocol Rules:
1. **Informed Consent**: The user is shown an explicit modal: *"Reporting this message will securely share the decrypted message text, timestamp, and metadata with organization moderators to investigate harassment. This action cannot be undone."*
2. **Server Verification**: The server confirms that the authenticated reporter matches `messages.recipient_id`.
3. **Sender Identification**: The server looks up `messages.sender_id` and records `reported_user_id` inside the `reports` table.
4. **Isolation of Plaintext**: Disclosed plaintext is written **only** to the dedicated `reports.disclosed_content` column. The main `messages` table remains strictly ciphertext.
5. **Access Control**: Only users with the `moderator` or `admin` role in `organization_members` can view rows in `reports`. All moderator access is recorded in `moderation_audit_logs`.

---

## 10. Message Deletion Semantics

### 10.1 Recipient-Side Deletion (Soft-Delete)
* When a recipient deletes a message in their inbox, the server sets `messages.deleted_by_recipient = true`.
* The message immediately disappears from all recipient inbox views and queries.
* **Ciphertext Purge Lifecycle**:
  * If a message is marked `deleted_by_recipient = true` and has **not** been linked to an active abuse report, an automated daily database job purges the `ciphertext` (or deletes the row entirely) after a **30-day safety retention window**.
  * This window ensures that if a user deletes a message in panic and immediately reports it, the investigation can proceed.

### 10.2 Account Deletion
* **Recipient Side**: When an account is deleted, all records in `public_keys` are deleted immediately. All incoming messages (`recipient_id = deleted_user_id`) are permanently hard-deleted from PostgreSQL.
* **Sender Side**: To prevent abusive users from sending malicious threats and immediately deleting their account to evade accountability:
  * Rows where `sender_id = deleted_user_id` retain the immutable UUID in `messages.sender_id` for a **90-day abuse audit window**.
  * After 90 days, historical sent message records are hard-purged.
* **Client Side**: The local IndexedDB database is completely purged upon account deletion or logout.

---

## 11. Database Foundation Model

The proposed database foundation consists of 8 core tables:

### 11.1 `profiles`
* **Purpose**: Public directory details for users within organizations.
* **Important Columns**:
  * `id` (`uuid`, PK, FK `auth.users.id` ON DELETE CASCADE)
  * `username` (`citext`, UNIQUE, NOT NULL)
  * `display_name` (`text`, NOT NULL)
  * `avatar_url` (`text`, NULL)
  * `bio` (`text`, NULL)
  * `created_at` (`timestamptz`, default `now()`)
  * `updated_at` (`timestamptz`, default `now()`)
* **Security Sensitivity**: Public within the organization. Never contains email addresses or OAuth identifiers.
* **Indexes**: `CREATE INDEX idx_profiles_username ON profiles(username);`

### 11.2 `organizations`
* **Purpose**: Distinct organization tenants.
* **Important Columns**:
  * `id` (`uuid`, PK, default `gen_random_uuid()`)
  * `name` (`text`, NOT NULL)
  * `slug` (`text`, UNIQUE, NOT NULL)
  * `allowed_domains` (`text[]`, NOT NULL)
  * `created_at` (`timestamptz`, default `now()`)
* **Security Sensitivity**: Internal platform configuration.

### 11.3 `organization_members`
* **Purpose**: Associates users with organizations and assigns roles.
* **Important Columns**:
  * `id` (`uuid`, PK, default `gen_random_uuid()`)
  * `user_id` (`uuid`, NOT NULL, FK `profiles.id` ON DELETE CASCADE)
  * `organization_id` (`uuid`, NOT NULL, FK `organizations.id` ON DELETE CASCADE)
  * `role` (`text`, NOT NULL, default `'member'`) — Enum: `'admin' | 'moderator' | 'member'`
  * `status` (`text`, NOT NULL, default `'active'`) — Enum: `'active' | 'suspended'`
  * `joined_at` (`timestamptz`, default `now()`)
* **Indexes**: `CREATE UNIQUE INDEX idx_org_member ON organization_members(user_id, organization_id);`

### 11.4 `public_keys`
* **Purpose**: Stores active public encryption keys for recipient discovery.
* **Important Columns**:
  * `id` (`uuid`, PK, default `gen_random_uuid()`)
  * `user_id` (`uuid`, NOT NULL, FK `profiles.id` ON DELETE CASCADE)
  * `public_key` (`text`, NOT NULL) — 32-byte Base64 X25519 public key
  * `algorithm` (`text`, NOT NULL, default `'x25519-xsalsa20poly1305'`)
  * `is_active` (`boolean`, NOT NULL, default `true`)
  * `created_at` (`timestamptz`, default `now()`)
* **Security Sensitivity**: Public key material only. Secret keys are prohibited.
* **Indexes**: `CREATE INDEX idx_public_keys_user ON public_keys(user_id) WHERE is_active = true;`

### 11.5 `messages`
* **Purpose**: Stores encrypted message envelopes and delivery metadata.
* **Important Columns**:
  * `id` (`uuid`, PK, default `gen_random_uuid()`)
  * `sender_id` (`uuid`, NOT NULL, FK `profiles.id`) — **STRICTLY CONFIDENTIAL; NEVER RETURNED TO RECIPIENT**
  * `recipient_id` (`uuid`, NOT NULL, FK `profiles.id`)
  * `organization_id` (`uuid`, NOT NULL, FK `organizations.id`)
  * `key_id` (`uuid`, NOT NULL, FK `public_keys.id`)
  * `ciphertext` (`text`, NOT NULL) — Base64 Libsodium sealed box envelope
  * `protocol_version` (`integer`, NOT NULL, default `1`)
  * `is_read` (`boolean`, NOT NULL, default `false`)
  * `is_starred` (`boolean`, NOT NULL, default `false`)
  * `deleted_by_recipient` (`boolean`, NOT NULL, default `false`)
  * `created_at` (`timestamptz`, default `now()`)
* **Indexes**:
  * `CREATE INDEX idx_messages_recipient ON messages(recipient_id, created_at DESC) WHERE deleted_by_recipient = false;`
  * `CREATE INDEX idx_messages_sender ON messages(sender_id, created_at DESC);`

### 11.6 `blocks`
* **Purpose**: Server-enforced message blocking between users.
* **Important Columns**:
  * `id` (`uuid`, PK, default `gen_random_uuid()`)
  * `blocker_id` (`uuid`, NOT NULL, FK `profiles.id` ON DELETE CASCADE)
  * `blocked_id` (`uuid`, NOT NULL, FK `profiles.id` ON DELETE CASCADE)
  * `created_at` (`timestamptz`, default `now()`)
* **Indexes**: `CREATE UNIQUE INDEX idx_blocks_pair ON blocks(blocker_id, blocked_id);`

### 11.7 `reports`
* **Purpose**: Abuse reports containing disclosed evidence for moderators.
* **Important Columns**:
  * `id` (`uuid`, PK, default `gen_random_uuid()`)
  * `organization_id` (`uuid`, NOT NULL, FK `organizations.id`)
  * `reporter_id` (`uuid`, NOT NULL, FK `profiles.id`)
  * `reported_message_id` (`uuid`, NOT NULL, FK `messages.id`)
  * `reported_user_id` (`uuid`, NOT NULL, FK `profiles.id`) — Resolved server-side from `messages.sender_id`
  * `reason` (`text`, NOT NULL)
  * `disclosed_content` (`text`, NOT NULL) — Decrypted message text submitted by reporter
  * `status` (`text`, NOT NULL, default `'pending'`) — Enum: `'pending' | 'resolved' | 'dismissed'`
  * `created_at` (`timestamptz`, default `now()`)
  * `resolved_at` (`timestamptz`, NULL)
* **Security Sensitivity**: Highly restricted. Visible only to organization moderators/admins.

### 11.8 `moderation_actions`
* **Purpose**: Audit trail of administrative enforcement actions.
* **Important Columns**:
  * `id` (`uuid`, PK, default `gen_random_uuid()`)
  * `organization_id` (`uuid`, NOT NULL, FK `organizations.id`)
  * `moderator_id` (`uuid`, NOT NULL, FK `profiles.id`)
  * `target_user_id` (`uuid`, NOT NULL, FK `profiles.id`)
  * `action_type` (`text`, NOT NULL) — Enum: `'warn' | 'restrict' | 'suspend' | 'ban'`
  * `reason` (`text`, NOT NULL)
  * `created_at` (`timestamptz`, default `now()`)
  * `expires_at` (`timestamptz`, NULL)

---

## 12. RLS & Server Authorization Division

| Operation | PostgreSQL RLS Policy | Next.js Server Action / Route Responsibility |
| :--- | :--- | :--- |
| **Profile Reads** | Allow `SELECT` for authenticated users within the same organization. | Filter response to public attributes; apply directory search pagination. |
| **Profile Updates** | Allow `UPDATE` WHERE `auth.uid() = id`. | Zod validation of usernames, display names, and bio length limits. |
| **Public Key Reads** | Allow `SELECT` for active keys of users in same organization. | Cache lookup; return recipient public key for encryption. |
| **Message Reads** | **REVOKE direct `SELECT` on `messages` table**. Allow `SELECT` on view `recipient_inbox_messages` WHERE `recipient_id = auth.uid()`. | Provide strongly-typed `SafeInboxMessage` array stripped of any internal fields; manage pagination. |
| **Message Sending** | Allow `INSERT` on `messages` via service role or restricted RLS policy. | **Authoritative Gateway**: Verify session, verify org membership, check `blocks` table, enforce rate limits, validate envelope syntax. |
| **Message State Updates** | Allow `UPDATE` (is_read, is_starred, deleted_by_recipient) WHERE `recipient_id = auth.uid()`. | Verify ownership; execute optimistic mutations. |
| **Block / Unblock** | Allow `INSERT`, `DELETE` on `blocks` WHERE `blocker_id = auth.uid()`. | Validate target user existence; prevent self-blocking. |
| **Abuse Reporting** | Allow `INSERT` on `reports` WHERE `reporter_id = auth.uid()`. | Verify caller is message recipient; resolve `sender_id`; populate moderation record. |
| **Moderator Actions** | Allow `SELECT`, `UPDATE` on `reports` and `moderation_actions` only for `organization_members.role IN ('admin', 'moderator')`. | Verify administrative session; write audit trail logs. |

---

## 13. Threat Model

| Threat Actor | Target Asset | Attack Vector | Mitigation Architecture | Residual Risk |
| :--- | :--- | :--- | :--- | :--- |
| **Normal Malicious User** | Recipient identity or privacy | Attempts to craft malicious payload or inspect network responses for `sender_id`. | Dual boundary: `recipient_inbox_messages` view completely excludes `sender_id`; server action strips internal metadata. | None at network level. |
| **Authenticated Spammer** | Recipient inbox availability | Floods recipients with hundreds of ciphertext messages. | Sliding-window server rate limiting (max 5/min, 50/day per account); per-recipient rate caps; account suspension. | Distributed spammers across multiple authorized domain accounts. |
| **Blocked User** | Harassment target | Attempts to bypass UI block and send messages via direct API calls. | Server-side validation on every `sendMessage` mutation queries `blocks` table before persistence. | None; blocked sender cannot write to database. |
| **Compromised Browser / Malware** | Decrypted plaintext | Malware on recipient device reads DOM or hooks memory. | Scoped memory closures; zeroing plaintext buffers upon unmount. | **Unmitigable by web apps**: OS-level malware can always compromise device display/memory. |
| **Malicious Client Tampering** | Server database integrity | Submits forged `sender_id`, wrong `org_id`, or malformed ciphertext. | Server derives `sender_id = session.user.id`; rejects client-provided user IDs; validates ciphertext syntax. | None. |
| **Database Exposure (SQL Dump Leak)** | Message contents | Attacker obtains database backup or read replica. | All message contents are encrypted client-side with X25519; server holds zero private keys. | Attacker can inspect metadata (who messaged whom and when), but zero message plaintext. |
| **Server Log Leak** | Private user data | Application logs leak sensitive data to Datadog/CloudWatch. | Server never receives plaintext during normal delivery; private keys never touch server; structured logger strips bodies. | Operational error logging non-crypto metadata. |
| **Compromised Supabase Service Key** | Full database access | Attacker acquires `SUPABASE_SERVICE_ROLE_KEY`. | Service key stored strictly in Vercel secure env vars; never bundled in client code; ciphertext remains unreadable without user private keys. | Attacker can read relationship metadata and delete data, but cannot decrypt message plaintext. |
| **Corrupt / Rogues Moderator** | Private user messages | Moderator attempts to snoop on non-reported messages. | Server only stores ciphertext; moderators can view plaintext **only** for messages explicitly reported by victims. | Moderator misuse of legitimately reported messages; mitigated by immutable moderation audit logs. |
| **Accidental API Leakage** | Sender anonymity | Developer creates new endpoint that forgets to omit `sender_id`. | Strict database view security barrier; TypeScript lint rules disallowing direct queries on base `messages` table. | Regression without automated tests; mitigated by automated Playwright and Vitest assertions. |

---

## 14. Dependency Decisions

The following dependencies are reviewed and categorized:

| Dependency | Needed Now? | Justification |
| :--- | :---: | :--- |
| `@supabase/supabase-js` | **YES** | Core database client, authentication primitives, and storage interface. |
| `@supabase/ssr` | **YES** | Mandatory for secure Next.js App Router cookie handling, Server Components, and Server Actions. |
| `zod` | **YES** | Mandatory for runtime schema validation of envelopes, inputs, and environment variables. |
| `motion` | **YES (at UI setup)** | Accessible, lightweight micro-transitions adhering to quiet editorial design principles. |
| `lucide-react` | **YES (at UI setup)** | Clean, restrained icons for core navigation and actions. |
| `libsodium-wrappers` | **YES (at Crypto setup)** | Audited, Wasm-backed implementation of Curve25519 sealed-box primitives with constant-time security. |
| `vitest` | **YES** | Fast unit and integration testing for authorization rules, schemas, and cryptographic helpers. |
| `playwright` | **YES** | End-to-end testing for cross-browser authentication, send/receive flows, and network anonymity assertion. |
| `@testing-library/react` | **YES** | Component-level integration testing and accessibility validation. |

*Note: No dependencies will be installed during this architecture foundation phase. Installation will occur systematically in the upcoming foundation setup prompts.*

---

## 15. Open Questions & Future Considerations

1. **Moderator Key Rotation for v2**: In v2, if organization policies demand that reported content is also encrypted in transit to moderators, a dedicated organization moderator public-key rotation scheme can be layered over the report ingestion pipeline.
2. **Organization Domain Aliases**: The `organizations.allowed_domains` array supports multiple domain aliases per tenant (e.g. `['company.com', 'company.co.uk']`), ensuring smooth corporate identity changes.
3. **Automated Ephemeral Key Rotation**: In future phases, client keystores can support automatic semi-annual key rotation prompts for users to maintain forward hygiene.
