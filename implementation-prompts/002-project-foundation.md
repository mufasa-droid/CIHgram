# 002 — Project Foundation

## Purpose

This is the first implementation task for the Anonymous Messaging Platform.

The security and architecture decisions from Prompt 001 are now the foundation for implementation.

This task establishes the application foundation only.

Do **not** implement the messaging product yet.

Do **not** implement E2EE yet.

Do **not** create the complete database schema yet.

The goal is to create a clean, production-ready Next.js foundation that future implementation prompts can safely build upon.

---

# 1. Mandatory Reading

Before making any changes, read:

1. `AGENTS.md`
2. `context/01-project-overview.md`
3. `context/02-ai-workflow-rules.md`
4. `context/03-code-standards.md`
5. `context/04-ui-context.md`
6. `context/05-architecture-context.md`
7. `context/06-progress-tracker.md`
8. `context/07-product-invariants.md`
9. `context/08-security-and-privacy.md`
10. `context/09-security-and-foundation-design.md`

The latest security/foundation design takes precedence over earlier unresolved assumptions.

Do not implement anything that contradicts those documents.

---

# 2. First Inspect the Existing Project

Before installing anything:

* inspect the entire repository
* identify whether a Next.js application already exists
* inspect `package.json`
* inspect `tsconfig.json`
* inspect `next.config.*`
* inspect Tailwind configuration
* inspect existing `src/` or `app/` structure
* inspect existing environment files
* inspect Git status
* inspect existing dependencies
* identify any existing application code

Do not destroy or recreate an existing project without justification.

If the repository is already a valid Next.js application, improve the existing foundation rather than replacing it.

---

# 3. Technology Baseline

Use the architecture already established by the project context.

Expected foundation:

* Next.js App Router
* React
* TypeScript
* Tailwind CSS
* Supabase
* Supabase SSR
* Zod
* Motion
* Lucide
* Vitest
* React Testing Library
* Playwright

Use current stable versions compatible with the existing project.

Do not add dependencies simply because they are popular.

Do not install:

* Redux
* Zustand
* MobX
* Prisma
* Drizzle
* Express
* NestJS
* GraphQL
* Socket.io
* Pusher
* MUI
* Chakra
* Ant Design
* rich-text editors

unless an explicit later architecture decision requires them.

---

# 4. Dependency Installation

Install only dependencies justified by the foundation.

At minimum evaluate:

```text
@supabase/supabase-js
@supabase/ssr
zod
motion
lucide-react
vitest
@testing-library/react
@testing-library/jest-dom
@playwright/test
```

## Crypto dependency

Do **NOT** install the cryptography dependency in this task unless `context/09-security-and-foundation-design.md` explicitly selected a package and its exact usage is already sufficiently defined.

If the security design selected a crypto package but implementation details are intentionally deferred, leave it for the dedicated E2EE implementation prompt.

Do not make a new cryptographic decision here.

---

# 5. Environment Configuration

Create or update the environment variable structure required by the foundation.

Expected Supabase variables:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Use the current Supabase key terminology appropriate to the installed SDK/version.

If the project requires a server-only secret later, document it but do not expose it to client components.

## Rules

Never:

* commit secrets
* place secrets in source code
* prefix server-only secrets with `NEXT_PUBLIC_`
* expose service-role credentials to browser code
* print environment variables in logs

Create:

```text
.env.example
```

with placeholder values only.

Do not create a real `.env` containing credentials.

---

# 6. Supabase Foundation

Create a clean Supabase client architecture appropriate for Next.js App Router.

Separate:

### Browser client

Used only where browser-side Supabase interaction is intentionally required.

### Server client

Used for authenticated server-side operations.

### Server-only privileged client

Do not create this unless a later feature genuinely requires it.

If a service-role client is created later, it must:

* live in a server-only module
* never be imported into client components
* never expose its key
* never be used as a shortcut around authorization

Do not use elevated privileges to bypass security architecture.

---

# 7. Authentication Foundation

Do not build the complete onboarding experience yet.

Prepare the application for Supabase Auth with Google OAuth.

Create a clean authentication abstraction that future prompts can build on.

The foundation should support:

