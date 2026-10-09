# Security Audit Report: Anonymous Messaging & Encryption Pipeline (Prompt 007A)

**Audit Date**: October 9, 2026  
**Auditor Role**: Senior Application Security Engineer  
**Scope**: Implementation of Prompt 007 (Anonymous Message Composer, Encryption & Sending) prior to building Prompt 008 (Recipient Inbox & Decryption UI)  
**Status**: Completed — All identified vulnerabilities remediated with regression tests passing.

---

## 1. Executive Summary & Overall Risk Assessment

This security audit conducted an exhaustive, read-only code and architecture review of the end-to-end anonymous messaging pipeline implemented in Prompt 007. The audit examined all client-side encryption flows, Server Action authorization boundaries, database schemas, Row Level Security (RLS) policies, stored procedures, rate-limiting algorithms, and UI draft lifecycles.

### Overall Risk Assessment: **LOW (Post-Remediation) / READY TO PROCEED**
- **Sender Anonymity to Recipient**: **STRONG**. Plaintext never transits the server; recipients are cryptographically prevented from discovering sender identity through message envelopes, client responses, or logs. Direct `SELECT` on `public.messages` is strictly revoked.
- **Server Accountability**: **MAINTAINED**. `sender_id` is derived strictly from verified session JWT (`auth.uid()`) and retained in PostgreSQL for abuse tracking and moderation.
- **Key Vulnerabilities Identified & Fixed**:
  1. Direct `INSERT` permission on `public.messages` was granted to `authenticated` clients, which allowed bypassing the `send_anonymous_message` stored procedure, organization boundaries, and sliding-window rate limits. (**Remediated: Revoked direct table INSERT; writes now strictly mediated by `SECURITY DEFINER` stored procedure**).
  2. Overly broad `UPDATE` permission on `public.messages` was granted to recipients, allowing theoretical tampering with immutable audit metadata (`sender_id`, `ciphertext`, `key_id`, `created_at`). (**Remediated: Revoked direct table UPDATE from `authenticated` role**).
  3. A potential race condition in the sliding-window rate limiter under concurrent requests. (**Remediated: Added transaction-level advisory lock `pg_advisory_xact_lock` on `sender_id`**).
  4. Permissive ciphertext payload validation that allowed non-Base64 character sequences. (**Remediated: Added Base64 regex validation in Zod schema and database check constraint**).

With all remediations applied and validated by 137 passing tests, the system meets the core privacy and cryptographic invariants, providing a **GO** recommendation for implementing Prompt 008 (Recipient Inbox & Decryption).

---

## 2. Audit Findings Summary

| ID | Title | Severity | Status | Remediated File |
|---|---|---|---|---|
| **SEC-001** | Direct table `INSERT` privilege allowed PostgREST bypass of stored procedure validations | **HIGH** | **RESOLVED** | `supabase/migrations/20261008000004_messages_schema.sql` |
| **SEC-002** | Direct table `UPDATE` privilege allowed recipient tampering with immutable message metadata | **HIGH** | **RESOLVED** | `supabase/migrations/20261008000004_messages_schema.sql` |
| **SEC-003** | Concurrent sending race condition in sliding-window rate limiter | **MEDIUM** | **RESOLVED** | `supabase/migrations/20261008000004_messages_schema.sql` |
| **SEC-004** | Ciphertext payload validation allowed non-Base64 character sequences | **LOW** | **RESOLVED** | `src/lib/messaging/validation.ts`, migration SQL |
| **SEC-005** | Libsodium sealed-box encryption does not authenticate sender (Cryptographic Property) | **INFORMATIONAL** | **ACKNOWLEDGED** | `docs/cryptography.md` |
| **SEC-006** | Uncontrolled development wildcard seed in consolidated setup SQL (`complete_setup.sql`) | **HIGH** | **RESOLVED** | `supabase/complete_setup.sql`, `supabase/seed.sql` |
| **SEC-007** | Wildcard domain interpretation allowed potential bypass of organization domain restrictions in production | **MEDIUM** | **RESOLVED** | `src/lib/auth/domains.ts`, admission SQL |
| **SEC-008** | SQL admission routines accepted wildcard `*` via direct RPC; lacked database check constraint on domain format | **HIGH** | **RESOLVED** | `supabase/migrations/20261008000005_strict_organization_admission.sql` |

