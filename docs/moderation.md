# Moderation Dashboard, Report Review & Auditable Enforcement Architecture

## 1. Overview & Core Product Invariants

The Moderation subsystem provides designated organization administrators and moderators with a secure, auditable console (`/moderation`) to review user reports, inspect consented message evidence, issue formal warnings, and enforce account suspensions.

### Non-Negotiable Invariants:
1. **Server Plaintext Isolation Maintained**: Normal message transport and persistence in `public.messages` remains 100% end-to-end encrypted. The server NEVER automatically decrypts messages.
2. **Voluntary Plaintext Context with Safeguards**: Decrypted plaintext is available only if the reporting recipient explicitly consented at submission time (`disclosed_plaintext_consent = true`). Queue listings NEVER return message plaintexts; plaintexts are visible strictly in the authorized report detail view.
3. **Evidence Boundary**: Voluntary decrypted plaintext is recipient-supplied context and not cryptographically non-repudiable proof of sender authorship (anonymized sealed boxes omit sender cryptographic signatures). The UI prominently warns moderators of this limitation.
4. **Single Source of Truth for Account Status**: Sanctions reuse `public.organization_members.status` (`'active'` vs `'suspended'`). No parallel status flags or shadow moderation states are created. Suspending an account immediately terminates message transmission, inbox access, directory discovery, reporting, and moderation access.
5. **Tamper-Evident, Append-Only Audit History**: All report resolutions, dismissals, warnings, suspensions, and reactivations are permanently logged to `public.moderation_actions`. Direct write access is revoked; records are created strictly through `SECURITY DEFINER` stored procedures.
6. **Role Hierarchy & Self-Moderation Guard**: Users cannot apply moderation actions to themselves (`CANNOT_MODERATE_SELF`). Moderators cannot sanction or moderate organization administrators (`INSUFFICIENT_PRIVILEGES`).

---

## 2. Authorization Model & Role Hierarchy

Moderator privileges are verified in PostgreSQL via `public.is_org_moderator_or_admin(lookup_org_id, lookup_user_id)`:

```sql
SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.organization_id = lookup_org_id
      AND om.user_id = lookup_user_id
      AND om.role IN ('admin', 'moderator')
      AND om.status = 'active'
);
```

### Privileges by Role:
- **Admin**: Full authority to review all organization reports, update statuses, issue warnings, suspend users and moderators, and reactivate accounts.
- **Moderator**: Authority to review reports, update statuses, issue warnings, and suspend standard members. Cannot sanction administrators.
- **Member**: Access denied at middleware, server action, and database levels (returns `FORBIDDEN`).
- **Suspended Moderator / Admin**: Automatically locked out of all moderation functions due to the `status = 'active'` check.

---

## 3. Moderation Workflow & Queue Lifecycle

```text
[ Report Submitted ] (status: pending)
        │
        ▼
[ Queue View: /moderation ]
  - Filter by category / status
  - Plaintext withheld (hasDisclosedPlaintext indicator only)
  - Target identity displayed as public_id + @username
        │
        ▼ (Moderator clicks report)
[ Report Detail Dialog ]
  - Consented plaintext loaded on demand (if consent = true)
  - Cryptographic evidence disclaimer rendered
  - Reporter identity remains strictly masked
        │
        ├─────────────────────────────┬─────────────────────────────┐
        ▼                             ▼                             ▼
[ Investigate ]               [ Resolve / Dismiss ]         [ Apply Sanction ]
  - Transition status           - Transition status           - Issue formal warning
  - Mandatory audit reason      - Mandatory audit reason      - Suspend member
  - Appended to audit log       - Appended to audit log       - Reactivate member
                                                              - Resolves report atomically
```

### Report Status Lifecycle:
- `pending`: Newly submitted report awaiting review.
- `investigating`: Under active investigation by an organization moderator.
- `resolved`: Addressed with corrective action (warning, suspension, or verified resolution).
- `dismissed`: Determined to be invalid, spam, or non-actionable.

Every status transition requires a substantive justification (3–1,000 characters) and is serialized using PostgreSQL advisory locks (`resolve_report:report_id`) to prevent race conditions.

---

## 4. Plaintext Evidence Protection & Minimization

| View / API | Plaintext Exchanged | Target Identity | Reporter Identity |
| :--- | :---: | :---: | :---: |
| `get_organization_reports` (Queue) | **Never** (`disclosed_plaintext` omitted) | `public_id`, `@username`, `display_name` | Masked (`reporter_id` omitted) |
| `get_report_details` (Detail Dialog) | Consented only (`disclosed_plaintext_consent = true`) | `public_id`, `@username`, `display_name`, `status` | Masked (`reporter_id` omitted) |
| `get_moderation_actions` (Audit Log) | **Never** | `target_public_id`, `@username` | N/A (`moderator_public_id` attributed) |

