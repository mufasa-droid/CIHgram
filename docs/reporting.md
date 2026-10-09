# Abuse Reporting & Explicit Evidence Disclosure Architecture

## 1. Overview & Core Product Invariants

The Abuse Reporting subsystem enables authenticated recipients to report abusive anonymous messages to authorized organization moderators without compromising the platform's core anonymity invariants or end-to-end encryption architecture.

### Non-Negotiable Invariants:
1. **Normal Storage Remains End-to-End Encrypted**: Normal message transport and persistence in `public.messages` remains 100% ciphertext-only. The server never automatically decrypts messages.
2. **Explicit, Opt-In Plaintext Disclosure Only**: Decrypted message plaintext is stored on the server ONLY if the recipient explicitly and voluntarily opts in by checking the disclosure consent box during report submission.
3. **Sender Anonymity Preserved Across Client Boundaries**: The reporter NEVER learns the sender's identity, internal UUID, email, or profile information. The database resolves the sender internally for future moderator review.
4. **Direct Access Strictly Revoked**: Direct table access to `public.reports` is revoked from `PUBLIC`, `anon`, and `authenticated`. Report creation is mediated exclusively through the `SECURITY DEFINER` function `create_message_report`.
5. **No Moderation Execution in Phase 2**: The reporting milestone implements report collection and evidence storage only. Moderation queues, actions, and account sanctions belong strictly to Phase 3 (Prompt 010D).

---

## 2. End-to-End Reporting Flow

```text
[ Recipient Browser ]                                [ Supabase / Server ]
       │                                                       │
1. Message decrypted locally in browser memory                 │
2. User clicks "Report" flag icon                              │
3. Opens ReportMessageDialog                                   │
   - Selects category (e.g. harassment, threats)               │
   - Enters optional context (up to 1000 chars)                │
   - Explicit Plaintext Disclosure (UNCHECKED by default)      │
       │                                                       │
4. User submits report ───────────────────────────────────────>│
   POST reportMessageAction(...)                               │
                                                               │ 5. Verify session auth.uid()
                                                               │ 6. Verify caller is message recipient
                                                               │ 7. Check 10/hour rate limit
                                                               │ 8. Acquire transaction advisory lock
                                                               │ 9. Enforce UNIQUE(message_id, reporter_id)
                                                               │ 10. Store in public.reports:
                                                               │     - plaintext saved ONLY if consent=true
                                                               │ 11. Return { success: true, report_id }
12. Confirmation rendered in UI <──────────────────────────────┤ (Zero sender UUID or identity exposed)
```

---

## 3. Database Schema (`public.reports`)

