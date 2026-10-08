# Prompt 004 — Google OAuth Authentication & Organization Onboarding

## Objective

Implement the authentication and first-time onboarding foundation for the anonymous messaging platform.

This task comes immediately after:

* Prompt 001 — Security & Foundation Design
* Prompt 002 — Project Foundation
* Prompt 003 — Database Migration Structure & Core Schemas

The database foundation now exists for:

* `organizations`
* `profiles`
* `organization_members`

The next goal is to connect authenticated Google users to the correct application identity and organization membership.

This prompt is **authentication and onboarding only**.

Do not implement messaging, E2EE, public keys, blocks, reports, moderation, or member discovery yet.

---

# 1. Mandatory Context Reading

Before changing any code, read the following files completely:

* `AGENTS.md`
* `context/01-project-overview.md`
* `context/02-ai-workflow-rules.md`
* `context/03-code-standards.md`
* `context/04-ui-context.md`
* `context/05-architecture-context.md`
* `context/06-progress-tracker.md`
* `context/07-product-invariants.md`
* `context/08-security-and-privacy.md`
* `context/09-security-and-foundation-design.md`
* `docs/database.md`

Also inspect the current implementation created by Prompts 002 and 003.

Do not assume that an earlier architectural decision should be changed.

If this prompt conflicts with `context/09-security-and-foundation-design.md`, the security-and-foundation design takes precedence.

---

# 2. First Audit the Existing Authentication Foundation

Before implementation, inspect:

* current Supabase browser client
* current Supabase server client
* current auth callback route
* current login page
* current middleware/proxy configuration, if present
* current environment variables
* current TypeScript types
* current database migration
* current RLS policies
* current tests

Determine exactly what already exists.

Do not recreate existing infrastructure unnecessarily.

---

# 3. Google OAuth

Implement Google OAuth through Supabase Auth.

The intended user experience is:

1. User visits the application.
2. User chooses "Continue with Google".
3. Google authentication occurs.
4. Supabase establishes the authenticated session.
5. The application processes the authenticated account.
6. The application determines whether the user is an eligible member of the initial organization according to the organization-admission decision in:

`context/09-security-and-foundation-design.md`

7. The user is either:

   * initialized and admitted into the application, or
   * shown an appropriate access/onboarding state.

Do not create an alternative password-based authentication system unless it already exists and is explicitly required by the context.

---

# 4. Organization Admission

This is a critical security boundary.

Read the organization admission model selected in:

`context/09-security-and-foundation-design.md`

Implement exactly that model.

The current database foundation supports organization-level admission through the `organizations` table and its configured admission data.

Do not hard-code:

* organization names
* organization IDs
* email addresses
* domains
* roles
* membership decisions

The application must derive organization eligibility from database-backed configuration.

### Important

Never trust organization information supplied by the browser.

The client must not be able to say:

> "I belong to organization X."

The server must determine eligibility.

If domain matching is part of the selected admission strategy:

* normalize the authenticated email/domain safely
* compare it against the organization's configured allowed domain(s)
* perform the authorization check server-side
* never rely exclusively on a client-side domain check

Be careful with:

* uppercase/lowercase domains
* malformed email addresses
* missing email addresses
* OAuth accounts without usable email information
* subdomain handling
* exact-domain vs suffix matching

Do not implement permissive matching such as:

```text
email.endsWith("example.com")
```

unless the security design explicitly requires a carefully defined equivalent.

Avoid accidental matches such as:

```text
attackerexample.com
```

matching:

```text
example.com
```

---

# 5. First-Time Account Initialization

After successful authentication, determine whether the authenticated user already has:

* a `profiles` row
* an eligible `organization_members` row

If this is a first-time account:

Create the required application records.

At minimum:

```text
auth.users
    ↓
profiles
    ↓
organization_members
    ↓
organizations
```

The exact implementation must follow the database/security design.

Do not duplicate authentication identity data unnecessarily.

Supabase Auth remains the source of truth for authentication identity.

The application profile should contain only application-level profile information.

---

# 6. Profile Creation

Implement first-time profile initialization.

The profile should be associated with the authenticated Supabase user ID.

Use the existing database schema.

Do not add unnecessary fields.

Potential initial values may come from the authenticated OAuth identity where appropriate, such as:

* display name
* avatar URL

However:

* never store OAuth access tokens
* never store OAuth refresh tokens in the profile
* never store provider secrets
* never expose provider tokens to the client
* do not blindly trust arbitrary OAuth metadata for authorization

The user should later be able to edit their profile through a dedicated profile flow.

