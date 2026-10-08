# Authentication & Organization Onboarding Architecture

## 1. Overview

The Anonymous Messaging Platform uses **Google OAuth via Supabase Auth** for account authentication, paired with a database-backed **verified email domain match** model for organization admission. 

This establishes a critical security boundary: **Authentication is separate from Authorization**. A valid Google account does not grant access unless the account's email domain matches an organization's configured `allowed_domains`.

---

## 2. Authentication Flow

```text
[ Browser ]                     [ Next.js Server ]                [ Supabase Auth / Google ]
     │                                   │                                    │
     │ 1. Clicks "Continue with Google"  │                                    │
     ├──────────────────────────────────>│ POST /auth/login                   │
     │                                   │   signInWithOAuth() ──────────────>│
     │<──────────────────────────────────┼── Redirects to Google Consent ─────┤
     │                                   │                                    │
     │ 2. Authenticates on Google        │                                    │
     ├───────────────────────────────────────────────────────────────────────>│
     │                                   │                                    │
     │ 3. Redirected back with code      │                                    │
     ├──────────────────────────────────>│ GET /auth/callback?code=xyz        │
     │                                   │   exchangeCodeForSession() ───────>│
     │                                   │   getUserAdmissionStatus()         │
     │                                   │                                    │
     │<── Redirects to: ─────────────────┤                                    │
     │    • /app (if already admitted)   │                                    │
     │    • /onboarding (if first login) │                                    │
     │    • /unauthorized (if domain bad)│                                    │
```

---

## 3. Organization Admission Model

### 3.1 Eligibility Determination
1. Supabase Auth validates the user's Google account and provides a verified email in the session JWT (`auth.jwt() ->> 'email'`).
2. The server extracts the domain:
   ```ts
   const domain = extractEmailDomain(user.email);
   ```
3. The server compares the normalized domain against `organizations.allowed_domains` in the database.
4. **Strict Domain Matching**:
   - Comparison is case-insensitive.
   - Suffix attacks (e.g. `attackerexample.com` attempting to match `example.com`) are strictly rejected.
   - Zero organization names, IDs, or domains are hardcoded in application code.

### 3.2 Ineligible Users
Users whose email domain does not match any active organization are blocked from entering the application. They are routed to `/unauthorized` with an option to sign out. Their session cannot access protected workspace routes.

---

## 4. First-Time Account Initialization

When an eligible user signs in for the first time:

1. **Routing**: The user is directed to `/onboarding`.
2. **Profile Confirmation**:
   - The user confirms their `displayName` and chooses an available `username`.
   - The username must conform to `^[a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?$` (3–30 characters).
3. **Atomic Admission (`admit_user_to_organization`)**:
   - Executed via database `SECURITY DEFINER` function with strict `search_path`.
   - Checks that the user's session JWT email domain matches `allowed_domains`.
   - Checks username availability across `profiles`.
   - Upserts `profiles` record linked to `auth.users(id)`.
   - Inserts `organization_members` with hard-coded `role = 'member'` and `status = 'active'`.
   - Normal users **cannot** assign themselves `role = 'admin'`.
4. **Idempotency**: Repeated calls or page refreshes do not produce duplicate profiles or duplicate membership records.

---

## 5. Route Protection & Boundaries

- **Public Routes**: `/`, `/login`, `/_not-found`.
- **Auth Handlers**: `/auth/login`, `/auth/callback`, `/auth/signout`.
- **Protected Routes**:
  - `/onboarding`: Requires authenticated session with an eligible domain. Admitted users are redirected to `/app`.
  - `/app/*`: Requires authenticated session with an active organization membership. Unauthenticated users are redirected to `/login`; uninitialized users to `/onboarding`; ineligible users to `/unauthorized`.
  - `/unauthorized`: Displays access restriction notice when user email domain is unauthorized.

---

## 6. Privacy & Security Invariants

1. **No Token Logging**: Access tokens, refresh tokens, and OAuth secrets are never written to server logs or client storage.
2. **Decoupled Identity**: Application profiles (`profiles`) never store email addresses, passwords, or provider tokens.
3. **Server-Enforced Authorization**: The browser client cannot provide organization IDs, user IDs, or roles to bypass admission.
4. **No Service-Role Key Exposure**: Client components use strictly `NEXT_PUBLIC_` keys.
