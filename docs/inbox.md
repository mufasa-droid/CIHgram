# Recipient Inbox & Client-Side Decryption Architecture

## 1. Overview & Core Product Invariants

The Recipient Inbox provides authenticated users with secure, privacy-preserving access to their received anonymous messages.

### Non-Negotiable Invariants:
1. **One-Way Anonymous Delivery**: There are no threads, conversations, or replies. Each message stands alone as an individual drop-box submission.
2. **Absolute Anonymity Boundary**: The recipient never receives the sender's database ID, username, email, public profile, or other identifying metadata. The database view and API response omit sender identity entirely.
3. **Client-Side Decryption**: Plaintext is never stored on or transmitted through the server. The browser client retrieves encrypted Libsodium sealed box ciphertext and decrypts it locally using the recipient's locally stored Curve25519 private key.
4. **Zero Server Escrow**: Private keys and recovery seeds remain user-held and never touch server storage, network payloads, or logs.
5. **No Sender-Facing Read Receipts**: Marking a message as read updates recipient state only and is never exposed to senders.

---

## 2. End-to-End Inbox Data Flow

```text
[ Recipient Browser ]                                [ Supabase / Server ]
       │                                                       │
1. Open /inbox                                                 │
2. GET getInboxMessagesAction({ limit: 20 }) ─────────────────>│
                                                               │ 3. Verify session auth.uid()
                                                               │ 4. Execute get_recipient_inbox()
                                                               │    (Security barrier: omits sender_id)
                                                               │<── Return RecipientInboxMessage[]
5. Receive Base64 ciphertext records <─────────────────────────┤
6. Query local IndexedDB (cih_keystore_v1)                     │
   - Retrieve Curve25519 private key                           │
7. Libsodium crypto_box_seal_open(ciphertext)                  │
   - Ephemeral public key unpacked                             │
   - Shared secret computed via X25519 ECDH                    │
   - XSalsa20-Poly1305 authenticated decryption                │
   - Strict UTF-8 decoding                                     │
8. Plaintext rendered in ephemeral React state                 │
```

---

## 3. Server-Side Authorization Boundary & DTO Specification

### 3.1 Security Barrier View (`recipient_inbox_messages`)
Defined in migrations `20261008000006_recipient_inbox_schema.sql` and hardened in `20261008000007_harden_inbox_organization_boundary.sql`:
```sql
CREATE OR REPLACE VIEW public.recipient_inbox_messages
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
FROM public.messages m
WHERE m.recipient_id = auth.uid()
  AND m.deleted_by_recipient = false
  AND EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = auth.uid()
      AND om.organization_id = m.organization_id
      AND om.status = 'active'
  );
```

Direct `SELECT` access on the base `public.messages` table remains revoked from `authenticated` and `anon` roles. All read queries are mediated through this view and the `SECURITY DEFINER` routine `get_recipient_inbox`, which verifies active organization membership.


