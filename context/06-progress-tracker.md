# 06 --- Progress Tracker

## Current phase

Phase 0 --- Product and architecture definition.

## Current goal

Freeze the product model, technical stack, security boundaries, data
model, and implementation workflow before feature implementation.

## Completed

-   Product concept defined.
-   Organization-first launch model defined.
-   Future public-network direction identified.
-   Everyone within the applicable discovery scope can discover
    everyone.
-   One-way messaging chosen.
-   Recipient does not see sender identity.
-   Platform may know sender/recipient relationship.
-   Message content must use end-to-end encryption.
-   Server must not store message plaintext.
-   Blocking behavior defined.
-   Reporting behavior defined at product level.
-   Moderation direction defined.
-   Minimal, whitespace-heavy UI direction defined.
-   Next.js/TypeScript/Supabase/Vercel stack selected.
-   Context-document system defined.
-   Security foundation design completed (`context/09-security-and-foundation-design.md`).
-   E2EE protocol selected: Libsodium Sealed Box (Curve25519 + XSalsa20-Poly1305 via `libsodium-wrappers`).
-   Private key lifecycle and user recovery phrase backup defined.
-   Organization admission via verified Google domain match defined.
-   Message-read API anonymity dual defense (PostgreSQL security barrier view + Server Actions) defined.
-   Abuse reporting explicit disclosure mechanism defined.
-   Message deletion semantics and 30-day ciphertext purge lifecycle defined.
-   Database schema, indexes, and RLS / server authorization matrix defined.
-   Project foundation established (Next.js 16 App Router, TypeScript strict mode, Tailwind CSS v4).
-   Supabase client architecture established (@supabase/ssr browser client, async server client, middleware session updater, schema types).
-   Environment configuration structured (.env.example, client/server Zod schemas).
-   Authentication foundation implemented (session guards, requireUser, OAuth callback route).
-   Operational error handling and safe response formatting established (AppError hierarchy).
-   Privacy-preserving structured logging established (automatic credential and plaintext redaction).
-   Shared UI foundation created (Button, Input, Surface, Container, Header, editorial landing page, accessible focus rings, reduced-motion overrides).
-   Unit testing configured and validated (Vitest + React Testing Library + jest-dom, 15 tests passing).
-   E2E testing configured and validated (Playwright smoke tests passing).
-   Production build validated (Next.js static optimization and route compilation passing).
-   Database migration structure established (`supabase/config.toml`, `supabase/migrations/`).
-   Core schemas implemented (`organizations`, `profiles`, `organization_members`) with strict constraints and indexes.
-   Non-recursive `SECURITY DEFINER` authorization helpers created (`is_org_member`, `is_org_admin`, `shares_active_organization`).
-   Comprehensive Row Level Security (RLS) policies implemented on all three core tables.
-   Database architecture documentation created (`docs/database.md`).
-   Database schema and security invariant tests validated (24 tests passing).
-   Authentication and Google OAuth domain matching onboarding completed (`implementation-prompts/004 — Google-OAuth-Authentication-&-Organization-Onboarding.md`).
-   Domain verification and suffix spoofing defense implemented and tested (`src/lib/auth/domains.ts`, 100% test coverage).
-   Server-side admission migration created (`supabase/migrations/20261008000001_organization_admission.sql`) with atomic `admit_user_to_organization` function and fixed `search_path`.
-   Multi-state routing implemented (`/login`, `/auth/callback`, `/auth/signout`, `/unauthorized`, `/onboarding`, `/app`).
-   Editorial onboarding page and server action implemented with Zod validation.
-   Authentication architecture guide documented (`docs/authentication.md`).
-   Authentication and onboarding test suite validated (39 unit tests passing across 7 suites; 5 Playwright E2E tests passing).

## In progress

-   None (Prompt 004 completed).

## Next up

1.  Implement discovery and directory search (Prompt 005).
2.  Implement E2EE cryptographic foundation (Libsodium Sealed Box).
3.  Implement message composer and send flow.
4.  Implement inbox and recipient decryption.
5.  Implement profile/settings.
6.  Implement block/report/moderation.
7.  Testing and production hardening.


## Open questions

-   None blocking v1 foundation.
-   (Future v2) Moderator public-key rotation for re-encrypted report delivery.
-   (Future v2) Automated client-side ephemeral key rotation reminder schedule.

## Architecture decisions

### AD-001 --- Organization-first, not organization-locked

The initial deployment is for an organization, but the data model
supports future organizations and public users.

### AD-002 --- Recipient anonymity

Recipient never receives sender identity through normal application
responses.

### AD-003 --- Platform accountability

The platform retains sender/recipient relationship metadata for security
and abuse controls.

### AD-004 --- E2EE

Message plaintext is encrypted client-side and stored as ciphertext.

### AD-005 --- One-way messaging

No conversation/reply model in the initial release.

### AD-006 --- Transient composer

Each opening creates a new message composer.