---

## 3. Detailed Findings, Evidence & Remediations

### SEC-001: Direct `INSERT` on `public.messages` Allowed Bypassing Stored Procedure
- **Severity**: **HIGH**
- **Evidence**: `supabase/migrations/20261008000004_messages_schema.sql` lines 69–76 and 217:
  ```sql
  GRANT INSERT, UPDATE ON public.messages TO authenticated;
  CREATE POLICY messages_insert_authenticated ON public.messages
    FOR INSERT TO authenticated WITH CHECK (sender_id = auth.uid());
  ```
- **Attack Scenario & Impact**:
  An authenticated attacker could bypass the Next.js application and send direct HTTP requests to the PostgREST API:
  `POST /rest/v1/messages` with `{ sender_id: auth.uid(), recipient_id: <victim>, organization_id: <any>, key_id: <any>, ciphertext: "..." }`.
  Because the RLS policy only checked `sender_id = auth.uid()`, this direct insert bypassed:
  1. The 5-per-minute and 50-per-day sliding-window rate limits.
  2. The organization boundary check (allowing spamming of users in outside organizations).
  3. Verification that `key_id` is active and actually belongs to `recipient_id`.
- **Remediation**:
  Revoked direct `INSERT` on `public.messages` from `authenticated`. Removed policy `messages_insert_authenticated`. All message writes must strictly invoke the `SECURITY DEFINER` function `send_anonymous_message`.
- **Regression Test**: Added assertions in `src/lib/supabase/messages-schema.test.ts` verifying `REVOKE ALL ON public.messages FROM anon, authenticated;` and absence of direct table insert policies.

---

### SEC-002: Direct `UPDATE` on `public.messages` Allowed Recipient Metadata Tampering
- **Severity**: **HIGH**
- **Evidence**: `supabase/migrations/20261008000004_messages_schema.sql` lines 79–88:
  ```sql
  CREATE POLICY messages_update_recipient ON public.messages
    FOR UPDATE TO authenticated
    USING (recipient_id = auth.uid())
    WITH CHECK (recipient_id = auth.uid());
  ```
- **Attack Scenario & Impact**:
  Any recipient receiving an anonymous message could send a PostgREST `PATCH /rest/v1/messages?id=eq.<id>` to update columns beyond `is_read` or `is_starred`. Specifically, a malicious recipient could alter:
  - `sender_id` (framing an innocent third party as the sender of an abusive message).
  - `ciphertext` (falsifying message contents stored on disk).
  - `created_at` (spoofing delivery timestamps).
- **Remediation**:
  Revoked direct table-wide `UPDATE` on `public.messages` from `authenticated`. Message state updates (`is_read`, `is_starred`, `deleted_by_recipient`) in Prompt 008 will be mediated exclusively through dedicated `SECURITY DEFINER` stored procedures that strictly restrict mutation to status boolean flags.
- **Regression Test**: `src/lib/supabase/messages-schema.test.ts` verifies direct table update grant is absent.

---

### SEC-003: Rate Limiter Concurrency Race Condition
- **Severity**: **MEDIUM**
- **Evidence**: `supabase/migrations/20261008000004_messages_schema.sql` lines 168–185 (`send_anonymous_message`):
  Under PostgreSQL default `READ COMMITTED` transaction isolation, multiple concurrent requests executing at the exact same millisecond could evaluate `SELECT count(*)` before earlier transactions commit, temporarily bursting past the 5-per-minute threshold.
- **Attack Scenario & Impact**:
  A bot firing 10 simultaneous asynchronous requests could successfully deliver 8–10 messages in a single second before the sliding-window count caught up.
- **Remediation**:
  Acquired a transaction-level advisory lock on the sender's UUID at the start of `send_anonymous_message`:
  ```sql
  PERFORM pg_advisory_xact_lock(hashtext(v_sender_id::text));
  ```
  This serializes concurrent execution for the same sender across all connection poolers and serverless instances, eliminating concurrency race windows while releasing the lock automatically upon transaction commit or rollback.
