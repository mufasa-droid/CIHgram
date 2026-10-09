# Database Architecture & Migration Guide

## 1. Overview

The Anonymous Messaging Platform relies on Supabase PostgreSQL for identity, multi-tenant organization boundaries, and relationship metadata. All tables enforce strict Row Level Security (RLS) to ensure tenant isolation and prevent horizontal privilege escalation.

---

## 2. Tables & Data Dictionary

### 2.1 `public.organizations`

Represents an organization tenant within the platform.

| Column | Type | Nullable | Default | Description |
| :--- | :--- | :---: | :--- | :--- |
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key |
| `name` | `TEXT` | No | — | Organization display name (2–100 chars) |
| `slug` | `TEXT` | No | — | Unique URL-friendly slug (`[a-z0-9-]+`) |
| `allowed_domains` | `TEXT[]` | No | `'{}'` | Domains verified for admission |
| `created_at` | `TIMESTAMPTZ` | No | `NOW()` | Timestamp created |
| `updated_at` | `TIMESTAMPTZ` | No | `NOW()` | Timestamp last modified (via trigger) |

**Constraints & Indexes**:
- `organizations_name_length_check`: Trimmed length between 2 and 100 characters.
- `organizations_slug_format_check`: Slug format regex matching lowercase alphanumeric with hyphens.
- `idx_organizations_slug`: Unique B-Tree index on `slug`.

### 2.2 `public.profiles`

Application-level user identity associated 1:1 with an authenticated `auth.users` record.

| Column | Type | Nullable | Default | Description |
| :--- | :--- | :---: | :--- | :--- |
| `id` | `UUID` | No | — | Primary Key, FK `auth.users(id)` ON DELETE CASCADE (internal only) |
| `public_id` | `UUID` | No | `gen_random_uuid()` | Opaque, stable public profile identifier (distinct from auth.users.id) |
| `username` | `CITEXT` | No | — | Unique case-insensitive handle (3–30 chars) |
| `display_name` | `TEXT` | No | — | Full name or nickname (1–50 chars) |
| `avatar_url` | `TEXT` | Yes | `NULL` | Public HTTP/S URL to avatar storage |
| `bio` | `TEXT` | Yes | `NULL` | User description (max 250 chars) |
| `created_at` | `TIMESTAMPTZ` | No | `NOW()` | Profile creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | No | `NOW()` | Last updated timestamp (via trigger) |

**Constraints & Indexes**:
- `profiles_username_format_check`: Lowercase alphanumeric, underscores, dots, hyphens (3–30 chars).
- `profiles_display_name_length_check`: 1–50 characters.
- `profiles_bio_length_check`: Max 250 characters.
- `profiles_avatar_url_check`: Valid HTTP/HTTPS format.
- `idx_profiles_username`: Unique index on `username`.
- `idx_profiles_public_id`: Unique index on `public_id` (enforces platform-wide public identifier uniqueness).
- `idx_profiles_created_at`: Index on `created_at`.
- **Privacy Guarantee**: `auth.users.id` is strictly internal. Public directory search and client messaging flows use `public_id`. Does NOT contain email addresses, OAuth tokens, passwords, or authentication provider secrets.

### 2.3 `public.organization_members`

Associates platform users with organizations and defines roles and membership status.

| Column | Type | Nullable | Default | Description |
| :--- | :--- | :---: | :--- | :--- |
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key |
| `organization_id` | `UUID` | No | — | FK `public.organizations(id)` ON DELETE CASCADE |
| `user_id` | `UUID` | No | — | FK `public.profiles(id)` ON DELETE CASCADE |
| `role` | `TEXT` | No | `'member'` | Membership role |
| `status` | `TEXT` | No | `'active'` | Membership status |
| `joined_at` | `TIMESTAMPTZ` | No | `NOW()` | Timestamp user joined the organization |
| `created_at` | `TIMESTAMPTZ` | No | `NOW()` | Row creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | No | `NOW()` | Last modified timestamp (via trigger) |

**Constraints & Indexes**:
- `organization_members_role_check`: Role must be one of `'admin'`, `'moderator'`, or `'member'`.
- `organization_members_status_check`: Status must be one of `'active'`, `'pending'`, `'suspended'`, or `'removed'`.
- `organization_members_unique_membership`: Unique constraint on `(organization_id, user_id)` preventing duplicate memberships.
- `idx_organization_members_user`: Index on `user_id`.
- `idx_organization_members_org`: Index on `organization_id`.
- `idx_organization_members_active_lookup`: Partial index on `(organization_id, user_id)` WHERE `status = 'active'`.

### 2.4 `public.public_keys`

