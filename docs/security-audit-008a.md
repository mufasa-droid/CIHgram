# Security Audit Report: Recipient Inbox & Client-Side Decryption Pipeline (Prompt 008A)

**Audit Date**: October 9, 2026  
**Auditor Role**: Senior Application Security Engineer & Cryptographic Auditor  
**Scope**: Implementation of Prompt 008 (Recipient Inbox, Local Decryption & Privacy-Safe Message Actions)  
**Status**: Completed — All identified vulnerabilities remediated with regression tests passing.

---

## 1. Executive Summary & Overall Risk Assessment

This security audit conducted an exhaustive verification of the recipient inbox, sender anonymity boundaries, local in-memory decryption lifecycle, and message mutation routines implemented in Prompt 008. The audit inspected all client-side decryption flows, Next.js Server Actions, PostgreSQL security-barrier views, stored procedures, authorization gates, and browser state isolation.

### Overall Risk Assessment: **LOW (Post-Remediation) / READY TO PROCEED**
- **Sender Anonymity to Recipient**: **VERIFIED & UNCOMPROMISED**. The database security-barrier view `recipient_inbox_messages` and the `get_recipient_inbox` stored procedure completely omit `sender_id` and `organization_id`. Direct table privileges on `public.messages` remain strictly revoked from `anon` and `authenticated`.
- **Recipient Ownership & Isolation**: **VERIFIED**. `get_recipient_inbox` derives recipient identity strictly from verified session `auth.uid()`. Cross-user message queries and mutations (`mark_message_read`, `set_message_starred`, `delete_message_for_recipient`) are physically blocked by `recipient_id = auth.uid()` database predicates.
- **Key Vulnerabilities Identified & Remediated**:
  1. **SEC-009 (High)**: Keystore cross-account switching pollution. When a user logged out and a different user logged in on the same browser, lingering IndexedDB keys caused decryption failures and blocked key restoration. (**Remediated: Added server public-key validation in `decryptInboxMessages` and `initializeUserIdentity` to isolate and purge foreign keys, and added client-side keystore purge on sign-out in `WorkspaceHeader`**).
  2. **SEC-010 (High)**: Absence of organization membership check in inbox procedures. Suspended or unadmitted accounts could still invoke inbox procedures and view messages. (**Remediated: Created forward-only migration `20261008000007_harden_inbox_organization_boundary.sql` re-defining the security-barrier view and procedures to enforce `organization_members.status = 'active'`**).
  3. **SEC-011 (Low)**: Non-strict UTF-8 decoding in sealed box decryption. (**Remediated: Enforced `new TextDecoder('utf-8', { fatal: true })` in `decryptSealedBox`**).
  4. **SEC-012 (Informational)**: Inherent ECMAScript heap memory limitations regarding immutable string zeroization after logout. (**Documented: Threat model boundary formally analyzed and recorded**).

With all remediations applied and validated by **212 passing automated tests across 22 test suites** and **6 Playwright E2E tests**, the implementation satisfies all security, privacy, and architectural invariants.

---

## 2. Audit Findings Summary

| ID | Title | Severity | Status | Remediated File |
|---|---|---|---|---|
| **SEC-009** | Cross-account switching caused keystore state pollution and locked out incoming message recovery | **HIGH** | **RESOLVED** | `src/lib/messaging/inbox-service.ts`, `src/lib/crypto/identity.ts`, `src/components/shared/workspace-header.tsx` |
| **SEC-010** | Stored procedures and security barrier view lacked active organization membership checks (`status = 'active'`) | **HIGH** | **RESOLVED** | `supabase/migrations/20261008000007_harden_inbox_organization_boundary.sql`, `supabase/complete_setup.sql` |
| **SEC-011** | Sealed box decryption used permissive UTF-8 decoding without fatal error handling | **LOW** | **RESOLVED** | `src/lib/crypto/sealed-box.ts` |
| **SEC-012** | Immutable JavaScript strings cannot be zeroized in-place upon logout in browser engines | **INFORMATIONAL** | **ACKNOWLEDGED** | `docs/inbox.md`, `docs/security-audit-008a.md` |

