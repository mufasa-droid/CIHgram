### Prompt 010C: Abuse Reporting and Explicit Evidence Disclosure — Completion Report

Prompt 010C has been fully implemented, validated, and pushed to GitHub (`main` branch commit `46df946`). Below is the structured delivery report following the Prompt 010C checklist.

---

### 1. Exact SQL Schema Added

#### Forward-Only Migration
Implemented forward-only migration [`supabase/migrations/20261008000010_reports_schema.sql`](file:///c:/Users/HomePC/Documents/projects/cih%20message%20platform/supabase/migrations/20261008000010_reports_schema.sql) and synchronized [`supabase/complete_setup.sql`](file:///c:/Users/HomePC/Documents/projects/cih%20message%20platform/supabase/complete_setup.sql):

- **Table**: `public.reports`
  - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE`
  - `reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`
  - `reported_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`
  - `message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE`
  - `category TEXT NOT NULL`
  - `details TEXT`
  - `disclosed_plaintext TEXT`
  - `disclosed_plaintext_consent BOOLEAN NOT NULL DEFAULT false`
  - `status TEXT NOT NULL DEFAULT 'pending'`
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())`
  - `updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())`

- **Database Constraints**:
  - `CHECK (reporter_id <> reported_user_id)`: Prevents self-reporting.
  - `UNIQUE (message_id, reporter_id)`: Enforces strict one-report-per-message policy per recipient.
  - `CHECK (category IN ('harassment', 'hate_speech', 'threats', 'spam', 'other'))`: Restricts category values.
  - `CHECK (status IN ('pending', 'investigating', 'resolved', 'dismissed'))`: Restricts lifecycle statuses.
  - `CHECK (length(details) <= 1000)`: Caps optional reporter context.
  - `CHECK (disclosed_plaintext IS NULL OR length(disclosed_plaintext) <= 2000)`: Caps disclosed plaintext size.
  - `CHECK (disclosed_plaintext IS NULL OR disclosed_plaintext_consent = true)`: Enforces database-level constraint that plaintext can **never** be stored without explicit disclosure consent.

- **Indexes**:
  - `idx_reports_org_status_created` on `(organization_id, status, created_at DESC)`
  - `idx_reports_message_id` on `(message_id)`
  - `idx_reports_reporter_created` on `(reporter_id, created_at DESC)`
  - `idx_reports_reported_user_created` on `(reported_user_id, created_at DESC)`

- **Row Level Security (RLS)**:
  - Enabled RLS on `public.reports`.
  - Revoked all direct table privileges (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) from `PUBLIC`, `anon`, and `authenticated`.
  - Defined administrative review policy `reports_org_admin_read` allowing access only to confirmed organization administrators.

- **Stored Procedure**: [`create_message_report`](file:///c:/Users/HomePC/Documents/projects/cih%20message%20platform/supabase/migrations/20261008000010_reports_schema.sql#L104-L198) (`SECURITY DEFINER`, fixed `search_path = public, auth, pg_temp`):
  - Validates active organization membership of caller (`auth.uid()`).
  - Verifies message exists and caller is the recipient (`recipient_id = auth.uid()`).
  - Acquires transactional advisory lock: `pg_advisory_xact_lock(hashtext('report:' || v_caller_id::text || ':' || p_message_id::text))`.
  - Enforces sliding-window rate limit (max 10 reports per hour per user).
  - Checks duplicate report constraint.
  - Resolves internal `reported_user_id` server-side from `public.messages.sender_id`.
  - Enforces plaintext consent logic: sets `disclosed_plaintext` to `NULL` unless `p_disclose_plaintext IS TRUE`.
  - Returns strictly `jsonb_build_object('success', true, 'report_id', v_report_id)` with zero sender identity metadata.

---

### 2. Client Components and Server Actions Created / Modified

- **Created [`ReportMessageDialog`](file:///c:/Users/HomePC/Documents/projects/cih%20message%20platform/src/components/inbox/report-message-dialog.tsx)**:
  - Modal dialog adhering to 71UI quiet, minimal aesthetics.
  - Curated category radio selection (`harassment`, `hate_speech`, `threats`, `spam`, `other`).
  - Optional details field (1,000 char limit with tabular counter).
  - Explicit plaintext disclosure consent checkbox (`UNCHECKED` by default) with clear advisory.
  - Keyboard accessibility (Escape to close, Cmd/Ctrl+Enter submission, focus management).
- **Modified [`RecipientInbox`](file:///c:/Users/HomePC/Documents/projects/cih%20message%20platform/src/components/inbox/recipient-inbox.tsx)**:
  - Added quiet flag action icon button to each message card.
  - Passes decrypted in-memory plaintext securely to dialog without re-fetching or persistent storage.
  - Shows success notification and marks reported messages in local component state.
- **Created [`submitMessageReportAction`](file:///c:/Users/HomePC/Documents/projects/cih%20message%20platform/src/lib/reporting/actions.ts)**:
  - Server Action verifying authenticated user session and active organization membership.
  - Validates payload using [`createReportSchema`](file:///c:/Users/HomePC/Documents/projects/cih%20message%20platform/src/lib/reporting/validation.ts).
  - Enforces that decrypted plaintext is transmitted to DB only if `disclosePlaintext` is `true`.
  - Emits structured operational logs (`report_submitted`, `report_submission_rejected`) with complete sender UUID and plaintext redaction.
- **Created Domain Layer**:
  - Types: [`src/lib/reporting/types.ts`](file:///c:/Users/HomePC/Documents/projects/cih%20message%20platform/src/lib/reporting/types.ts)
  - Validation: [`src/lib/reporting/validation.ts`](file:///c:/Users/HomePC/Documents/projects/cih%20message%20platform/src/lib/reporting/validation.ts)
  - Service: [`src/lib/reporting/service.ts`](file:///c:/Users/HomePC/Documents/projects/cih%20message%20platform/src/lib/reporting/service.ts)
  - Exports: [`src/lib/reporting/index.ts`](file:///c:/Users/HomePC/Documents/projects/cih%20message%20platform/src/lib/reporting/index.ts)
- **Updated [`src/lib/auth/dev-mock.ts`](file:///c:/Users/HomePC/Documents/projects/cih%20message%20platform/src/lib/auth/dev-mock.ts)**:
  - Added `DEV_MOCK_REPORTS` mock store for offline dev/test execution.

---

### 3. Cryptographic and Privacy Guarantees Enforced

1. **Normal Message Store Invariant**: `public.messages` remains 100% ciphertext-only forever. No plaintext is written to the messaging tables.
2. **Sender Anonymity Towards Reporter**: The reporter never learns the sender's identity. The RPC response returns only `{ "success": true, "report_id": UUID }`.
3. **Decryption Exclusively Client-Side**: The server never holds or receives private encryption keys. Plaintext submitted with a report originates strictly from client-side decryption in browser volatile memory.
4. **Isolated Evidence Storage**: Disclosed plaintext exists strictly in `public.reports.disclosed_plaintext`, where direct table queries are blocked via RLS and direct grant revocations.

---

### 4. Plaintext Disclosure Mechanism Walkthrough

```
[Recipient Inbox]
       │
       ▼
[Click "Report"] ──► Opens ReportMessageDialog
       │
       ├── Decrypted message plaintext held in volatile RAM
       │
       ├── Plaintext Disclosure Checkbox: UNCHECKED BY DEFAULT
       │   "I agree to share the decrypted message text with organization moderators..."
       │
       ├── If user checks box:
       │     disclosePlaintext = true
       │     disclosedPlaintext = in-memory plaintext string
       │
       └── If user leaves unchecked (default):
             disclosePlaintext = false
             disclosedPlaintext = undefined (omitted)
       │
       ▼
[Server Action: submitMessageReportAction]
       │
       ├── Checks session & active org membership
       ├── Validates Zod schema
       ├── If disclosePlaintext == false:
       │     strips any plaintext, sends NULL to database
       │
       ▼
[PostgreSQL RPC: create_message_report]
       │
       ├── Checks DB constraint: CHECK (disclosed_plaintext IS NULL OR disclosed_plaintext_consent = true)
       └── Stores report in public.reports (disclosed_plaintext is NULL or sanitized string)
```

---

### 5. Concurrency and Rate Limiting Implementation Details

- **Concurrency Protection**:
  ```sql
  PERFORM pg_advisory_xact_lock(
    hashtext('report:' || v_caller_id::text || ':' || p_message_id::text)
  );
  ```
  Prevents duplicate report race conditions when rapid clicks or parallel requests hit the API simultaneously.
- **Sliding-Window Rate Limiting**:
  ```sql
  SELECT count(*) INTO v_recent_report_count
  FROM public.reports
  WHERE reporter_id = v_caller_id
    AND created_at > (timezone('utc'::text, now()) - INTERVAL '1 hour');

  IF v_recent_report_count >= 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'RATE_LIMITED: Report submission limit reached. Please try again later.');
  END IF;
  ```
  Prevents griefing and spamming of organization moderation queues.

---

### 6. Evidence Limit Rationale

Libsodium sealed boxes (`crypto_box_seal`) provide **sender anonymity towards recipients** using ephemeral Curve25519 keypairs. They do **not** generate cryptographic signatures of the sender:
- The disclosed message plaintext stored in `public.reports` is **recipient-provided evidence**, not cryptographic non-repudiation.
- A malicious recipient could theoretically modify in-memory plaintext before submission.
- Therefore, reported plaintext serves as corroborating context for organization moderators alongside message metadata (`message_id`, timestamps, and sender/recipient relationship verified in `public.messages`), rather than mathematically tamper-proof proof of authorship.

---

### 7. Test Suite Results

All tests pass cleanly with zero errors:
- **Unit & Schema Tests**: **288 / 288 passed** across 26 test suites:
  - [`src/lib/reporting/reporting.test.ts`](file:///c:/Users/HomePC/Documents/projects/cih%20message%20platform/src/lib/reporting/reporting.test.ts): 16 tests passing (validation bounds, consent checks, rate limits, zero sender exposure).
  - [`src/lib/supabase/migration-safety.test.ts`](file:///c:/Users/HomePC/Documents/projects/cih%20message%20platform/src/lib/supabase/migration-safety.test.ts): 24 tests passing (verifying Migration 10 and exact `complete_setup.sql` reproducibility).
- **E2E Smoke Tests**: **7 / 7 passed** (`playwright test`).
- **TypeScript**: `npm.cmd run typecheck` passed (0 errors).
- **ESLint**: `npm.cmd run lint` passed (0 warnings, 0 errors).
- **Production Build**: `npm.cmd run build` passed (14/14 optimized routes compiled).

---

### 8. Documentation Updates Completed

- **Created [`docs/reporting.md`](file:///c:/Users/HomePC/Documents/projects/cih%20message%20platform/docs/reporting.md)**: Exhaustive documentation covering reporting threat model, evidence limits, consent UX, schema, RPC definitions, and operational invariants.
- **Updated [`docs/database.md`](file:///c:/Users/HomePC/Documents/projects/cih%20message%20platform/docs/database.md)**: Added `public.reports` table specification and Migration 10 documentation.
- **Updated [`docs/inbox.md`](file:///c:/Users/HomePC/Documents/projects/cih%20message%20platform/docs/inbox.md)**: Added Section 5.5 detailing the Report Message action.
- **Updated [`docs/messaging.md`](file:///c:/Users/HomePC/Documents/projects/cih%20message%20platform/docs/messaging.md)**: Updated deferred work references.
- **Updated [`context/06-progress-tracker.md`](file:///c:/Users/HomePC/Documents/projects/cih%20message%20platform/context/06-progress-tracker.md)**: Added AD-020 and Prompt 010C session notes.

---

### 9. Scope Boundary Verification

- **Moderation Dashboard**: NOT implemented (reserved for Prompt 010D).
- **`moderation_actions` table**: NOT created (reserved for Prompt 010D).
- **Sanctions & Suspensions**: NOT implemented (reserved for Prompt 010D).
- **Strict Phase 2 Compliance**: Implementation strictly limited to report creation, consent capture, rate limiting, and evidence boundaries.

---

### 10. Recommended Next Steps for Prompt 010D

1. Implement `moderation_actions` audit log table.
2. Build organization moderation dashboard (`/app/moderation` or admin console).
3. Implement moderator resolution workflows (`investigating`, `resolved`, `dismissed`).
4. Implement graduated sanctions (temporary sending mute, account suspension).
5. Enforce immutable audit logs of all moderator actions.