### AD-007 --- Server-enforced blocking

Blocking is enforced at the server/API boundary, not only in the UI.

### AD-008 --- Minimal UI

Whitespace, hierarchy, typography, and interaction quality are
prioritized over decoration.

### AD-009 --- Supabase foundation

Supabase provides authentication, PostgreSQL, storage, and RLS
capabilities.

### AD-010 --- Libsodium Sealed Box for One-Way E2EE

Curve25519 + XSalsa20-Poly1305 via `libsodium-wrappers` used for client-side
encryption. Sender cannot decrypt sealed message; recipient cannot identify
sender from ephemeral key; zero bespoke crypto.

### AD-011 --- Organization admission via verified domain registry

Google OAuth email domain verified server-side against `organizations.allowed_domains`.
Zero hardcoded organization names in codebase.

### AD-012 --- Dual-boundary anonymity enforcement

PostgreSQL security barrier view (`recipient_inbox_messages`) excludes `sender_id`
at the database level. Server Actions enforce typing and session boundary.

### AD-013 --- Abuse reporting via informed-consent plaintext disclosure

Users explicitly consent to share abusive plaintext with authorized moderators.
Disclosed content lives strictly in isolated `reports` table; normal message
store remains strictly ciphertext.

### AD-014 --- Recipient soft-delete with 30-day ciphertext purge

Recipients soft-delete from inbox (`deleted_by_recipient = true`). Ciphertext
is purged after 30 days unless referenced by an open abuse investigation.

### AD-015 --- Server-enforced atomic organization admission procedure

Organization onboarding and membership initialization are executed via a single
PostgreSQL `SECURITY DEFINER` function (`admit_user_to_organization`) with a fixed
`search_path`. Membership role is strictly hardcoded to `'member'` in the procedure;
client-supplied roles or organization IDs are strictly rejected. Suffix spoofing is
prevented via exact domain extraction and equality matching against `allowed_domains`.

## Session notes

### Initial architecture session

Product boundaries were defined with the user. The application begins
inside an organization but should be architected for future expansion.
E2EE is a hard privacy requirement.

### Security foundation design session

Prompt 001 executed. Produced `context/09-security-and-foundation-design.md`,
resolving the 5 critical security decisions: E2EE protocol, key lifecycle,
organization admission, read API anonymity enforcement, abuse reporting disclosure,
and deletion semantics. Ready for initial project setup.

### Project foundation session

Prompt 002 executed. Established clean Next.js 16 App Router foundation with
strict TypeScript, Tailwind CSS v4, and `@supabase/ssr` architecture (browser,
async server client, middleware session synchronization). Structured environment
configuration and Zod validation layers. Built operational error hierarchy and
privacy-preserving structured logger with automated redaction of credentials and
message contents. Implemented quiet editorial UI foundation (Button, Input,
Surface, Container, Header, and product landing page). Configured and validated
Vitest (15 passing unit tests) and Playwright (2 passing smoke tests), and verified
full production build. No messaging, database migrations, or E2EE implementation
was introduced. Ready for database migrations and authentication flow.

### Database migration structure and core schemas session

Prompt 003 executed. Established Supabase migration structure with `supabase/config.toml`
and migration `20261008000000_initial_core_schema.sql`. Created core PostgreSQL tables
`organizations`, `profiles`, and `organization_members` with comprehensive constraints,
check clauses, auto-updating `updated_at` triggers, and targeted B-tree indexes. Implemented
non-recursive `SECURITY DEFINER` authorization functions (`is_org_member`, `is_org_admin`,
`shares_active_organization`) with fixed search paths. Activated Row Level Security (RLS) on
all three tables, enforcing organization isolation and self-service mutation boundaries.
Synchronized TypeScript database types and created comprehensive architecture guide in
`docs/database.md`. Added automated schema and security invariant tests in `src/lib/supabase/schema.test.ts`
(24 tests passing). Ready for authentication flow implementation.

### Google OAuth authentication and organization onboarding session

Prompt 004 executed. Implemented Google OAuth authentication flow with server-side organization
admission via verified email domains. Built pure domain extraction and suffix-spoofing defense
in `src/lib/auth/domains.ts` (100% test coverage). Created migration `20261008000001_organization_admission.sql`
with atomic `admit_user_to_organization`, `find_organization_by_domain`, and `get_current_user_status`
routines with fixed `search_path`. Implemented Next.js route handlers (`/auth/login`, `/auth/callback`,
`/auth/signout`), access-restricted screen (`/unauthorized`), editorial onboarding flow (`/onboarding`,
`OnboardingForm`, `completeOnboarding` server action), and authenticated workspace shell (`/app`).
Authored architectural guide in `docs/authentication.md`. Validated all test suites: Vitest unit tests
(39 passing across 7 suites), Playwright E2E tests (5 passing), TypeScript compilation (`tsc --noEmit`),
ESLint (`eslint`), and Next.js production build (`next build`).