* retrieving the current authenticated user
* retrieving the current session where appropriate
* server-side authentication checks
* protected routes
* unauthenticated behavior
* OAuth callback handling

Do not hard-code organization admission logic into this task.

That belongs to the authentication/onboarding implementation prompt.

---

# 8. Application Structure

Establish a clean App Router structure.

Use a structure similar to:

```text
src/
├── app/
│   ├── (auth)/
│   ├── (app)/
│   ├── api/
│   ├── auth/
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
│
├── components/
│   ├── ui/
│   └── shared/
│
├── lib/
│   ├── supabase/
│   ├── auth/
│   ├── validation/
│   └── utils/
│
├── types/
│
└── config/
```

Adjust the exact structure if the existing project has a better established pattern.

Do not create empty folders simply for appearance.

Every created directory should have a clear reason.

---

# 9. Server/Client Boundaries

Follow this rule strictly:

> Server Components by default. Client Components only when interactivity or browser APIs require them.

Client Components may eventually be required for:

* message composition
* encryption/decryption
* browser key storage
* interactive search
* dialogs
* animations
* form interactions

Do not add `"use client"` unnecessarily.

Do not move the entire application into Client Components.

The security-sensitive E2EE functionality will be isolated into dedicated client-side modules in a later prompt.

---

# 10. TypeScript Configuration

Use strict TypeScript.

Ensure:

```json
{
  "compilerOptions": {
    "strict": true
  }
}
```

Do not weaken TypeScript to make errors disappear.

Do not use:

```ts
any
```

unless there is a documented, unavoidable external-library boundary and the usage is narrowly isolated.

Prefer:

* explicit types
* discriminated unions
* type guards
* inferred Zod types
* safe parsing

---

# 11. Validation Foundation

Create a reusable validation layer using Zod.

Establish a location such as:

```text
src/lib/validation/
```

Create only foundational utilities/schemas that are genuinely reusable.

Examples:

* generic ID validation
* username validation
* safe string constraints
* pagination parameters

Do not create complete message schemas yet.

Message encryption envelope validation belongs to the E2EE implementation prompt.

---

# 12. Error Handling

Establish predictable application error handling.

Create a small error model capable of distinguishing:

* authentication errors
* authorization errors
* validation errors
* not-found errors
* rate-limit errors
* internal errors

Do not expose sensitive internal details to users.

Never return:

* database credentials
* SQL errors containing sensitive data
* stack traces in production responses
* cryptographic secrets
* internal user identifiers unnecessarily

Create a consistent pattern for server-side logging.

Remember:

> Never log plaintext message content.

---

# 13. Logging Rules

Establish safe logging conventions.

Logs may contain:

* request IDs
* generic event names
* timestamps
* non-sensitive operational information
* safe error categories

Logs must never contain:

* plaintext messages
* private keys
* access tokens
* OAuth tokens
* service-role keys
* raw authorization headers
* unnecessary personal information
* decrypted message content

Do not install a logging platform yet unless the existing project already has one.

---

# 14. UI Foundation

Implement only the base visual foundation.

The design direction is:

> Quiet editorial simplicity + modern product precision + generous whitespace.

Follow:

* restrained typography
* generous whitespace
* clear hierarchy
* minimal borders
* minimal shadows
* neutral foundation
* one controlled accent
* accessible contrast
* mobile-first layouts

Avoid:

* glassmorphism
* neon gradients
* glowing backgrounds
* giant decorative blobs
* dashboard-style card grids
* excessive rounded cards
* unnecessary badges
* excessive icons
* fake statistics
* fake testimonials
* AI-generated-template aesthetics

Do not build the People page, inbox, profile, or composer yet.

---

# 15. Typography

Establish a restrained typographic system.

Prefer a clean sans-serif interface font.

Use a monospace font only where it has a genuine technical purpose.

Do not introduce excessive font weights or decorative typography.

Typography should communicate hierarchy through:

* size
* weight
* spacing
* placement

rather than decoration.

---

# 16. Accessibility Foundation

Establish baseline accessibility.

Ensure:

* semantic HTML
* keyboard navigation
* visible focus states
* accessible buttons
* accessible form labels
* appropriate heading hierarchy
* sufficient contrast
* reduced-motion support

Do not rely solely on icons to communicate important actions.

Icon-only buttons must have accessible labels.

---

# 17. Motion Foundation

Use Motion only where it improves interaction.

Motion should be:

* short
* purposeful
* subtle
* responsive

Do not create decorative animation for its own sake.

Respect:

```css
prefers-reduced-motion
```

Do not add page-wide animation systems yet.

---

# 18. Testing Foundation

Set up:

### Unit/component testing

Use:

* Vitest
* React Testing Library
* jest-dom

### E2E testing

Use:

* Playwright

Create only a minimal smoke-test foundation.

At minimum establish a test proving the application can:

* start
* render the root page
* load successfully

Do not write product-specific tests yet.

Those belong to their respective implementation prompts.

---

# 19. Code Quality

Ensure the project has working scripts for:

```text
dev
build
lint
typecheck
test
test:e2e
```

If the existing project uses different script names, preserve useful conventions while ensuring equivalent functionality.

Run:

```text
npm install
npm run lint
npm run typecheck
npm run build
npm run test
```

Run the relevant Playwright smoke test as well.

Fix genuine errors.

Do not suppress errors simply to obtain a green build.

---

# 20. Git Safety

Before modifying the project:

* inspect Git status
* do not delete unrelated work
* do not overwrite existing user code without justification
* do not commit automatically

At the end, report:

* files created
* files modified
* dependencies added
* commands run
* test/build results

---

# 21. Documentation

Update:

```text
context/06-progress-tracker.md
```

Record:

* project foundation completed
* dependencies installed
* authentication foundation status
* testing foundation status
* remaining implementation work

Do not rewrite unrelated progress history.

If any architectural decision changed during implementation, document it explicitly rather than silently changing the context.

---

# 22. Security Rules

These rules are mandatory.

Never:

* store plaintext messages
* create a conventional chat/conversation model
* expose sender identity to recipients
* trust client-provided sender IDs
* trust client-provided organization IDs
* expose service-role credentials
* store private keys on the server
* log decrypted messages
* bypass RLS without documented authorization
* create insecure crypto
* invent cryptographic primitives
* weaken product invariants

---

# 23. What This Prompt Must NOT Implement

Do not implement:

* complete Google OAuth UI
* organization onboarding
* profile editing
* people directory
* search
* message composer
* message sending
* inbox
* message decryption
* E2EE
* public-key registration
* blocks
* reports
* moderation
* database migrations
* production RLS policies
* realtime messaging

Those will be separate implementation prompts.

---

# 24. Definition of Done

This task is complete only when:

* the existing project has been inspected
* the Next.js foundation is clean and working
* required base dependencies are installed
* Supabase client architecture is established
* environment variable structure exists
* `.env.example` exists
* TypeScript strictness is enforced
* Zod foundation exists
* error handling foundation exists
* safe logging conventions are established
* App Router structure is clean
* Server/Client boundaries are respected
* UI foundation matches the design context
* accessibility foundation exists
* reduced-motion support exists
* Vitest is configured
* React Testing Library is configured
* Playwright is configured
* smoke tests pass
* lint passes
* typecheck passes
* production build passes
* progress tracker is updated
* no E2EE has been implemented
* no messaging features have been implemented
* no production database schema has been created
* no security invariant has been weakened

---

# Final Response Required From the Agent

When complete, return:

## 1. Foundation Summary

Briefly describe what was established.

## 2. Dependencies Added

List every dependency added and why.

## 3. Files Created

List the important files.

## 4. Files Modified

List the important files.

## 5. Commands Executed

List the validation commands.

## 6. Validation Results

Report:

* lint
* typecheck
* build
* unit tests
* E2E smoke test

## 7. Security Check

Confirm explicitly:

* no plaintext messaging implemented
* no private keys stored server-side
* no sender identity exposed to recipients
* no service-role credentials exposed
* no crypto implementation added unless explicitly approved by Prompt 001

## 8. Recommended Next Prompt

Recommend the next implementation stage.

**Do not continue into the next stage automatically.**