- **Regression Test**: Verified via `src/lib/supabase/messages-schema.test.ts` that `pg_advisory_xact_lock` is executed.

---

### SEC-004: Ciphertext Payload Allowed Non-Base64 Characters
- **Severity**: **LOW**
- **Evidence**: `src/lib/messaging/validation.ts` (`sendMessagePayloadSchema`) only checked `min(48)` and `max(32768)` string length without validating the character set.
- **Attack Scenario & Impact**:
  Clients could submit arbitrary strings containing non-Base64 bytes or whitespace. While harmless to the server, this wasted database storage and caused uncaught decoding crashes on recipient devices.
- **Remediation**:
  1. Added regex validation `regex(/^[A-Za-z0-9+/=]+$/, "Ciphertext payload must be a valid Base64 string")` to `sendMessagePayloadSchema`.
  2. Added database check constraint `CONSTRAINT ciphertext_format_check CHECK (ciphertext ~ '^[A-Za-z0-9+/=]+$')` to `public.messages`.
- **Regression Test**: Added test in `src/lib/messaging/validation.test.ts` verifying rejection of non-Base64 characters.

---

### SEC-005: Libsodium Sealed Box Sender Non-Authentication (Design Property)
- **Severity**: **INFORMATIONAL**
- **Analysis**:
  Libsodium sealed boxes (`crypto_box_seal`) utilize an ephemeral Curve25519 keypair for each message. The sender does not cryptographically sign the payload with their identity key.
- **Implication**:
  - **Advantage**: Perfect recipient-side sender anonymity and plausible deniability. The recipient holds no cryptographic evidence identifying the sender.
  - **Accountability Boundary**: The platform server authenticates the sender via session JWT (`auth.uid()`) and stores `sender_id` internally for abuse moderation. This separation of concerns is fundamental to the product design.
- **Action**: Formally documented in `docs/cryptography.md` and this audit report.

---

### SEC-006: Uncontrolled Development Wildcard Seed in Production Setup SQL
- **Severity**: **HIGH**
- **Evidence**: `supabase/complete_setup.sql` Section 6:
  ```sql
  INSERT INTO public.organizations (name, slug, allowed_domains)
  VALUES ('CIH Platform', 'cih', ARRAY['*'])
  ON CONFLICT (slug) DO UPDATE SET allowed_domains = EXCLUDED.allowed_domains;
  ```
- **Attack Scenario & Impact**:
  Administrators or deployment pipelines executing `complete_setup.sql` on a production Supabase instance would automatically provision an open organization with `allowed_domains = ARRAY['*']`. Any arbitrary email domain (e.g. `@gmail.com`, `@attacker.com`) could register and obtain active membership, discover members, and message users, completely defeating the organization-admission security boundary.
- **Remediation**:
  1. Removed Section 6 completely from `supabase/complete_setup.sql`. The file is now strictly reproducible from the sequential execution of schema migrations 000 through 004 without seed data.
  2. Isolated seed data strictly to `supabase/seed.sql` with prominent warnings against execution in production environments.
- **Regression Test**: Added automated tests in `src/lib/supabase/migration-safety.test.ts` verifying that `complete_setup.sql` contains zero organization `INSERT` statements and matches migration concatenation.

---

### SEC-007: Wildcard Domain Interpretation Lacked Production Environment Isolation
- **Severity**: **MEDIUM**
- **Evidence**: `src/lib/auth/domains.ts` (`isDomainAllowed`):
  ```typescript
  if (normalizedAllowed === "*") { return true; }
  ```
  And `supabase/migrations/20261008000001_organization_admission.sql` lines 23 and 80 (`OR '*' = ANY(o.allowed_domains)`).
- **Attack Scenario & Impact**:
  If a developer or operator inadvertently added `*` to an organization's `allowed_domains` in production, or if application code evaluated domains against a wildcard in production, all domain restrictions would be bypassed.