---

## 3. Detailed Findings, Evidence & Remediations

### SEC-009: Keystore Cross-Account Switching Pollution
- **Severity**: **HIGH**
- **Evidence**:
  1. `src/lib/crypto/keystore.ts`: `StoredIdentityRecord` persisted a single key record under key `"active_identity"` without binding it to the authenticated session's user ID.
  2. `src/components/shared/workspace-header.tsx`: Sign-out was executed via native HTML `<form action="/auth/signout" method="POST">`, which cleared HTTP session cookies on the server but left IndexedDB `cih_keystore_v1` untouched in the client browser.
  3. `src/lib/messaging/inbox-service.ts`: `decryptInboxMessages` retrieved `getLocalIdentity()` without verifying if the stored public key matched the active public key of the currently logged-in user.
- **Attack Scenario & Impact**:
  User A logs into a shared browser workstation. User A's private key is stored in IndexedDB. User A signs out. User B logs into the same browser workstation. When User B visits `/inbox`, `decryptInboxMessages` loaded User A's private key and attempted to decrypt User B's incoming messages. Because User A's key does not match User B's ciphertext, all decryptions failed with *"This message could not be decrypted with your current key"*. Furthermore, because a local identity existed, `keyState` was evaluated as `"ready"` rather than `"missing_key"`, so User B was never shown the recovery phrase input to restore their own key.
- **Remediation**:
  1. Updated `decryptInboxMessages` to query `getUserKeyStatusAction()`. If `localPkBase64 !== activeServerPublicKey`, it recognizes that the local key belongs to a different account, aborts decryption with that key, sets `keyState = "missing_key"`, and prompts for recovery.
  2. Updated `initializeUserIdentity` to compare `localPkBase64` against `serverStatus.activePublicKey`. On mismatch, it automatically calls `clearLocalIdentity()` and transitions to `KEY_MISSING_RESTORE_REQUIRED`.
  3. Converted `WorkspaceHeader` to a client component with an asynchronous `onSubmit` handler that invokes `clearLocalIdentity()` to zeroize memory and purge IndexedDB before submitting the signout request.
- **Regression Test**: Automated in `src/lib/messaging/inbox-audit-008a.test.ts` (Section 1).

---

### SEC-010: Absence of Organization Membership Checks in Inbox Procedures & View
- **Severity**: **HIGH**
- **Evidence**:
  In `supabase/migrations/20261008000006_recipient_inbox_schema.sql`, the `recipient_inbox_messages` view and procedures (`get_recipient_inbox`, `mark_message_read`, `set_message_starred`, `delete_message_for_recipient`, `get_inbox_unread_count`) checked only `recipient_id = auth.uid()`. None verified that `auth.uid()` has an active membership in the organization (`organization_members.status = 'active'`).
- **Attack Scenario & Impact**:
  If an employee was suspended (`status = 'suspended'`) or removed from an organization, they could continue to invoke `/rest/v1/rpc/get_recipient_inbox` or query `/rest/v1/recipient_inbox_messages` via direct PostgREST calls to read messages sent to them within that organization. Furthermore, an account authenticated with an unauthorized domain could invoke inbox procedures despite having no active organization membership.
- **Remediation**:
  Created forward-only migration `supabase/migrations/20261008000007_harden_inbox_organization_boundary.sql`:
  1. Re-defined `recipient_inbox_messages` `WITH (security_barrier = true)` to include:
     ```sql
     AND EXISTS (
       SELECT 1 FROM public.organization_members om
       WHERE om.user_id = auth.uid()
         AND om.organization_id = m.organization_id
         AND om.status = 'active'
     )
     ```
  2. Re-defined `get_recipient_inbox` to verify caller active membership before execution and query strictly through the `recipient_inbox_messages` view.
  3. Re-defined `mark_message_read`, `set_message_starred`, and `delete_message_for_recipient` to verify active organization membership for the message's organization.
  4. Re-defined `get_inbox_unread_count` to query through `recipient_inbox_messages`.
