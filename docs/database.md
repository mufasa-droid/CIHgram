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
| `id` | `UUID` | No | — | Primary Key, FK `auth.users(id)` ON DELETE CASCADE |
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
- `idx_profiles_created_at`: Index on `created_at`.
- **Privacy Guarantee**: Does NOT contain email addresses, OAuth tokens, passwords, or authentication provider secrets.

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