Stores Curve25519 (X25519) 32-byte public encryption keys for authenticated users.

| Column | Type | Nullable | Default | Description |
| :--- | :--- | :---: | :--- | :--- |
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key |
| `user_id` | `UUID` | No | — | FK `public.profiles(id)` ON DELETE CASCADE |
| `public_key` | `TEXT` | No | — | 32-byte Base64-encoded Curve25519 public key |
| `algorithm` | `TEXT` | No | `'x25519-xsalsa20poly1305'` | Cryptographic suite identifier |
| `is_active` | `BOOLEAN` | No | `true` | Active key flag |
| `created_at` | `TIMESTAMPTZ` | No | `NOW()` | Timestamp key was registered |

**Constraints & Indexes**:
- `public_key_format_check`: Strictly 44 characters Base64 matching `^[A-Za-z0-9+/]{43}=$`.
- `algorithm_check`: Must equal `'x25519-xsalsa20poly1305'`.
- `idx_public_keys_unique_active_user`: Partial unique index on `(user_id) WHERE is_active = true` (enforces at most one active key per user).
- `idx_public_keys_user_id`: B-Tree index on `user_id`.
- `idx_public_keys_user_created`: B-Tree index on `(user_id, created_at DESC)`.
- **Privacy & Security Guarantee**: Strictly public key material. NEVER stores private keys, recovery phrases, seeds, or passwords.

### 2.5 `public.messages`

Stores end-to-end encrypted message ciphertext envelopes.

| Column | Type | Nullable | Default | Description |
| :--- | :--- | :---: | :--- | :--- |
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key |
| `sender_id` | `UUID` | No | — | FK `public.profiles(id)` ON DELETE CASCADE |
| `recipient_id` | `UUID` | No | — | FK `public.profiles(id)` ON DELETE CASCADE |
| `organization_id` | `UUID` | No | — | FK `public.organizations(id)` ON DELETE CASCADE |
| `key_id` | `UUID` | No | — | FK `public.public_keys(id)` ON DELETE RESTRICT |
| `ciphertext` | `TEXT` | No | — | Base64-encoded Libsodium sealed box ciphertext |
| `protocol_version` | `INTEGER` | No | `1` | Supported protocol version (`1`) |
| `is_read` | `BOOLEAN` | No | `false` | Read receipt flag |
| `is_starred` | `BOOLEAN` | No | `false` | Recipient star flag |
| `deleted_by_recipient` | `BOOLEAN` | No | `false` | Soft-delete flag |
| `created_at` | `TIMESTAMPTZ` | No | `NOW()` | Timestamp sent |

**Constraints & Indexes**:
- `sender_recipient_distinct_check`: `CHECK (sender_id <> recipient_id)` (prohibits self-messaging).
- `protocol_version_check`: `CHECK (protocol_version = 1)`.
- `ciphertext_size_check`: `CHECK (length(trim(ciphertext)) >= 48 AND length(ciphertext) <= 32768)` (bounded payload).
- `idx_messages_recipient_inbox`: Partial index on `(recipient_id, created_at DESC) WHERE deleted_by_recipient = false`.
- `idx_messages_sender_rate_limit`: Index on `(sender_id, created_at DESC)`.
- `idx_messages_organization_id`: Index on `organization_id`.
- `idx_messages_key_id`: Index on `key_id`.
- **Anonymity & Privacy Guarantee**: Direct `SELECT` permission on this table is completely **revoked** from `authenticated` users to protect `sender_id`. Zero plaintext, zero subjects, zero previews.

### 2.6 `public.blocks`

Stores directional user block relationships within an organization tenant.

| Column | Type | Nullable | Default | Description |
| :--- | :--- | :---: | :--- | :--- |
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key |
| `organization_id` | `UUID` | No | — | FK `public.organizations(id)` ON DELETE CASCADE |
| `blocker_id` | `UUID` | No | — | FK `public.profiles(id)` ON DELETE CASCADE (internal auth UUID) |
| `blocked_id` | `UUID` | No | — | FK `public.profiles(id)` ON DELETE CASCADE (internal auth UUID) |
| `created_at` | `TIMESTAMPTZ` | No | `NOW()` | Timestamp block created |

**Constraints & Indexes**:
- `blocks_no_self_block_check`: `CHECK (blocker_id <> blocked_id)` (prohibits self-blocking).
- `idx_blocks_unique_pair`: Unique index on `(blocker_id, blocked_id)` preventing duplicate active block relationships.
- `idx_blocks_blocker`: B-Tree index on `(blocker_id, created_at DESC)`.
- `idx_blocks_blocked`: B-Tree index on `(blocked_id)`.
- `idx_blocks_organization`: B-Tree index on `(organization_id)`.
- **Security & Privacy Guarantee**: Direct client table access is REVOKED. Managed strictly via controlled RPCs (`block_user`, `block_message_sender`, `unblock_user`, `get_blocked_users`).