- **Regression Test**: Automated in `src/lib/messaging/inbox-audit-008a.test.ts` (Section 3).

---

### SEC-011: Permissive UTF-8 Handling in Sealed Box Decryption
- **Severity**: **LOW**
- **Evidence**:
  In `src/lib/crypto/sealed-box.ts`, `decryptSealedBox` invoked `s.to_string(decryptedBytes)` from `libsodium-wrappers`. `s.to_string()` does not enforce strict UTF-8 with fatal error handling on invalid byte sequences, potentially substituting replacement characters (`\uFFFD`) or producing corrupt representations on malformed payloads.
- **Remediation**:
  Replaced `s.to_string(decryptedBytes)` with:
  ```typescript
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    return decoder.decode(decryptedBytes);
  } catch {
    throw new CryptoError("This message could not be decrypted with your current key.");
  }
  ```
  Any invalid UTF-8 sequence causes a strict `TypeError` that is caught and translated to the standard calm `CryptoError`.
- **Regression Test**: Automated in `src/lib/messaging/inbox-audit-008a.test.ts` (Section 2).

---

### SEC-012: In-Memory Plaintext String Immutability Limitation in JavaScript Engines
- **Severity**: **INFORMATIONAL**
- **Analysis**:
  In ECMAScript engines (V8 in Chromium/Node, JavaScriptCore in WebKit, SpiderMonkey in Gecko), strings are immutable heap primitives. Unlike binary buffers (`Uint8Array`) which can be zeroized in place using `sodium.memzero()`, strings cannot be overwritten in memory by JavaScript application code.
- **Implication**:
  When `RecipientInbox` unmounts or resets state, calling `setDecryptedMessages([])` clears references to decrypted message strings, making them eligible for garbage collection. However, until the browser engine reclaims and overwrites those memory pages, strings may persist in raw process RAM. An attacker with OS-level memory inspection or a full process core dump could theoretically extract historical strings prior to GC.
- **Mitigation & Disposition**:
  This is a fundamental constraint of web browsers and client-side web application architectures. Formally documented in `docs/inbox.md` and this report. Users on shared devices should log out and close browser windows.

---

## 4. Security Boundary Audit Matrix

### A. Recipient Authorization Boundary
- **Session Anchor**: All operations resolve caller identity strictly from verified session `auth.uid()`. Client-supplied user identifiers are completely ignored.
- **Table Permissions**: Direct `SELECT`, `INSERT`, `UPDATE`, `DELETE` operations on `public.messages` remain completely revoked from `anon` and `authenticated`.
- **Cross-User Protection**: A user cannot read, mark as read, star, or delete another recipient's messages. All SQL procedures enforce `WHERE id = p_message_id AND recipient_id = auth.uid()`.

### B. Sender Anonymity Boundary
- **Security Barrier View**: `public.recipient_inbox_messages` projects strictly:
  `id`, `recipient_id`, `ciphertext`, `key_id`, `protocol_version`, `created_at`, `is_read`, `is_starred`.
- **Omission Guarantee**: `sender_id` and `organization_id` are absent from both the database view and the TypeScript `RecipientInboxMessage` DTO.
- **Side-Channel Mitigation**: `WITH (security_barrier = true)` guarantees that PostgreSQL evaluates the view's security conditions before any user-supplied filters or functions, preventing side-channel data leakage.
- **UI & Telemetry Hygiene**: Error responses, log events, and HTML accessibility attributes contain zero sender metadata.

### C. End-to-End Cryptography & Key Management
- **Zero Plaintext Storage**: Plaintext is never stored in the database, logged in telemetry, or sent over network requests.
- **Client-Side Decryption**: Decryption occurs solely inside the browser using Libsodium Sealed Box (`crypto_box_seal_open`) with private keys loaded from IndexedDB.
- **Decryption Failure Isolation**: Individual corrupted messages fail locally without failing the entire batch or displaying raw ciphertext.
- **No Silent Overwrites**: Missing or mismatched keys require explicit recovery phrase restoration via `restoreIdentity()`.

