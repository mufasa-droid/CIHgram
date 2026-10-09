# Profile & Settings Architecture Guide

## 1. Overview

The Profile & Settings milestone (Prompt 009) establishes a clean, quiet editorial experience allowing authenticated organization members to view their workspace identity, update their public profile attributes, inspect their end-to-end cryptographic status, and securely manage their device session.

The interface adheres strictly to **71UI design principles** (quiet editorial aesthetic, clear typography, accessible contrast, 32px controls, tabular figures, and responsive layout) and preserves all core product invariants: zero sender exposure, zero server plaintext, and strict organization boundaries.

---

## 2. Permitted Profile Fields & Mutation Matrix

| Field | Source / Table | Permitted Operations | Validation / Constraints | Description |
| :--- | :--- | :---: | :--- | :--- |
| `display_name` | `public.profiles` | View, Edit | 1–50 characters, trimmed, required | Preferred public name visible across directory |
| `username` | `public.profiles` | View, Edit | 3–30 chars, lowercase alphanumeric, delimiters (`^[a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?$`), unique | Unique organization handle (`@username`) |
| `bio` | `public.profiles` | View, Edit | Nullable, max 250 characters, empty string sanitized to `null` | Brief descriptive note for directory search |
| `avatar_url` | `public.profiles` | View, Edit | Nullable, max 2048 chars, valid HTTP/HTTPS URL, empty string sanitized to `null` | Public profile picture URL |
| `email` | `auth.users` | **View Only** | Read-only Google OAuth verified email | Identity credential managed by Google |
| `provider` | Supabase Auth | **View Only** | Read-only string (`Google OAuth`) | Authentication mechanism |
| `user_id` | `auth.users` | **View Only** | Read-only UUID | Immutable platform identifier |
| `organization_name` | `public.organizations` | **View Only** | Read-only string | Tenant workspace |
| `role` | `public.organization_members` | **View Only** | Read-only (`member` / `admin`) | Membership authorization role |
| `status` | `public.organization_members` | **View Only** | Read-only (`active`) | Account state within organization |
| `joined_at` | `public.organization_members` | **View Only** | Read-only ISO timestamp | Membership admission date |

### 2.1 Protected Fields Immunity
- **Organization Membership & Role**: Roles (`role`) and statuses (`status`) reside on `public.organization_members`. They are completely excluded from the update DTO and protected by RLS (`org_members_update_admin` requires `is_org_admin()`).
- **Authentication Identifiers**: `auth.users` records (email, passwords, OAuth tokens) are never mutable via application profile actions. Password changes are not applicable for Google OAuth accounts.
- **Account Ownership & Cross-User Tampering**: Target user ID is derived strictly from the verified server session (`status.user.id`). Client-supplied IDs are stripped and ignored, and database RLS policy `profiles_update_own` rejects any update where `id != auth.uid()`.

---

## 3. Server Authorization & Validation Boundary

Profile updates are mediated through the Next.js Server Action `updateProfileAction`:

```text
[ Browser / Client Component ]
        │
        │ 1. Submits { displayName, username, bio, avatarUrl }
        ▼
[ Server Action: updateProfileAction ]
        │
        ├─> 2. getUserAdmissionStatus() (Verifies Supabase session & active org membership)
        │       └─> Throws AuthorizationError if unauthenticated or not 'admitted'
        │
        ├─> 3. updateProfileSchema.safeParse() (Zod validation & sanitization)
        │       └─> Throws ValidationError if format invalid
        │
        ├─> 4. Check username availability if changed (query profiles for existing handle)
        │       └─> Throws ConflictError if claimed by another user
        │
        ├─> 5. supabase.from("profiles").update().eq("id", user.id) (Scoped to session UUID)
        │       └─> Protected by PostgreSQL RLS (profiles_update_own)
        │
        ├─> 6. logger.info("user_profile_updated", { userId, organizationId })
        │       └─> Privacy logging: zero personal contents logged
        │
        ▼
[ Return Updated UserProfile ]
```

---

## 4. End-to-End Cryptographic Identity Protection

The user's cryptographic identity is security-critical and treated with extreme conservatism:

1. **Zero Key Mutation on Profile Edits**:
   - Editing a profile or viewing settings **never** generates, rotates, replaces, or deletes encryption keys.
   - The `public_keys` table and the local IndexedDB keystore (`cih_keystore_v1`) are completely untouched during profile mutations.
2. **Local Keystore Integrity**:
   - The client component `EncryptionStatusCard` verifies whether the local private key stored in IndexedDB matches the server's active public key (`activePublicKey`).
   - If a key is present and matched: status displays `Key Active & Stored in Browser (IndexedDB)`.
   - If a key is missing or was cleared by browser history/storage sweeps: status displays `Key Missing from this Device — Restore Required` and renders the inline 256-bit recovery phrase restoration form.
3. **No Silent Key Regeneration**:
   - The platform never silently generates a new keypair when a key is missing, as doing so would irrevocably sever access to historical encrypted messages.
4. **Secret Zeroization & Private Key Protection**:
   - Private key bytes are never sent to the server, logged, or exposed in UI markup.

---

## 5. Session Management & Sign-Out Lifecycle

Clicking "Sign Out" in either `WorkspaceHeader` or `SignOutCard` initiates a dual-stage cleanup:
1. **Client-Side Keystore Purge (`clearLocalIdentity`)**:
   - Invokes `clearLocalIdentity()` to erase the active identity from IndexedDB (`cih_keystore_v1`) and zeroize in-memory key buffers using `sodium.memzero`.
   - Prevents cross-account pollution on shared workstations (remediating SEC-009).
2. **Server Session Termination (`POST /auth/signout`)**:
   - Submits native POST request to `/auth/signout`, clearing Supabase authentication cookies and invalidating the session.
   - Redirects to `/login`.

---

## 6. Deliberately Deferred Functionality (Future Milestones)

In compliance with Prompt 009 non-goals, the following functionality is explicitly omitted and documented for future consideration:
- **Self-Service Account Deletion**: Deleting an account requires formal message tombstoning, 30-day ciphertext purge orchestration, and moderation retention checks (deferred to a dedicated account lifecycle milestone).
- **Organization Switching / Multi-Org**: Users belong to one active organization determined by their verified email domain. Multi-tenancy switching is deferred to v2.
- **Cryptographic Key Rotation**: Key rotation involves complex multi-recipient re-encryption and historical message keyrings (deferred to v2).
- **Public Profile Viewing of Other Members**: Peers are discovered through the Member Directory (`MemberDirectory` on `/app`); standalone public profile routes (`/u/[username]`) are not part of Prompt 009.