### 2.7 `public.reports`

Stores user-submitted abuse reports for received messages. Supports optional explicit evidence disclosure.

| Column | Type | Nullable | Default | Description |
| :--- | :--- | :---: | :--- | :--- |
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key |
| `organization_id` | `UUID` | No | — | FK `public.organizations(id)` ON DELETE CASCADE |
| `reporter_id` | `UUID` | No | — | FK `public.profiles(id)` ON DELETE CASCADE (internal auth UUID) |
| `reported_user_id` | `UUID` | No | — | FK `public.profiles(id)` ON DELETE CASCADE (sender resolved internally) |
| `message_id` | `UUID` | No | — | FK `public.messages(id)` ON DELETE CASCADE |
| `category` | `TEXT` | No | — | Report category (`harassment`, `threats`, `spam`, `inappropriate_content`, `impersonation`, `other`) |
| `details` | `TEXT` | Yes | `NULL` | Optional reporter explanation (max 1000 chars) |
| `disclosed_plaintext` | `TEXT` | Yes | `NULL` | Optional decrypted plaintext submitted with explicit consent (max 2000 chars) |
| `disclosed_plaintext_consent` | `BOOLEAN` | No | `false` | Explicit consent flag |
| `status` | `TEXT` | No | `'pending'` | Moderation queue status (`pending`, `investigating`, `resolved`, `dismissed`) |
| `created_at` | `TIMESTAMPTZ` | No | `NOW()` | Timestamp report created |
| `updated_at` | `TIMESTAMPTZ` | No | `NOW()` | Timestamp last modified |

**Constraints & Indexes**:
- `reports_no_self_report`: `CHECK (reporter_id <> reported_user_id)` (prohibits reporting self).
- `reports_unique_message_reporter`: `UNIQUE (message_id, reporter_id)` (enforces one-report-per-message DB boundary).
- `reports_plaintext_consent_check`: `CHECK (disclosed_plaintext IS NULL OR disclosed_plaintext_consent = true)`.
- `idx_reports_org_status`: B-Tree index on `(organization_id, status, created_at DESC)`.
- `idx_reports_message`: B-Tree index on `(message_id)`.
- `idx_reports_reporter`: B-Tree index on `(reporter_id, created_at DESC)`.
- `idx_reports_reported_user`: B-Tree index on `(reported_user_id, created_at DESC)`.
- **Security & Privacy Guarantee**: Direct table access REVOKED from `PUBLIC`, `anon`, and `authenticated`. Mediated exclusively via `create_message_report`. Normal message storage remains 100% ciphertext-only.



---

## 3. Row Level Security (RLS) Philosophy

All tables have RLS enabled. Direct unauthenticated access is completely disallowed.

### 3.1 Avoiding Infinite Recursion
In PostgreSQL RLS, checking a user's membership in a table policy (e.g., in `profiles` or `organization_members`) can cause infinite recursive loops if the policy references the same table. To guarantee safety and performance, authorization predicates use small, dedicated `SECURITY DEFINER` functions with fixed `search_path`:
- `public.is_org_member(org_id, user_id)`: Verifies active membership.
- `public.is_org_admin(org_id, user_id)`: Verifies active admin role.
- `public.shares_active_organization(target_user, current_user)`: Verifies shared active membership between two users.

### 3.2 Policy Matrix