### 3.2 Exact Recipient-Safe Fields
The DTO returned to recipient clients (`RecipientInboxMessage`) contains strictly:

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` (UUID) | Unique message identifier for client actions |
| `ciphertext` | `string` (Base64) | Sealed box encrypted payload |
| `keyId` | `string` (UUID) | Recipient's public key identifier used at encryption time |
| `protocolVersion` | `number` | Cryptographic suite version (`1`) |
| `createdAt` | `string` (ISO) | Delivery timestamp |
| `isRead` | `boolean` | Recipient-owned read state |
| `isStarred` | `boolean` | Recipient-owned favorite/star flag |

**Prohibited Fields**: `sender_id`, `sender_username`, `sender_email`, `organization_id`, and internal moderation fields are strictly absent.

---

## 4. Client-Side Decryption Sequence & Key Lifecycle

### 4.1 Decryption Steps
1. **Keystore Verification**: Client checks browser IndexedDB support (`isKeystoreSupported()`).
2. **Local Key Resolution**: Client retrieves the active keypair from `cih_keystore_v1` via `getLocalIdentity()`.
3. **Protocol Check**: Checks `protocolVersion === 1`.
4. **Sealed Box Decryption**: Calls `decryptSealedBox(ciphertext, privateKey, publicKey)`.
5. **Decrypted Plaintext Handling**: Plaintext is held in React component state.

### 4.2 Handling Missing or Rotated Keys
- If no local key is found in IndexedDB, the client queries `getUserKeyStatusAction()`.
- If the server confirms an active public key is registered, the UI enters `missing_key` state.
- **Never Auto-Regenerate**: The client will **never** silently overwrite or create a replacement key, as doing so would permanently destroy access to historical messages.
- The user is prompted with an editorial recovery card to enter their user-held 256-bit recovery phrase. Upon submitting, `restoreIdentity(phrase)` regenerates the keypair, verifies the public key against the server, saves it to IndexedDB, and decrypts the inbox.

### 4.3 Decryption Failure Isolation
If individual messages fail decryption (e.g. corrupted ciphertext or invalid MAC tag), that message is visibly marked with a calm error notification (*"This message could not be decrypted with your current key"*). Other valid messages in the batch decrypt and render normally.

### 4.4 Multi-Account Switching & Local Keystore Isolation
To prevent cross-account keystore state contamination on shared devices:
1. **Server Key Validation**: Prior to local decryption, `decryptInboxMessages` queries `getUserKeyStatusAction()`. If the local key in IndexedDB does not match the active public key of the authenticated session, decryption is aborted and `keyState` transitions to `missing_key` with an explicit recovery prompt.
2. **First-Time / Initialization Defense**: `initializeUserIdentity` detects lingering foreign keys from previous sessions, purges them via `clearLocalIdentity()`, and requests key restoration.
3. **Sign-Out Keystore Purge**: Clicking "Sign Out" in `WorkspaceHeader` triggers an asynchronous client-side purge (`clearLocalIdentity()`) that zeroizes in-memory keys and purges IndexedDB before submitting the signout request.

---

## 5. Recipient-Owned Message Actions

All message mutations are server-authorized and strictly verify `recipient_id = auth.uid()`:

### 5.1 Mark as Read (`markMessageReadAction`)
- Stored procedure `mark_message_read(p_message_id)`.
- Updates `is_read = true` where `id = p_message_id AND recipient_id = auth.uid() AND deleted_by_recipient = false`.
- Idempotent: Repeated calls return success safely.
- No read receipts are communicated to senders.

### 5.2 Star and Unstar (`setMessageStarredAction`)
- Stored procedure `set_message_starred(p_message_id, p_is_starred)`.
- Updates `is_starred = p_is_starred` where `id = p_message_id AND recipient_id = auth.uid()`.
- Optimistically reflected in the UI with automatic rollback on network failure.

### 5.3 Delete from Inbox (`deleteMessageAction`)
- Stored procedure `delete_message_for_recipient(p_message_id)`.
- Sets `deleted_by_recipient = true` where `id = p_message_id AND recipient_id = auth.uid()`.
- Soft-delete semantics: Excluded from all future inbox queries immediately.
- Sender accountability metadata and the 30-day safety retention purge lifecycle are preserved.
- UI requires explicit user confirmation prior to mutation.

---

## 6. Pagination, Performance & Memory Lifecycle

### 6.1 Cursor-Based Pagination
- Stored procedure `get_recipient_inbox(p_cursor TIMESTAMPTZ, p_limit INTEGER)`:
  - Clamps limit safely between 1 and 50 (default 20).
  - Uses `ORDER BY created_at DESC, id DESC`.
  - Filters `created_at < p_cursor` for subsequent pages.
  - Leverages index `idx_messages_recipient_inbox ON messages(recipient_id, created_at DESC) WHERE deleted_by_recipient = false`.

### 6.2 Plaintext Lifecycle & Logging Restrictions
- Decrypted plaintext exists strictly in ephemeral React memory.
- Plaintext is **never** written to `localStorage`, `sessionStorage`, IndexedDB, cookies, URL search parameters, or server requests.
- Component unmount clears state (`setDecryptedMessages([])`).
- Structured logger (`src/lib/logger`) automatically redacts `plaintext`, `ciphertext`, and private key fields.

---

## 7. Known Limitations & Threat Model Boundaries

1. **Client Endpoint Security**: If the recipient's browser or device is compromised with malware or malicious browser extensions, plaintext in the DOM or memory can be inspected. Web applications cannot provide absolute immunity against compromised operating systems.
2. **Missing Recovery Phrase**: Because the platform operates with zero key escrow, if a user loses both their browser IndexedDB storage and their recovery phrase, historical encrypted messages cannot be recovered.
3. **No Cryptographic Sender Authentication**: Sealed boxes provide recipient confidentiality and integrity, but deliberately withhold sender signatures to protect sender anonymity.
4. **JavaScript String Memory Immutability**:
   - In ECMAScript engines (V8, JavaScriptCore, SpiderMonkey), strings are immutable primitives allocated on the engine heap. The application cannot directly overwrite or zeroize underlying memory bytes of string objects in the way that `sodium.memzero()` zeroizes typed `Uint8Array` binary buffers.
   - While React state dereferences decrypted strings on component unmount (`setDecryptedMessages([])`), the garbage collector determines when physical memory is reclaimed. An attacker with physical device memory dump capabilities prior to garbage collection could theoretically inspect string memory.
   - Mitigation: Users should close browser tabs or log out on shared computers.
5. **Browser Caching & BFCache**:
   - Modern browsers employ Back-Forward Cache (bfcache) to preserve complete page DOM and state snapshots for instant back navigation. If a user signs out without closing the tab, pressing "Back" may restore a cached snapshot unless bfcache navigation listeners or strict cache control headers (`Cache-Control: no-store`) are enforced.