Defined in [20261008000010_reports_schema.sql](file:///c:/Users/HomePC/Documents/projects/cih%20message%20platform/supabase/migrations/20261008000010_reports_schema.sql):

| Column | Type | Nullable | Default | Description |
| :--- | :--- | :---: | :--- | :--- |
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key |
| `organization_id` | `UUID` | No | — | Organization tenant boundary |
| `reporter_id` | `UUID` | No | — | Authenticated recipient (internal auth UUID) |
| `reported_user_id` | `UUID` | No | — | Message sender (resolved internally from `messages.sender_id`) |
| `message_id` | `UUID` | No | — | Referenced message ID |
| `category` | `TEXT` | No | — | Category enum (`harassment`, `threats`, `spam`, `inappropriate_content`, `impersonation`, `other`) |
| `details` | `TEXT` | Yes | `NULL` | Optional reporter explanation (max 1000 chars) |
| `disclosed_plaintext` | `TEXT` | Yes | `NULL` | User-submitted decrypted message text (max 2000 chars) |
| `disclosed_plaintext_consent` | `BOOLEAN` | No | `false` | Explicit consent flag |
| `status` | `TEXT` | No | `'pending'` | Queue status (`pending`, `investigating`, `resolved`, `dismissed`) |
| `created_at` | `TIMESTAMPTZ` | No | `NOW()` | Timestamp report submitted |
| `updated_at` | `TIMESTAMPTZ` | No | `NOW()` | Timestamp report updated |

### Constraints & Invariants:
- `reports_no_self_report`: `CHECK (reporter_id <> reported_user_id)`. Prohibits users from reporting their own sent messages.
- `reports_unique_message_reporter`: `UNIQUE (message_id, reporter_id)`. Enforces a strict one-report-per-recipient-per-message policy at the database constraint level.
- `reports_plaintext_consent_check`: `CHECK (disclosed_plaintext IS NULL OR disclosed_plaintext_consent = true)`. Guarantees plaintext can never be persisted without an affirmative consent boolean.

---

## 4. Stored Procedure Contract: `create_message_report`

```sql
CREATE OR REPLACE FUNCTION public.create_message_report(
  p_message_id UUID,
  p_category TEXT,
  p_details TEXT DEFAULT NULL,
  p_disclose_plaintext BOOLEAN DEFAULT FALSE,
  p_disclosed_plaintext TEXT DEFAULT NULL
)
RETURNS JSONB
```

### Authorization & Security Checks:
1. **Session Derivation**: Reporter identity is extracted strictly from `auth.uid()`.
2. **Active Organization Membership**: Validates that the caller holds an `active` status in `public.organization_members`.
3. **Recipient Ownership**: Verifies `messages.recipient_id = auth.uid()`. If the caller did not receive the message, the query returns no row and throws generic `MESSAGE_NOT_FOUND`.
4. **Organization Isolation**: Validates that the message belongs to the caller's active organization.
5. **Sliding-Window Rate Limiting**: Clamps reporting to **10 reports per hour per user**.
6. **Concurrency Advisory Locking**: Obtains a transaction-scoped advisory lock on `hashtext('report:' || auth.uid() || ':' || p_message_id)` to serialize concurrent submissions and eliminate race conditions.
7. **Duplicate Prevention**: Rejects duplicate reports with `DUPLICATE_REPORT`.
8. **Disclosed Plaintext Handling**:
   - If `p_disclose_plaintext = TRUE`: Verifies plaintext length <= 2000 characters and sets `disclosed_plaintext_consent = true`.
   - If `p_disclose_plaintext = FALSE`: Strictly normalizes `disclosed_plaintext` to `NULL` and sets `disclosed_plaintext_consent = false`.

---

## 5. Explicit Plaintext Evidence & Cryptographic Limits

### User-Submitted Evidence vs. Cryptographic Proof:
- **Important Distinction**: In end-to-end encrypted messaging with Libsodium sealed boxes (`crypto_box_seal`), messages are encrypted using an ephemeral sender keypair that is destroyed immediately after encryption. While sealed boxes provide recipient confidentiality, they intentionally do NOT produce an asymmetric digital signature linking the ciphertext to the sender's long-term identity (which would break sender anonymity).
- **Evidence Semantics**: The disclosed plaintext submitted by the recipient is **user-provided evidence**. It is stored in `public.reports.disclosed_plaintext` to enable organization moderators to read the reported content. However, the system does not claim or describe this as mathematical non-repudiation or cryptographic proof of authorship.
- **Moderator Access**: Access to `public.reports` is completely restricted. As implemented in Prompt 010D (see [docs/moderation.md](file:///c:/Users/HomePC/Documents/projects/cih%20message%20platform/docs/moderation.md)), reports are reviewed strictly by authorized workspace moderators and administrators (`is_org_moderator_or_admin`) via `/moderation` with append-only audit logging (`public.moderation_actions`). Plaintext is withheld from queue overviews and revealed only in the detail dialog when `disclosed_plaintext_consent = true`.

---

## 6. Moderation Lifecycle & Retention

- **Report Review & Resolution**: Reports enter status `'pending'`, transition to `'investigating'`, and are resolved or dismissed via `resolve_report` or sanction action `apply_moderation_action`.
- **Soft-Delete Decoupling**: When a recipient deletes a message from their inbox (`delete_message_for_recipient`), the message undergoes a soft-delete (`deleted_by_recipient = true`) and is excluded from personal inbox views. However, if a message has an active report in `public.reports`, the report remains securely available to moderators for review.
- **Sanction Execution**: Verified abuse can trigger account warnings or suspension (`organization_members.status = 'suspended'`), which immediately revokes all messaging and inbox permissions for the offending sender.
- **Retention**: Historical moderation actions are permanently logged in `public.moderation_actions` for tamper-evident accountability. Future purge cycles are detailed in [docs/moderation.md](file:///c:/Users/HomePC/Documents/projects/cih%20message%20platform/docs/moderation.md).
