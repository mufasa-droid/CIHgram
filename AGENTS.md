# Project Agent Instructions

## Purpose

This repository contains an organization-first anonymous messaging
platform. Read the context files before implementing any feature.

## Mandatory reading order

Before any implementation: 1. `context/01-project-overview.md` 2.
`context/02-ai-workflow-rules.md` 3. `context/03-code-standards.md` 4.
`context/04-ui-context.md` 5. `context/05-architecture-context.md` 6.
`context/06-progress-tracker.md` 7. `context/07-product-invariants.md`
8. `context/08-security-and-privacy.md`

Then read the specific implementation prompt supplied for the current
unit.

## Non-negotiable agent behavior

-   Do not invent product requirements when a requirement is missing.
-   Do not silently change architecture decisions.
-   Do not implement future features "because they may be useful."
-   Do not weaken anonymity or encryption for convenience.
-   Do not expose sender identity to recipients.
-   Do not store message plaintext on the server.
-   Do not create a conventional chat/conversation model.
-   Do not introduce a second backend or unnecessary infrastructure.
-   Preserve existing foundation components unless the current task
    explicitly requires changing them.
-   Prefer small, composable components and server-enforced
    authorization.
-   Run relevant type checks, linting, tests, and build checks before
    declaring a unit complete.
-   Update `context/06-progress-tracker.md` after completing a unit.
-   Record meaningful architectural decisions in the tracker.
-   If a security-sensitive requirement is unclear, stop and ask rather
    than guessing.

## Current stack

Next.js App Router, TypeScript, React, Tailwind CSS, Supabase, Vercel,
Zod, Motion, Lucide, Vitest, Playwright.

## Cryptography warning

Do not invent or improvise a cryptographic protocol. The E2EE design
must use a well-reviewed, documented approach and must be reviewed
before production release. Browser Web Crypto primitives are not by
themselves a complete messaging protocol.

## Definition of done

A feature is not complete merely because it renders. It must satisfy its
product behavior, authorization boundary, privacy requirements,
accessibility expectations, responsive behavior, error states, loading
states, and relevant automated checks.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