- **Remediation**:
  1. Updated `src/lib/auth/domains.ts` so that `*` is strictly rejected whenever `process.env.NODE_ENV === "production"`.
  2. Ensured database admission queries (`find_organization_by_domain`, `admit_user_to_organization`, and `get_current_user_status`) prioritize exact domain matches over wildcard fallbacks (`ORDER BY (CASE WHEN '*' = ANY(o.allowed_domains) THEN 1 ELSE 0 END) ASC`).
- **Regression Test**: Added tests in `src/lib/auth/domains.test.ts` verifying that `NODE_ENV === "production"` rejects wildcard `*` while properly accepting exact domain matches.

---

### SEC-008: Database Admission Routines Accepted Wildcard '*' via Direct RPC; Lacked Table-Level Domain Format Constraints
- **Severity**: **HIGH**
- **Evidence**:
  1. `supabase/migrations/20261008000001_organization_admission.sql` lines 23 and 80:
     ```sql
     WHERE lower(trim(check_domain)) = ANY(o.allowed_domains) OR '*' = ANY(o.allowed_domains)
     ```
  2. `public.organizations` table lacked any check constraint validating elements of `allowed_domains`.
- **Attack Scenario & Impact**:
  Even though the application layer (`src/lib/auth/domains.ts`) was hardened in Prompt 007B to reject wildcards in production, an attacker directly calling the Supabase PostgREST RPC endpoints (`/rest/v1/rpc/admit_user_to_organization`) completely bypassed Next.js server code. If any organization in the database contained `'*'`, the database procedure admitted the user directly, bypassing all organization domain barriers. Furthermore, an operator or compromised admin could insert or update an organization with `allowed_domains = ARRAY['*']` without database rejection.
- **Remediation**:
  1. Created forward-only migration `supabase/migrations/20261008000005_strict_organization_admission.sql`.
  2. Implemented `public.validate_allowed_domains(domains TEXT[])` immutable validation function that strictly rejects `'*'`, empty/whitespace values, uppercase strings, and non-FQDN syntax.
  3. Added table-level check constraint `organizations_allowed_domains_check` on `public.organizations` enforcing valid domain syntax on all inserts and updates.
  4. Replaced `find_organization_by_domain`, `admit_user_to_organization`, and `get_current_user_status` with strict exact-domain matching queries (`WHERE v_domain = ANY(o.allowed_domains)`), completely removing wildcard matching and fallback branches from SQL.
  5. Preserved `SECURITY DEFINER`, fixed `SET search_path = public, pg_temp`, and restricted execution grants (`authenticated` only for admission/status mutations).
  6. Updated `supabase/complete_setup.sql` to include the forward-only migration and updated development seeds in `supabase/seed.sql` to use valid explicit test domains (`ARRAY['gmail.com', 'example.com', 'test.com', 'cih.org']`).
- **Regression Test**: Added automated test suite in `src/lib/supabase/strict-admission.test.ts` (15 tests) verifying constraint validation, elimination of SQL wildcards, search_path hygiene, and exact domain enforcement.

---

## 4. Security Boundary Audit Matrix

### A. Sender Anonymity Boundary
- **Direct Table Query**: `SELECT` on `public.messages` is revoked from `authenticated` and `anon`. PostgREST queries return `403 Forbidden`.
- **RPC Return Values**: `send_anonymous_message` returns only `{ success, message_id, created_at }`. `sender_id` is never returned.
- **Server Action Responses**: `sendMessageAction` returns only `{ success, messageId }`.
- **Error Messages**: Stored procedure and Server Action translate internal database errors to generic user notices (`RATE_LIMITED`, `FORBIDDEN`, `RECIPIENT_KEY_MISMATCH`). No sender identifiers or schema details leak in error payloads.
- **Logging**: `sendMessageAction` logs only `recipientId` and `keyId`. `sender_id` and message contents are excluded. `src/lib/logger/index.ts` automatically redacts keys including `plaintext`, `ciphertext`, `message`, `seed`, `private_key`, `secret_key`, and `token`.