| Table | Operation | Target Role | Policy Condition |
| :--- | :--- | :--- | :--- |
| `organizations` | `SELECT` | `authenticated` | `is_org_member(id, auth.uid())` |
| `organizations` | `UPDATE` | `authenticated` | `is_org_admin(id, auth.uid())` |
| `organizations` | `INSERT`/`DELETE` | — | Restricted to privileged service role / migrations. |
| `profiles` | `SELECT` | `authenticated` | `id = auth.uid() OR shares_active_organization(id, auth.uid())` |
| `profiles` | `INSERT` | `authenticated` | `id = auth.uid()` |
| `profiles` | `UPDATE` | `authenticated` | `id = auth.uid()` |
| `profiles` | `DELETE` | `authenticated` | `id = auth.uid()` |
| `organization_members` | `SELECT` | `authenticated` | `is_org_member(organization_id, auth.uid())` |
| `organization_members` | `INSERT` | `authenticated` | `is_org_admin(organization_id, auth.uid())` |
| `organization_members` | `UPDATE` | `authenticated` | `is_org_admin(organization_id, auth.uid())` |
| `organization_members` | `DELETE` | `authenticated` | `is_org_admin(organization_id, auth.uid()) OR user_id = auth.uid()` |
| `public_keys` | `SELECT` | `authenticated` | `user_id = auth.uid() OR shares_active_organization(user_id, auth.uid())` |
| `public_keys` | `INSERT` | `authenticated` | `user_id = auth.uid()` |
| `public_keys` | `UPDATE` | `authenticated` | `user_id = auth.uid()` |
| `public_keys` | `DELETE` | `authenticated` | `user_id = auth.uid()` |
| `messages` | `SELECT` | `authenticated` | **REVOKED** (Direct table SELECT disallowed; read via security barrier view in Prompt 008) |
| `messages` | `INSERT` | `authenticated` | `sender_id = auth.uid()` |
| `messages` | `UPDATE` | `authenticated` | `recipient_id = auth.uid()` |
| `messages` | `DELETE` | — | Restricted to automated ciphertext purge routines. |

---

---

## 4. Directory Search & Admission Procedures

### 4.1 Admission Procedures (`20261008000001_organization_admission.sql`)
- `find_organization_by_domain(check_domain)`: Matches email domain against `organizations.allowed_domains`.
- `admit_user_to_organization(...)`: Atomically creates profile and active membership with hardcoded role `'member'`.
- `get_current_user_status()`: Returns admission and onboarding state for the calling user.

### 4.2 Member Directory Procedures (`20261008000002_member_directory_search.sql`)
- `search_organization_members(query_text, result_limit)`: Queries active peers within the caller's organization, automatically excluding the caller and projecting only safe fields (`id`, `username`, `display_name`, `avatar_url`).
- `get_organization_member_by_username(target_username)`: Resolves a member profile strictly within the caller's organization.
- **Indexes**: Added B-Tree indexes on `lower(display_name)` and `lower(username)` to accelerate case-insensitive directory lookups.

### 4.3 Public Key Infrastructure Procedures (`20261008000003_public_keys_schema.sql`)
- `register_public_key(p_public_key, p_algorithm)`: Atomically deactivates any existing active key for the calling user, validates Base64 format and 44-character length, and inserts the new active key. Identity is anchored strictly to `auth.uid()`.
- `get_active_public_key(p_target_user_id)`: Safely resolves the active public key of a recipient, enforcing that the recipient must share an active organization membership with the caller.
- `get_user_key_status()`: Queries the caller's active public key existence and total key count to manage client identity reconciliation safely.

### 4.4 Anonymous Messaging Procedures (`20261008000004_messages_schema.sql`)
- `send_anonymous_message(p_recipient_id, p_key_id, p_ciphertext, p_protocol_version)`: Authenticates sender from session `auth.uid()`, enforces distinct sender/recipient, validates shared active organization membership, verifies recipient's active public key ID, enforces sliding-window rate limits (max 5/min, max 50/day), and atomically persists the encrypted envelope into `public.messages`.

### 4.5 Recipient Inbox & Message Action Procedures (`20261008000006_recipient_inbox_schema.sql`)
- `recipient_inbox_messages`: PostgreSQL Security Barrier View (`WITH (security_barrier = true)`) projecting strictly recipient-safe columns (`id, recipient_id, ciphertext, key_id, protocol_version, created_at, is_read, is_starred`) where `recipient_id = auth.uid() AND deleted_by_recipient = false`. Strictly omits `sender_id` and `organization_id` at the database level.
- `get_recipient_inbox(p_cursor, p_limit)`: `SECURITY DEFINER` procedure with fixed `search_path = public, pg_temp` providing bounded cursor pagination (1–50 limit) for non-deleted recipient messages.
- `mark_message_read(p_message_id)`: Idempotently marks a message as read scoped strictly to `recipient_id = auth.uid()`.
- `set_message_starred(p_message_id, p_is_starred)`: Toggles favorite state scoped strictly to `recipient_id = auth.uid()`.
- `delete_message_for_recipient(p_message_id)`: Performs soft-delete (`deleted_by_recipient = true`) scoped to `recipient_id = auth.uid()`, preserving server accountability data for the 30-day purge lifecycle.
- `get_inbox_unread_count()`: Returns recipient unread message count without returning message content.
- **Indexes**: Added partial index `idx_messages_recipient_unread` on `recipient_id WHERE deleted_by_recipient = false AND is_read = false` and `idx_messages_recipient_starred` on `(recipient_id, created_at DESC) WHERE deleted_by_recipient = false AND is_starred = true`.