That editing flow is **not part of this prompt** unless required to complete initialization.

---

# 7. Username Handling

If the current schema requires or expects a username, implement the minimum safe initialization behavior required by the database design.

Do not invent a complex username system.

If username selection is required during onboarding:

* make it explicit to the user
* validate it server-side
* enforce uniqueness at the database level
* normalize consistently
* prevent impersonation-oriented behavior where practical
* never trust client-side uniqueness checks alone

If the security/design documents intentionally defer username selection, leave it deferred rather than inventing requirements.

---

# 8. Organization Membership Creation

When a user is eligible for an organization, create the appropriate `organization_members` record.

Use the role/status model established by Prompt 003.

Do not allow the browser to choose:

```text
role = admin
```

or any privileged membership state.

Normal users must receive the standard member role.

Administrative membership must remain controlled by a trusted server-side/admin mechanism.

Do not create arbitrary organizations during signup.

Do not allow users to self-promote.

Do not allow users to modify their own organization membership.

---

# 9. Idempotency

Account initialization must be safe to run multiple times.

OAuth callbacks can be retried.

Users can refresh pages.

Network requests can fail and be repeated.

Therefore:

* do not create duplicate profiles
* do not create duplicate organization memberships
* use existing database constraints
* use upsert/insert-on-conflict semantics where appropriate
* make initialization deterministic

A user completing OAuth twice should still have exactly one application profile and one applicable membership.

---

# 10. Server-Side Authorization

Do not perform sensitive onboarding decisions entirely in client components.

The server must determine:

* authenticated user
* authenticated email
* organization eligibility
* existing membership
* profile existence
* whether initialization is required
* whether access should be granted

Client-side checks may improve UX, but they are not security boundaries.

Do not expose service-role credentials to the browser.

Do not introduce a service-role shortcut simply to make onboarding easier.

If privileged database operations are required, follow the security design's approved server-side mechanism.

---

# 11. Authenticated Routing

Establish clear routing behavior.

At minimum, distinguish:

### Unauthenticated user

Can access:

* public landing/login experience

Cannot access:

* authenticated application pages

### Authenticated but not initialized

Should be routed into the appropriate onboarding/access state.

### Authenticated and authorized

Can access the authenticated application shell.

### Authenticated but unauthorized

Must not gain access to the organization's application.

Do not leak unnecessary information about organization membership or internal organization configuration.

Avoid revealing:

* organization IDs
* internal database IDs
* membership internals
* other users' information

unless explicitly required by the UI.

---

# 12. Session Handling

Use the existing Supabase session architecture.

Ensure authenticated pages can reliably determine the current user server-side.

Avoid insecure patterns such as:

```ts
const userId = searchParams.get("userId")
```

or:

```ts
const organizationId = requestBody.organizationId
```

without server-side verification.

The authenticated session must remain the authority for the current user identity.

---

# 13. Middleware / Proxy

Inspect the current Next.js version and authentication architecture before modifying middleware/proxy behavior.

Use the current project convention rather than blindly applying an outdated Next.js example.

If route protection is appropriate, implement it cleanly.

Do not put database-heavy authorization logic into middleware if that would create unnecessary complexity or conflict with the architecture.

The important requirement is:

> Protected application routes must not be usable by unauthenticated or unauthorized users.

---

# 14. Login UX

Keep the login experience consistent with the project's established UI direction:

> Quiet editorial simplicity + modern product precision + generous whitespace.

The login page should be:

* minimal
* calm
* responsive
* accessible
* fast
* obvious

Prefer one clear primary action:

**Continue with Google**

Avoid:

* gradients
* glassmorphism
* excessive cards
* unnecessary illustrations
* excessive animation
* marketing dashboards
* fake statistics
* unnecessary badges
* decorative clutter

Use Motion only where it improves interaction.

Respect:

```css
prefers-reduced-motion
```

---

# 15. Loading and Error States

Implement appropriate states for:

* OAuth redirect
* authentication failure
* unauthorized organization
* onboarding failure
* profile initialization failure
* membership initialization failure
* expired session

Do not expose internal database errors directly to users.

User-facing messages should be concise and understandable.

Detailed internal errors must not leak:

* SQL
* stack traces
* tokens
* private data
* internal IDs

---

# 16. Security Requirements

This prompt must preserve all existing security invariants.

Never:

* expose Supabase service-role credentials
* expose OAuth tokens unnecessarily
* log access/refresh tokens
* log session secrets
* log private keys
* log message plaintext
* create message plaintext
* create E2EE keys
* expose sender identity
* bypass RLS without documented justification
* trust browser-supplied organization IDs
* trust browser-supplied user IDs
* allow client-side role escalation

Remember:

Authentication is not authorization.

A valid Google account does not automatically mean the user is authorized to access the organization.

---

# 17. Do Not Implement E2EE Yet

Do not implement:

* `public_keys`
* Libsodium
* sealed boxes
* private keys
* key storage
* encryption
* message encryption
* decryption
* encrypted message envelopes

Those belong to the dedicated E2EE implementation phase after authentication and organization authorization are stable.

Do not install a cryptography package as part of this prompt unless it is genuinely required by existing security architecture.

---

# 18. Do Not Implement Messaging Yet

Do not implement:

* message tables
* message sending
* message reading
* message composer
* conversations
* chat UI
* replies
* inbox
* stars/favorites

This prompt ends at authenticated application access and onboarding.

---

# 19. Testing

Add focused tests for authentication/onboarding behavior.

At minimum test:

### Authentication

* unauthenticated users cannot access protected application routes
* authenticated users can reach the appropriate application route
* authentication errors produce safe user-facing errors

### Organization admission

* eligible user can be admitted
* ineligible user is rejected
* malformed/missing email is handled safely
* domain matching cannot be bypassed with a malicious suffix
* organization configuration is not client-controlled

### Profile initialization

* first login creates a profile
* repeated initialization does not duplicate the profile
* authenticated user cannot initialize a profile for another user

### Membership

* eligible user receives the correct membership
* duplicate membership is prevented
* normal users cannot assign themselves admin
* users cannot arbitrarily change organization membership

### Authorization

* authenticated but unauthorized users cannot access protected application pages
* cross-organization access is rejected

Use the existing testing stack.

Do not create brittle tests that depend on production OAuth providers.

Mock or isolate provider behavior appropriately.

---

# 20. Documentation

Update:

`docs/database.md`

only if authentication/onboarding changes require additional database explanation.

Create or update an authentication documentation file if the project structure benefits from one, for example:

```text
docs/authentication.md
```

Document:

* authentication flow
* Google OAuth flow
* organization admission
* profile initialization
* membership initialization
* route protection
* important security boundaries
* environment variables
* local development setup

Do not document secrets themselves.

---

# 21. Progress Tracker

Update:

`context/06-progress-tracker.md`

Record:

* Prompt 004 completed
* Google OAuth foundation implemented
* organization admission implemented
* profile initialization implemented
* membership initialization implemented
* authenticated routing implemented
* tests added
* validation results
* any deferred issues

Do not mark E2EE or messaging as complete.

Clearly identify the next phase.

---

# 22. Validation

Before declaring completion, run the project's relevant checks:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

Also run any available Supabase migration/database validation commands appropriate to the existing local setup.

Fix all errors caused by your implementation.

Do not weaken TypeScript strictness or tests simply to make validation pass.

---

# 23. Final Security Audit Before Completion

Before finishing, explicitly inspect the implementation for:

* client-exposed service-role credentials
* client-controlled organization IDs
* client-controlled user IDs
* client-controlled roles
* insecure domain matching
* duplicate account initialization
* duplicate memberships
* cross-organization access
* OAuth token leakage
* sensitive logging
* authorization performed only on the client
* route protection bypasses

If any are found, fix them before completion.

---

# 24. Final Response Format

When finished, report:

## 1. Implementation Summary

What was implemented.

## 2. Authentication Flow

Explain the final Google OAuth flow.

## 3. Organization Admission

Explain exactly how eligibility is determined.

## 4. Account Initialization

Explain profile and membership creation.

## 5. Authorization

Explain how protected routes and organization access are enforced.

## 6. Files Created/Modified

List important files.

## 7. Tests Added

List the authentication/onboarding/security tests.

## 8. Validation Results

Report:

* lint
* typecheck
* unit tests
* build
* E2E
* Supabase/database validation

Use actual results.

## 9. Security Review

Confirm:

* no service-role exposure
* no client-controlled authorization
* no insecure domain matching
* no duplicate initialization
* no cross-organization access
* no sensitive token logging

## 10. Deferred Work

Explicitly state that these remain unimplemented:

* E2EE
* public keys
* encrypted messages
* message sending
* message reading
* blocks
* reports
* moderation
* member discovery

## 11. Recommended Next Prompt

Recommend the next implementation task based on the actual state of the repository.

Do not invent successful validation results.
Do not claim functionality that was not actually implemented.
