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

---

## 4. Migration Workflow

Migrations are managed with the Supabase CLI:

### 4.1 Applying Migrations Locally
```bash
# Start local Supabase containers (requires Docker)
npx supabase start

# Apply all pending migrations
npx supabase db reset
```

### 4.2 Creating New Migrations
```bash
npx supabase migration new <migration_name>
```

### 4.3 Generating TypeScript Types
```bash
npx supabase gen types typescript --local > src/lib/supabase/types.ts
```

---

## 5. Security & Isolation Invariants

1. **Zero Hardcoded Organizations**: The platform data model is multi-tenant by design. Tenant matching uses `allowed_domains` rather than hardcoded logic.
2. **Identity Separation**: Public profile identities (`profiles`) are decoupled from authentication identifiers (`auth.users`).
3. **Cross-Tenant Isolation**: A user cannot read profiles or membership information from organizations they do not actively belong to.
4. **Self-Service Boundaries**: Normal members cannot elevate their own roles, alter membership statuses, or inject themselves into unauthorized organizations.