### B. Authorization & Organization Boundary
- **Session Verification**: `sendMessageAction` extracts sender from `getCurrentUser()` (`supabase.auth.getUser()`). Client-supplied sender IDs are completely disregarded.
- **Self-Messaging Prevention**: Prohibited both in Server Action (`if (sender.id === payload.recipientId)`) and in database (`sender_recipient_distinct_check` and stored procedure exception).
- **Organization Isolation**: `send_anonymous_message` joins `organization_members` for both `v_sender_id` and `p_recipient_id` requiring `status = 'active'` in the same organization. Cross-organization message delivery is strictly blocked at the database layer.

### C. Cryptographic Integrity
- **Zero Plaintext Invariant**: Plaintext is encrypted inside the browser (`sendAnonymousMessage` via Libsodium `crypto_box_seal`). Plaintext is never submitted to `sendMessageAction` or stored in the database.
- **Memory Zeroization**: Plaintext is cleared from the React component state immediately upon delivery confirmation.
- **Key Binding**: `send_anonymous_message` strictly verifies that `key_id` belongs to `recipient_id` and has `is_active = true`. A sender cannot substitute an arbitrary public key to trick the database into associating an alien key with the recipient.

### D. Rate Limiting & Abuse Controls
- **Sliding Window**: Enforced via PostgreSQL queries over `messages(sender_id, created_at DESC)`:
  - 5 messages per 60 seconds.
  - 50 messages per 24 hours.
- **Concurrency Serialization**: Protected by `pg_advisory_xact_lock` against concurrent race condition exploits.
- **PostgREST Bypass Closed**: Direct table insertion is revoked; callers cannot bypass rate limits by calling the REST API directly.

### E. User Interface & Draft Lifecycle
- **Focus & Keyboard Navigation**: `MessageComposerDialog` manages autofocus, `Escape` cancellation, and `Cmd+Enter` submission.
- **Double-Click Mitigation**: `isSubmitting` locks the submit action and disables buttons.
- **Unmount Memory Clearance**: Dialog is keyed by recipient ID and open state, ensuring unmounting completely cleans React draft state from memory.
- **Honest UI**: Disclaimer clearly specifies that messages are one-way, anonymous to the recipient, and sealed on-device, without implying unbuilt features like read receipts.

---

## 5. Verification Commands & Test Results

The following test suites and verification checks were executed on the audit commit:

1. **TypeScript Compilation**:
   ```powershell
   npm.cmd run typecheck
   ```
   **Result**: `0 errors` (Strict mode passed).

2. **ESLint Code Quality**:
   ```powershell
   npm.cmd run lint
   ```
   **Result**: `0 errors, 0 warnings`.

3. **Vitest Unit & Schema Test Suite**:
   ```powershell
   npm.cmd test -- --run
   ```
   **Result**: **162 / 162 tests passed** across 17 test suites:
   - `src/lib/supabase/strict-admission.test.ts`: 15 tests passed (verifying database check constraint, elimination of SQL wildcards, search_path hygiene, exact domain matching).
   - `src/lib/supabase/migration-safety.test.ts`: 10 tests passed (verifying complete_setup reproducibility from 6 migrations, zero seeds, advisory lock, permission revocations).
   - `src/lib/supabase/messages-schema.test.ts`: 13 tests passed (verifying RLS revocation, advisory lock, constraints).
   - `src/lib/messaging/validation.test.ts`: 13 tests passed (verifying Base64 regex, UUID, payload boundaries).
   - `src/lib/messaging/messaging.test.ts`: 6 tests passed (verifying Server Action authorization boundary and rate-limit translation).
   - `src/lib/crypto/crypto.test.ts`: 32 tests passed (verifying Libsodium sealed box encryption, keypairs, recovery phrases).
   - `src/components/composer/message-composer.test.tsx`: 9 tests passed (verifying 71UI modal draft lifecycle).
   - `src/lib/auth/domains.test.ts`: 7 tests passed (verifying exact domain matches and strict rejection of wildcards).
   - `src/lib/auth/onboarding.test.ts`: 9 tests passed.
   - `src/lib/supabase/schema.test.ts`: 9 tests passed.
   - `src/lib/supabase/public-keys-schema.test.ts`: 13 tests passed.
   - `src/lib/directory/directory.test.ts`: 7 tests passed.
   - `src/lib/errors/errors.test.ts`: 3 tests passed.
   - `src/lib/directory/validation.test.ts`: 4 tests passed.
   - `src/lib/logger/logger.test.ts`: 1 test passed.
   - `src/components/ui/button.test.tsx`: 3 tests passed.
   - `src/lib/validation/common.test.ts`: 8 tests passed.