### Evidence Disclaimer Banner:
In accordance with platform security invariants, the report detail modal displays:
> "Voluntary Decrypted Message Context — This plaintext was provided voluntarily by the recipient upon filing this report. While helpful for contextual review, note that anonymous sealed-box messages do not carry cryptographic sender signatures on the server."

---

## 5. Account Suspension Semantics

Account suspension operates directly on `public.organization_members.status`:

```sql
UPDATE public.organization_members
SET status = 'suspended', updated_at = NOW()
WHERE organization_id = v_org_id AND user_id = v_target_user_id;
```

Because all core platform functions enforce active membership (`om.status = 'active'`), setting `status = 'suspended'` automatically and immediately enforces:
1. **Message Sending Blocked**: `send_anonymous_message` fails with `SENDER_INACTIVE`.
2. **Inbox Access Blocked**: `get_recipient_inbox` and `recipient_inbox_messages` fail with `UNAUTHORIZED_OR_INACTIVE`.
3. **Directory Search Excluded**: `search_organization_members` filters out inactive/suspended accounts.
4. **Public Key Retrieval Blocked**: `get_active_public_key` fails with `RECIPIENT_INACTIVE`.
5. **Reporting Blocked**: `create_message_report` fails with `REPORTER_INACTIVE`.
6. **Moderation Console Blocked**: `is_org_moderator_or_admin` returns `FALSE`.

Reactivating an account (`action_type = 'reactivate_user'`) sets `status = 'active'` and logs a corresponding audit event.

---

## 6. Database Schema (`public.moderation_actions`)

Defined in [20261008000011_moderation_actions_schema.sql](file:///c:/Users/HomePC/Documents/projects/cih%20message%20platform/supabase/migrations/20261008000011_moderation_actions_schema.sql):

| Column | Type | Nullable | Default | Description |
| :--- | :--- | :---: | :--- | :--- |
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key |
| `organization_id` | `UUID` | No | — | Organization tenant boundary |
| `report_id` | `UUID` | Yes | `NULL` | Optional associated report |
| `moderator_id` | `UUID` | No | — | Moderator auth UUID who performed the action |
| `target_user_id` | `UUID` | Yes | `NULL` | Target auth UUID (for user-level sanctions) |
| `action_type` | `TEXT` | No | — | Enum check constraint |
| `reason` | `TEXT` | No | — | Mandatory explanation (3–1000 characters) |
| `metadata` | `JSONB` | No | `'{}'::jsonb` | Additional structured audit payload |
| `created_at` | `TIMESTAMPTZ` | No | `NOW()` | Immutable action timestamp |

### Supported `action_type` Values:
- `resolve_report`: Report marked resolved.
- `dismiss_report`: Report dismissed without sanction.
- `investigate_report`: Report status changed to investigating.
- `warn_user`: Formal warning recorded against member.
- `suspend_user`: Member status changed to `suspended`.
- `reactivate_user`: Suspended member restored to `active`.

---

## 7. Stored Procedure Contracts

All stored procedures execute with `SECURITY DEFINER` and a fixed `search_path = public, pg_temp`:

1. `get_organization_reports(p_status TEXT, p_category TEXT, p_limit INT, p_offset INT)`
   - Authorizes caller via `is_org_moderator_or_admin`.
   - Returns paginated report summaries with `public_id` and boolean `has_disclosed_plaintext`.
2. `get_report_details(p_report_id UUID)`
   - Authorizes caller.
   - Returns full report, consenting plaintext, reported user details, and historical actions.
3. `resolve_report(p_report_id UUID, p_new_status TEXT, p_reason TEXT)`
   - Acquires advisory lock `hashtext('resolve_report:' || p_report_id::text)`.
   - Validates transition and reason.
   - Updates `reports.status` and appends to `moderation_actions`.
4. `apply_moderation_action(p_target_public_id UUID, p_action_type TEXT, p_reason TEXT, p_report_id UUID)`
   - Prevents self-moderation and enforces role hierarchy.
   - Executes status change on `organization_members` if applicable (`suspend_user` / `reactivate_user`).
   - Automatically marks associated report as `resolved` if provided.
   - Appends to `moderation_actions`.
5. `get_moderation_actions(p_limit INT, p_offset INT)`
   - Returns organization audit trail projecting public identifiers only.
