# Member Directory & Discovery Architecture

## 1. Overview

The Member Directory provides organization-scoped discovery and recipient search for the Anonymous Messaging Platform. Authenticated and admitted members can search and discover colleagues within their own organization in order to select recipients for anonymous messages.

---

## 2. Security Boundaries & Invariants

### 2.1 Server-Enforced Organization Scoping
- The client browser is **never** trusted to provide the organization identifier.
- The server extracts the caller's identity via `auth.uid()` from the verified Supabase session and resolves their active organization membership in `public.organization_members`.
- Only members belonging to the exact same organization with `status = 'active'` are returned.
- Suspended, removed, and pending members are automatically excluded.

### 2.2 Caller Exclusion
- The calling user is explicitly excluded from directory query results (`om.user_id != auth.uid()`).
- Self-messaging is prohibited by design.

### 2.3 Strict Public Projection (Data Minimization & Identifier Isolation)
The directory exposes only the minimal public profile projection:
- `id` (UUID): Stable, opaque public recipient identifier (`profiles.public_id`).
- `username` (CITEXT): Unique handle.
- `displayName` (TEXT): Formatted name.
- `avatarUrl` (TEXT | NULL): Public avatar image URL.

The following data is **never** exposed:
- `auth.users.id` (internal authentication UUID).
- Email addresses.
- `auth.users` metadata or OAuth provider information.
- Access or refresh tokens.
- Organization membership internal IDs.
- Roles or administrative privileges.
- Moderation state or private profile attributes.

#### Stable Public Identifier vs Mutable Usernames (FINDING-009A-1 Remediation)
As remediated in Migration 8 (`20261008000008_public_profile_identifiers.sql`):
1. **Internal Authentication Shielding**: The directory RPCs (`search_organization_members`, `get_organization_member_by_username`) project `p.public_id AS id`. The underlying internal `auth.users.id` / `profiles.id` is completely shielded within the database and never leaves the server boundary or enters client payloads.
2. **Handle-Change TOCTOU Race Defense**: Using a separate immutable `public_id UUID` instead of routing messages by `@username` eliminates a critical security race condition. When a user updates their handle (e.g. from `@alice` to `@alice_new`), pending drafts or selected recipient tokens remain bound to Alice's cryptographic identity. If a different user registers the vacated `@alice`, messages are never misdelivered or hijacked.

---

## 3. Data Flow

```text
Authenticated Request (Next.js Server Component or Action)
                       │
                       ▼
             getUserAdmissionStatus()
                       │
                       ▼
          search_organization_members(query, limit)
                       │
                       ▼
              PostgreSQL Security Definer
     (Derives v_org_id strictly from caller's session)
                       │
                       ▼
               PublicMember Projection
           { id, username, displayName, avatarUrl }
                       │
                       ▼
               MemberDirectory UI
```

---

## 4. Search Behavior

- **Fields Queried**: Search operates over `profiles.username` and `profiles.display_name`.
- **Matching Mode**: Case-insensitive substring matching (`ILIKE`).
- **Validation**:
  - Validated using Zod (`searchQuerySchema`).
  - Leading and trailing whitespace is trimmed.
  - Maximum query length is enforced at 100 characters.
  - Parameterized database arguments prevent SQL injection.
- **Empty Query Handling**: Returns all active peers in the organization up to the configured limit, sorted alphabetically by display name and username.

---

## 5. Result Limits & Pagination

- Queries are strictly bounded on the database level:
  ```sql
  v_limit := LEAST(GREATEST(COALESCE(result_limit, 50), 1), 100);
  ```
- Unbounded queries are impossible; maximum results per query is capped at 100 (default 50).
- This bounded model is performant and appropriate for initial organization-scale deployment without unnecessary full-text search or heavy pagination complexity.

---

## 6. Recipient Selection

Clicking "Send Message" on a directory member row establishes a clean navigation and state boundary. It preselects the target member as the recipient for the transient anonymous message composer, which will be introduced in subsequent cryptographic and messaging units (Prompts 006 & 007).