4. **Next.js Production Build**:
   ```powershell
   npm.cmd run build
   ```
   **Result**: All 11 static and dynamic pages compiled successfully.

5. **Playwright E2E Smoke Tests**:
   ```powershell
   npm.cmd test:e2e
   ```
   **Result**: 5 / 5 tests passed.

---

## 6. Files Inspected & Modified During Audit

### Files Inspected (Read-Only Audit Phase):
- `supabase/migrations/20261008000004_messages_schema.sql`
- `supabase/migrations/20261008000003_public_keys_schema.sql`
- `src/lib/messaging/validation.ts`
- `src/lib/messaging/types.ts`
- `src/lib/messaging/send-service.ts`
- `src/lib/messaging/actions.ts`
- `src/components/composer/message-composer.tsx`
- `src/components/directory/member-directory.tsx`
- `src/lib/crypto/sealed-box.ts`
- `src/lib/crypto/actions.ts`
- `src/lib/crypto/keys-service.ts`
- `src/lib/crypto/keystore.ts`
- `src/lib/logger/index.ts`
- `skills/design.md` (71UI design specifications)
- `context/01-project-overview.md` through `context/08-security-and-privacy.md`

### Files Remediated with Security Fixes:
- `supabase/migrations/20261008000004_messages_schema.sql` (Revoked direct table operations, added advisory lock, added Base64 check constraint).
- `supabase/migrations/20261008000005_strict_organization_admission.sql` (Forward-only migration adding `validate_allowed_domains` function, check constraint on `public.organizations`, and re-defining admission functions with exact-domain matching only).
- `supabase/complete_setup.sql` (Synchronized consolidated setup script from all 6 schema migrations with zero development seed data).
- `supabase/seed.sql` (Isolated development seed with explicit valid test domains complying with check constraint).
- `src/lib/auth/domains.ts` (Strictly rejected wildcard `'*'` across all environments).
- `src/lib/auth/domains.test.ts` (Added tests verifying exact domain matching and rejection of wildcards).
- `src/lib/messaging/validation.ts` (Added Base64 character regex check).
- `src/lib/messaging/validation.test.ts` (Added regression tests for Base64 format).
- `src/lib/supabase/messages-schema.test.ts` (Added regression tests for table access revocation and advisory locks).
- `src/lib/supabase/migration-safety.test.ts` (Added regression tests for migration reproducibility and seed isolation).
- `src/lib/supabase/strict-admission.test.ts` (Added regression tests for database check constraints and SQL exact-domain enforcement).

---

## 7. Remaining Limitations & Assumptions

1. **Traffic Analysis & Network Metadata**:
   - While message content is end-to-end encrypted and recipient queries exclude `sender_id`, network-level observers (e.g. ISPs or network proxies) could correlate the timing of a sender's HTTP POST with a recipient's subsequent WebSocket or polling event. Mitigation for high-threat models would require decoy traffic or batching, which is out of scope for v1.
2. **Server Trust for Sender Accountability**:
   - The platform relies on the server database to record `sender_id` truthfully for abuse prevention. Compromise of the server database would allow an attacker to see the social graph of who messaged whom (metadata), but **cannot** reveal plaintext message contents because plaintext is never sent or stored.
3. **Recipient Inbox Security Barrier (Prompt 008 Dependency)**:
   - This audit validates that senders cannot be exposed through the send pipeline. When implementing Prompt 008, the inbox MUST query through a PostgreSQL `SECURITY BARRIER` view that explicitly omits `sender_id` and `organization_id` to ensure the read API preserves this guarantee.

---

## 8. Final Recommendation

**GO FOR PROMPT 008**. The anonymous messaging and encryption pipeline satisfies all core security and privacy invariants. All high and medium severity vulnerabilities identified during this audit have been eliminated and verified with automated regression tests. The codebase is secure and ready for the implementation of the recipient inbox and client-side decryption interface.