### 4.6 Inbox Organization Boundary Hardening (`20261008000007_harden_inbox_organization_boundary.sql`)
- `recipient_inbox_messages`: Re-defined `WITH (security_barrier = true)` to enforce that the caller must possess an active organization membership (`om.status = 'active'`) matching the message's `organization_id`, ensuring that suspended or departed users cannot read organization messages.
- `get_recipient_inbox`: Re-defined to query directly through `recipient_inbox_messages` and verify caller has at least one active organization membership.
- `mark_message_read`, `set_message_starred`, `delete_message_for_recipient`: Re-defined to enforce active organization membership.
- `get_inbox_unread_count`: Re-defined to query through `recipient_inbox_messages`.

### 4.7 Public Profile Identifier Privacy Remediation (`20261008000008_public_profile_identifiers.sql`)
- `public.profiles.public_id`: Added non-null UUID column with `DEFAULT gen_random_uuid()` and unique index `idx_profiles_public_id`.
- `search_organization_members`: Re-defined to project `p.public_id AS id`, completely removing `auth.users.id` from directory search outputs.
- `get_organization_member_by_username`: Re-defined to project `p.public_id AS id`.
- `get_active_public_key`: Re-defined to resolve recipient internal ID via `public_id` and project `v_target_public_id AS user_id` in output rows, preventing disclosure of target `auth.users.id`.
- `send_anonymous_message`: Re-defined to accept recipient `public_id`, internally resolve to `v_recipient_user_id`, and verify active organization boundary and key validity before inserting into `public.messages`.

### 4.8 User & Message Sender Blocking (`20261008000009_blocks_schema.sql`)
- `public.blocks`: Created table with `CHECK (blocker_id <> blocked_id)` and `UNIQUE (blocker_id, blocked_id)`.
- `block_user(p_target_public_id UUID)`: Resolves public target, verifies same active organization, acquires deterministic dual-party advisory locks, and idempotently inserts block.
- `block_message_sender(p_message_id UUID)`: Verifies caller is authorized recipient, internally resolves sender UUID from `public.messages`, acquires deterministic advisory locks, and inserts block without ever exposing sender UUID to the client.
- `unblock_user(p_target_public_id UUID)`: Removes only the authenticated user's own block of the target.
- `get_blocked_users()`: Returns caller's block list projected strictly as safe public attributes (`public_id, username, display_name, avatar_url, blocked_at`).
- `send_anonymous_message`: Updated with deterministic dual-party advisory locking and bidirectional block check (`A blocks B` OR `B blocks A`). Returns generic `RECIPIENT_UNAVAILABLE` to eliminate oracle attacks.

### 4.9 Abuse Reporting & Explicit Evidence Disclosure (`20261008000010_reports_schema.sql`)
- `public.reports`: Created table with `CHECK (reporter_id <> reported_user_id)`, `UNIQUE (message_id, reporter_id)`, and `CHECK (disclosed_plaintext IS NULL OR disclosed_plaintext_consent = true)`.
- `create_message_report`: Security-definer procedure accepting message ID, category, optional details (max 1000 chars), and optional disclosed plaintext (max 2000 chars) with explicit consent flag.
- Enforces recipient authorization (`m.recipient_id = auth.uid()`), organization boundary, reporter sliding-window rate limit (10/hr), and advisory locking.
- Returns `{ success: true, report_id }` with zero sender identity exposure. Direct table access is completely revoked from public, anon, and authenticated roles.

---

## 5. Migration Workflow

Migrations are managed with the Supabase CLI:

### 5.1 Applying Migrations Locally
```bash
# Start local Supabase containers (requires Docker)
npx supabase start

# Apply all pending migrations
npx supabase db reset
```

### 5.2 Creating New Migrations
```bash
npx supabase migration new <migration_name>
```

### 5.3 Generating TypeScript Types
```bash
npx supabase gen types typescript --local > src/lib/supabase/types.ts
```

---

## 6. Security & Isolation Invariants

1. **Zero Hardcoded Organizations**: The platform data model is multi-tenant by design. Tenant matching uses `allowed_domains` rather than hardcoded logic.
2. **Identity Separation**: Public profile identities (`profiles`) are decoupled from authentication identifiers (`auth.users`).
3. **Cross-Tenant Isolation**: A user cannot read profiles or membership information from organizations they do not actively belong to.
4. **Self-Service Boundaries**: Normal members cannot elevate their own roles, alter membership statuses, or inject themselves into unauthorized organizations.
5. **Caller Exclusion & Bounded Results**: Directory queries exclude the calling user and clamp results to 100 maximum records.

