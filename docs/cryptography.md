# Cryptography & Public Key Infrastructure Architecture

## 1. Overview & Philosophy

The Anonymous Messaging Platform implements true client-side End-to-End Encryption (E2EE) tailored specifically for an **organization-first, one-way anonymous drop-box** paradigm.

### Guiding Principles:
1. **Zero Bespoke Cryptography**: All primitives strictly employ standard Libsodium algorithms via the audited `libsodium-wrappers` package.
2. **Server Zero-Knowledge of Plaintext**: The server never sees, processes, or stores message plaintext, private keys, or recovery secrets.
3. **Sender Anonymity by Cryptographic Design**: The recipient cryptographically receives confidentiality and integrity, but zero sender identity bits.
4. **User-Sovereign Recovery**: Private keys are stored locally on the user's trusted device. Account recovery relies on a client-derived, user-held 256-bit recovery phrase. The server is never an escrow agent.

---

## 2. Cryptographic Primitives & Parameters

| Primitive Layer | Algorithm / Standard | Parameters / Key Size |
| :--- | :--- | :--- |
| **Library Wrapper** | `libsodium-wrappers` (WebAssembly / Native) | Standard build (not `-sumo`) |
| **Key Agreement (KEM)** | Curve25519 (X25519 ECDH) | 32-byte public key, 32-byte private key scalar |
| **Key Derivation (KDF)** | BLAKE2b keyed hash | Nonce derived over `(ephem_pk || recipient_pk)` |
| **Authenticated Encryption (AEAD)** | XSalsa20-Poly1305 | 24-byte nonce, 16-byte Poly1305 MAC tag |
| **High-Level Primitives** | `crypto_box_seal` / `crypto_box_seal_open` | Libsodium Sealed Box |
| **Public Key Wire Format** | Standard Base64 | 44 characters (ending with `=`) |
| **Payload Wire Format** | Standard Base64 | `ephem_pk (32B) || ciphertext || mac (16B)` |
| **Protocol Version** | `1` | `alg: "x25519-xsalsa20poly1305"` |

---

## 3. Cryptographic Boundary

```
┌────────────────────────────────────────────────────────┐
│                   TRUSTED CLIENT BROWSER               │
│                                                        │
│  [Plaintext Message] ──> crypto_box_seal()             │
│                                │                       │
│  [Private Key] (32B) ──> IndexedDB (cih_keystore_v1)  │
│                                │                       │
│  [256-bit Recovery Seed] ──> User Backup Screen        │
└────────────────────────────────┼───────────────────────┘
                                 │
                   (Network Boundary - TLS)
                                 │
                                 ▼ (Only Base64 Ciphertext & Public Key)
┌────────────────────────────────────────────────────────┐
│                   SUPABASE & SERVER                    │
│                                                        │
│  - public_keys (user_id, public_key Base64, algorithm) │
│  - messages    (ciphertext Base64, recipient_id, kid)  │
│  - Auth Session Token (auth.uid())                     │
│                                                        │
│  CANNOT SEE:                                           │
│  ✗ Private keys                                        │
│  ✗ Decrypted plaintext                                 │
│  ✗ Recovery phrases / seeds                            │
└────────────────────────────────────────────────────────┘
```

### What the Server Can See:
- Authenticated user identities and organization memberships (`auth.users`, `profiles`, `organization_members`).
- 32-byte public keys and key rotation history (`public_keys`).
- Ciphertext envelopes and delivery timestamps (`messages`).
- Routing relationship metadata (sender UUID and recipient UUID).

### What the Server CANNOT See:
- **Private keys**: Never transmitted in HTTP requests, headers, or parameters.
- **Message plaintext**: Encryption occurs in client RAM prior to transmission.
- **Recovery phrases or root seeds**: User-held backup codes never touch the wire.
- **Decrypted inbox contents**: Decryption occurs strictly in client memory.

---

## 4. Key Lifecycle & Storage

### 4.1 Generation
- **Where**: Executed exclusively in the browser client via WebAssembly CSPRNG (`randombytes_buf`).
- **Timing**: Generated only when an authenticated user has completed onboarding and has no existing cryptographic identity. Key generation is never triggered during server-side rendering or on repeated page loads.
- **Process**:
  1. Generate 32-byte CSPRNG root seed: $S \in \{0, 1\}^{256}$.
  2. Derive Curve25519 keypair: $(PK, SK) = \text{crypto\_box\_seed\_keypair}(S)$.
  3. Format $S$ into a user-facing 64-character hyphenated hexadecimal recovery code.
  4. Store $(PK, SK)$ in browser IndexedDB.
  5. Publish $PK$ to Supabase via `register_public_key()`.

### 4.2 Local Storage (IndexedDB)
- **Database**: `cih_keystore_v1`
- **Object Store**: `identity_keys`
- **Record**:
  ```typescript
  interface StoredIdentityRecord {
    id: "active_identity";
    publicKey: Uint8Array;
    privateKey: Uint8Array;
    createdAt: number;
    keyId?: string; // Supabase public_keys UUID
  }
  ```