---

## 5. Verification Commands & Test Results

The following test suites and verification checks were executed:

1. **TypeScript Compilation Check**:
   ```powershell
   npm.cmd run typecheck
   ```
   **Result**: `0 errors` (TypeScript strict mode passed).

2. **ESLint Code Quality Check**:
   ```powershell
   npm.cmd run lint
   ```
   **Result**: `0 errors, 0 warnings`.

3. **Vitest Unit, Integration & Schema Test Suite**:
   ```powershell
   npm.cmd test -- --run
   ```
   **Result**: **212 / 212 passed** across 22 test suites:
   - `src/lib/messaging/inbox-audit-008a.test.ts`: 9 tests passed (cross-account isolation, UTF-8 strictness, migration 007 verification).
   - `src/lib/messaging/inbox.test.ts`: 13 tests passed (Server Actions and anonymity invariants).
   - `src/lib/messaging/inbox-service.test.ts`: 5 tests passed (client-side decryption orchestrator).
   - `src/lib/supabase/inbox-schema.test.ts`: 16 tests passed (migration 006 schema verification).
   - `src/lib/supabase/migration-safety.test.ts`: 10 tests passed (reproducibility across all 8 migrations).
   - `src/components/inbox/recipient-inbox.test.tsx`: 7 tests passed (71UI component lifecycle).
   - All 16 other cryptographic, admission, and messaging suites: 152 tests passed.

4. **Next.js Production Build**:
   ```powershell
   npm.cmd run build
   ```
   **Result**: All 13 routes compiled successfully with Turbopack.

5. **Playwright E2E Smoke Tests**:
   ```powershell
   npm.cmd test:e2e
   ```
   **Result**: **6 / 6 passed** (including authenticated route guards for `/inbox` and `/app/inbox`).

---

## 6. Files Inspected & Modified During Audit

### Files Inspected (Read-Only Audit Phase):
- `supabase/migrations/20261008000006_recipient_inbox_schema.sql`
- `src/lib/messaging/actions.ts`
- `src/lib/messaging/inbox-service.ts`
- `src/lib/messaging/validation.ts`
- `src/lib/messaging/types.ts`
- `src/components/inbox/recipient-inbox.tsx`
- `src/components/shared/workspace-header.tsx`
- `src/lib/crypto/sealed-box.ts`
- `src/lib/crypto/identity.ts`
- `src/lib/crypto/keystore.ts`
- `skills/design.md` (71UI design specifications)

### Files Modified with Security Remediations:
- `src/lib/crypto/sealed-box.ts`: Enforced strict `TextDecoder('utf-8', { fatal: true })` in `decryptSealedBox`.
- `src/lib/crypto/identity.ts`: Hardened `initializeUserIdentity` to validate local identity against server key status and clear foreign keys.
- `src/lib/messaging/inbox-service.ts`: Added cross-account key mismatch validation against server key status.
- `src/components/shared/workspace-header.tsx`: Added client-side keystore purge on sign-out.
- `supabase/migrations/20261008000007_harden_inbox_organization_boundary.sql`: Created forward-only migration adding organization membership checks to view and procedures.
- `supabase/complete_setup.sql`: Appended migration 007.
- `src/lib/supabase/migration-safety.test.ts`: Updated migration list.
- `src/lib/messaging/inbox-audit-008a.test.ts`: Created new regression test suite (9 tests).
- `docs/inbox.md` & `docs/database.md`: Updated architecture and security documentation.

---

## 7. Final Disposition & Readiness

**GO FOR REVIEW & APPROVAL**. The recipient inbox and client-side decryption pipeline satisfies all security, privacy, and architectural invariants. All identified vulnerabilities have been remediated, verified with automated tests, and documented.

Prompt 008 is verified and ready for sign-off. Do not begin Prompt 009 until authorized.
