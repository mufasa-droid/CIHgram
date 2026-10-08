# Anonymous Messaging Architecture & Sending Flow

## 1. Overview & Non-Conversational Paradigm

The Anonymous Messaging Platform is engineered for **one-way, recipient-only anonymous delivery**.

### Invariants:
1. **No Conventional Chat**: There are no threads, reply chains, chat rooms, or conversation histories.
2. **One-Shot Transient Submissions**: Selecting a colleague opens a temporary, single-use message composer. Closing or sending immediately clears the draft. Reopening the same person opens a fresh, blank composer.
3. **End-to-End Encryption**: Message plaintext is encrypted in browser RAM using Libsodium sealed boxes before network transmission.
4. **Recipient Privacy & Sender Anonymity**: The recipient receives confidentiality and integrity, but zero sender identity bits.

---

## 2. Encryption Flow & Envelope Format

```text
[ Sender Client Browser ]
  1. Plaintext typed into textarea: "Honest feedback note..."
  2. Query recipient's active public key (Curve25519, 32 bytes)
  3. Libsodium crypto_box_seal(plaintext, recipient_pk)
       - Ephemeral Curve25519 keypair (ephem_pk, ephem_sk) generated
       - Shared secret computed via X25519 ECDH
       - Nonce/Key derived via BLAKE2b
       - Plaintext encrypted via XSalsa20-Poly1305
       - ephem_sk immediately wiped from memory
  4. Form Base64 wire payload: ephem_pk (32B) || ciphertext || mac (16B)
  5. Clear plaintext from RAM
         │
         │  POST sendMessageAction(envelope)
         ▼
[ Server / Next.js Server Action ]
  - Receives strictly Base64 ciphertext, recipientId, keyId, protocolVersion
  - NEVER receives plaintext, drafts, or sender private keys
```

### Encrypted Message Envelope Structure:
```typescript
export interface SendMessageInput {
  recipientId: string;                    // Target user UUID
  keyId: string;                          // Recipient's public_keys UUID
  ciphertext: string;                     // Base64 sealed box payload (48B to 32KB)
  protocolVersion: 1;                     // Protocol version
  alg: "x25519-xsalsa20poly1305";         // Cryptographic suite identifier
}
```

---

## 3. Database Schema (`public.messages`)

Defined in [20261008000004_messages_schema.sql](file:///c:/Users/HomePC/Documents/projects/cih%20message%20platform/supabase/migrations/20261008000004_messages_schema.sql):

```sql
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key_id UUID NOT NULL REFERENCES public.public_keys(id) ON DELETE RESTRICT,
  ciphertext TEXT NOT NULL,
  protocol_version INTEGER NOT NULL DEFAULT 1,
  is_read BOOLEAN NOT NULL DEFAULT false,
  is_starred BOOLEAN NOT NULL DEFAULT false,
  deleted_by_recipient BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT sender_recipient_distinct_check CHECK (sender_id <> recipient_id),
  CONSTRAINT protocol_version_check CHECK (protocol_version = 1),
  CONSTRAINT ciphertext_size_check CHECK (
    length(trim(ciphertext)) >= 48 AND length(ciphertext) <= 32768
  )
);
```

### Separation of Concerns:
- `sender_id`: Retained internally by the platform for rate limiting, abuse investigation, and blocking enforcement.
- `recipient_id`: Target of the message.
- `ciphertext`: Opaque Base64 encrypted payload.
- **Zero Plaintext**: No plaintext column, no subject, no search preview, and no snippet exists in the database.

---

## 4. Row Level Security & Anonymity Enforcement

1. **Direct `SELECT` Revocation**: Direct `SELECT` permission on the base `messages` table is **revoked** from `authenticated` and `anon` roles. This prevents malicious clients from querying `sender_id` directly via PostgREST.
2. **Recipient Reads**: In Prompt 008, recipients will query strictly through the PostgreSQL Security Barrier View (`recipient_inbox_messages`), which projects only safe columns (`id, recipient_id, ciphertext, key_id, created_at, is_read, is_starred`) and completely omits `sender_id`.
3. **Session-Enforced Inserts**: The insert policy verifies `sender_id = auth.uid()`.

---

## 5. Server-Side Send Authorization & Stored Procedure

Mutation is handled atomically by `send_anonymous_message`:
1. **Authentication Guard**: Verifies `auth.uid()` is present.
2. **Self-Messaging Prohibition**: Fails if `sender_id = recipient_id`.
3. **Organization Scoping**: Validates that both sender and recipient share an active membership in the same organization.
4. **Key Verification**: Verifies that `key_id` belongs to `recipient_id` and is currently active (`is_active = true`).
5. **Sliding-Window Rate Limiting**:
   - Max **5 messages per 60 seconds** per sender.
   - Max **50 messages per 24 hours** per sender.
   - Enforced at the database level to ensure consistency across distributed server instances.
6. **Atomic Persistence**: Inserts into `public.messages` and returns minimal confirmation (`{ success: true, message_id }`).

---

## 6. Duplicate Submission & Retry Safety

- **Client State Lock**: While encrypting and sending, `isSubmitting` disables the "Send" button and cancel actions to prevent duplicate concurrent submissions.
- **Error Preservation**: If a network failure occurs, the draft text is preserved in the composer textarea so the user does not lose their writing.
- **Success Clearance**: Upon successful server confirmation, the draft text is wiped immediately from component state and the success screen is displayed.

---

## 7. Delivery Status Semantics

- **What Submission Confirms**: Successful submission confirms that the encrypted message has been safely accepted and persisted in the platform database.
- **What Submission DOES NOT Confirm**: It does not confirm that the recipient has decrypted or read the message.

---

## 8. Deferred Work

- **Recipient Inbox & Client Decryption**: Scheduled for Prompt 008.
- **User Blocking & Blocklist Queries**: Scheduled for Prompt 010.
- **Abuse Reporting & Plaintext Disclosure**: Scheduled for Prompt 011.