- **Invariants**:
  - Keys are stored as typed binary buffers (`Uint8Array`).
  - Private keys are **never** mirrored to `localStorage`, `sessionStorage`, cookies, or browser cache.
  - Memory buffers loaded during decryption are scoped and zeroized (`sodium.memzero`).

### 4.3 Key Loss & Accidental Replacement Defense
To prevent silent data loss, the client enforces a strict identity initialization state machine:
```text
Authenticated User
       ↓
Check IndexedDB
       ├── Local Key Found ──> READY (Use existing keypair)
       └── Local Key Missing
                 ↓
           Check Server Public Key Status
                 ├── Server Key Found ──> KEY_MISSING_RESTORE_REQUIRED
                 │                         (Prompt for Recovery Phrase;
                 │                          NEVER overwrite server key!)
                 └── Server Key Missing ──> Generate First-Time Identity
```

If a user clears browser storage or switches devices:
- The server will report that an active public key already exists.
- The client enters `KEY_MISSING_RESTORE_REQUIRED`.
- The client refuses to generate a replacement key, as doing so would make all past messages permanently undecryptable.
- The user is prompted to enter their 256-bit recovery code.

---

## 5. Public Key Infrastructure (PKI)

### 5.1 Database Schema (`public.public_keys`)
```sql
CREATE TABLE public.public_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  algorithm TEXT NOT NULL DEFAULT 'x25519-xsalsa20poly1305',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 5.2 Key Rotation & Atomicity
- **Single Active Key**: Enforced by partial unique index `idx_public_keys_unique_active_user ON public_keys(user_id) WHERE is_active = true`.
- **Atomic Registration**: Stored procedure `public.register_public_key(p_public_key, p_algorithm)` deactivates previous active keys and inserts the new active key in a single transaction.
- **Authorization Authority**: Derives identity from `auth.uid()`. Clients cannot supply arbitrary user IDs.

### 5.3 Discovery & Scope
- Peers can only query public keys of members who share an active organization membership (`shares_active_organization(target_user, auth.uid())`).
- Row Level Security (RLS) prevents unauthorized cross-tenant key harvesting.

---

## 6. Sealed Box Security & Anonymous Drop-Box Mechanics

### 6.1 Libsodium Sealed Box (`crypto_box_seal`)
For each message:
1. Sender generates an ephemeral X25519 keypair: $(ephem\_pk, ephem\_sk)$.
2. Ephemeral keypair computes ECDH shared secret with recipient's registered public key.
3. Plaintext is encrypted with XSalsa20-Poly1305.
4. Ephemeral private key $ephem\_sk$ is immediately destroyed.
5. Ciphertext payload is assembled:
   $$\text{Payload} = ephem\_pk \mathbin{\Vert} \text{ciphertext} \mathbin{\Vert} \text{mac}$$

### 6.2 Critical Limitation: No Sender Authentication
Sealed boxes provide:
- **Confidentiality**: Only the holder of the recipient's private key can decrypt the ciphertext.
- **Integrity**: Poly1305 MAC tag detects any tampering or corruption.

Sealed boxes **DO NOT** provide:
- **Sender Authentication to the Recipient**: The ephemeral keypair contains zero sender identity bits. The recipient cannot determine or verify who created the message. This limitation is intentional to satisfy the product's core anonymity requirement.

---

## 7. Account Recovery Protocol

### 7.1 Recovery Code Format
- 256 bits of entropy derived from `randombytes_buf(32)`.
- Displayed as an 8-block hyphenated hexadecimal code:
  `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`
- Can also be backed up as a 44-character Base64 key.

### 7.2 Restoration Flow
1. User supplies recovery code on a new browser/device.
2. Client parses and validates entropy length (32 bytes).
3. Client deterministically regenerates the Curve25519 keypair: `crypto_box_seed_keypair(seed)`.
4. Client derives public key and verifies that it matches the server's active registered key.
5. Client saves the restored keypair to local IndexedDB.
6. The intermediate seed is immediately zeroized in memory.

---

## 8. Threat Model & Inherent Limitations

1. **Client Endpoint Compromise**: E2EE protects data in transit and at rest on the server. If an attacker gains full control of the user's browser, device, or installs malicious browser extensions, they can read memory plaintext or extract IndexedDB keys. E2EE cannot protect against a compromised client endpoint.
2. **Lost Recovery Phrases**: Because the server never escrows private keys or recovery seeds, if a user loses both their local device storage and their recovery phrase, historical messages encrypted to that key are permanently lost.
3. **Traffic Analysis**: While message content is end-to-end encrypted, the server observes timing and routing metadata (which user sent a message to which recipient). Protections against traffic correlation are addressed in server rate-limiting and abuse monitoring.
