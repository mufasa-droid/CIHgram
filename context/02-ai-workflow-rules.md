# 02 --- AI Workflow Rules

## 1. Approach

The AI agent is an implementation partner, not the product owner or
architect.

The agent must implement the current unit only, using the repository
context as the source of truth.

The agent should prefer: - existing patterns over new abstractions, -
small changes over broad refactors, - explicit requirements over
assumptions, - server-enforced security over client-only checks, -
accessible native behavior over decorative interaction.

## 2. Scoping rules

Each implementation prompt must define: - objective, - allowed
files/areas, - requirements, - non-goals, - acceptance criteria, -
validation commands.

Do not implement adjacent features unless required for the current
feature to function.

## 3. When to split work

Split a task when: - it introduces a new architectural subsystem, - it
changes database schema, - it changes authentication, - it changes
encryption/key management, - it affects multiple major user journeys, -
it is large enough that testing becomes ambiguous.

Security-sensitive changes should be isolated whenever practical.

## 4. Handling missing requirements

If a missing requirement could affect: - security, - privacy, - data
model, - authorization, - encryption, - public API shape, - destructive
behavior,

stop and ask.

For low-risk visual details, choose the simplest option consistent with
the UI context and document the decision.

Never silently invent a security policy.

## 5. Protect foundation components

Do not replace: - authentication architecture, - database access
layer, - encryption layer, - authorization helpers, - design-system
primitives, - routing structure,

unless the task explicitly calls for it or the existing implementation
is demonstrably incorrect.

If a change is necessary, explain the impact and update architecture
documentation.

## 6. Keep documentation in sync

After each completed unit: - update progress, - mark completed items, -
record remaining work, - record architecture decisions, - record
unresolved questions.

Documentation is part of the implementation, not an optional extra.

## 7. Before moving to the next unit

Confirm: - acceptance criteria pass, - relevant tests pass, - lint/type
checks pass, - build passes when appropriate, - no plaintext message
data was introduced, - no recipient-visible sender identity was
introduced, - organization authorization remains intact, - no
unnecessary dependency was added.

## 8. Dependency rules

Before adding a dependency: 1. Check whether the existing stack already
solves the problem. 2. Check whether the dependency is maintained and
appropriate. 3. Prefer a small, focused dependency. 4. For cryptography,
use an established implementation/protocol rather than writing one.

Do not add libraries simply because they are fashionable.
