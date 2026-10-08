# 03 --- Code Standards

## 1. General

-   TypeScript strict mode.
-   Avoid `any`.
-   Prefer explicit domain types.
-   Keep functions small and single-purpose.
-   Use descriptive names.
-   Avoid premature abstraction.
-   Keep security-sensitive logic isolated.
-   Do not duplicate authorization rules across unrelated components.

## 2. TypeScript

-   Use strict typing.
-   Prefer `type` for data shapes unless interface extension is useful.
-   Validate external input at boundaries.
-   Never trust client-provided organization IDs, sender IDs, recipient
    IDs, roles, or permissions.
-   Treat database results as untrusted external data until validated
    where appropriate.
-   Use discriminated unions for meaningful state variants.

## 3. Next.js

Use App Router conventions.

Prefer: - Server Components by default. - Client Components only for
interactivity/browser-only APIs/state. - Server Actions or Route
Handlers for mutations/API boundaries as appropriate. - Server-side
authorization before sensitive mutations. - Route-level metadata and
appropriate SEO where public pages exist.

Do not turn entire routes into Client Components merely because one
child needs interactivity.

## 4. Styling

Tailwind CSS.

Principles: - whitespace first, - restrained typography, - minimal
borders, - minimal shadows, - no gratuitous gradients, - no
glassmorphism, - no decorative blobs, - no excessive rounded cards, - no
dashboard clutter.

Use design tokens/variables for recurring visual decisions.

## 5. API and server boundaries

Every mutation must validate: - authenticated session, - organization
eligibility where applicable, - target existence, - authorization, -
block state, - rate limit, - input shape.

Never trust UI state as authorization.

For anonymous messaging, recipient-facing responses must not include
sender identity.

## 6. Data and storage

Use Supabase/Postgres as the primary data store.

Database access should follow a clear pattern and centralized
server-side helpers.

Use Row Level Security where appropriate.

Store encrypted message content as ciphertext, never plaintext.

Profile images belong in object storage, not database blobs.

## 7. File organization

Prefer feature-oriented organization when useful:

-   `app/` for routes/pages
-   `components/` for reusable UI
-   `features/` for substantial domain-specific UI/logic when warranted
-   `lib/` for infrastructure and shared utilities
-   `types/` for shared domain types where needed
-   `supabase/` for migrations/configuration
-   `context/` for project documentation
-   `implementation-prompts/` for agent tasks

Do not create folders for every tiny component.

## 8. Errors and loading

Every networked experience should have intentional: - loading state, -
empty state, - error state, - success feedback.

Avoid leaking internal errors, database details, stack traces, or
sensitive identifiers to users.

## 9. Accessibility

-   Semantic HTML.
-   Keyboard support.
-   Visible focus states.
-   Appropriate labels.
-   Dialogs must trap/manage focus correctly.
-   Color must not be the only signal.
-   Respect reduced-motion preferences.

## 10. Testing

Test: - authorization, - block enforcement, - message creation, -
anonymity boundary, - encryption/decryption integration, - organization
isolation, - reporting, - critical UI flows.

Use unit/integration tests for logic and Playwright for important
end-to-end journeys.
