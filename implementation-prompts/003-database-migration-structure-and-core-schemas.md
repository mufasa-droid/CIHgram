# 003 — Database Migration Structure & Core Schemas

## Purpose

Establish the PostgreSQL/Supabase database foundation for the Anonymous Messaging Platform.

This task creates the initial database migration structure and implements the core identity and organization tables.

This prompt is intentionally limited.

Do **NOT** implement:

* E2EE
* cryptographic keys
* messages
* message encryption
* inboxes
* message sending
* blocks
* reports
* moderation
* realtime messaging

Those belong to later implementation prompts.

---

# 1. Mandatory Reading

Before making any changes, read:

1. `AGENTS.md`
2. `context/01-project-overview.md`
3. `context/02-ai-workflow-rules.md`
4. `context/03-code-standards.md`
5. `context/05-architecture-context.md`
6. `context/06-progress-tracker.md`
7. `context/07-product-invariants.md`
8. `context/08-security-and-privacy.md`
9. `context/09-security-and-foundation-design.md`

Pay particular attention to:

* organization isolation
* authentication boundaries
* RLS requirements
* user identity
* privacy
* future multi-organization support

Do not contradict the security foundation design.

---

# 2. Inspect Existing Supabase Setup

Before creating anything:

* inspect the repository for existing Supabase configuration
* inspect whether a `supabase/` directory exists
* inspect existing migrations
* inspect any SQL files
* inspect Supabase configuration
* inspect environment configuration
* inspect package scripts

Do not delete existing migrations.

If migrations already exist, understand their purpose and continue from the current state.

---

# 3. Migration Strategy

Use Supabase CLI migrations.

Establish:

```text
supabase/
├── config.toml
└── migrations/
    └── <timestamp>_initial_core_schema.sql
```

If the project already has a Supabase migration structure, preserve it.

Migrations must be:

* deterministic
* ordered
* reviewable
* idempotency-conscious
* safe to apply from a clean database

Do not manually modify the production database outside migrations.

---

# 4. Core Tables

Implement these four foundational tables:

```text
organizations
profiles
organization_members
```

Do not implement `public_keys` or `messages` yet.

---

# 5. Organizations

Create:

```text
organizations
```

Purpose:

Represents a tenant/organization in the platform.

Recommended conceptual fields:

```text
id
name
slug
created_at
updated_at
```

Requirements:

* UUID primary key
* generated server-side
* `name` required
* `slug` required
* slug unique
* timestamps generated server-side
* appropriate constraints
* no unnecessary fields

Do not hard-code the initial organization's name into database logic.

The architecture must support multiple organizations.

---

# 6. Profiles

Create:

```text
profiles
```

Purpose:

Stores public application-level profile information associated with an authenticated Supabase user.

The profile should reference:

```text
auth.users(id)
```

Conceptual fields:

```text
id
username
display_name
avatar_url
bio
created_at
updated_at
```

Requirements:

* `id` is the same UUID as `auth.users.id`
* foreign key to `auth.users(id)`
* appropriate delete behavior
* username uniqueness must be considered
* profile data must not contain authentication secrets
* do not duplicate email unnecessarily
* do not store OAuth provider tokens
* do not store passwords

Do not expose:

* auth provider access tokens
* refresh tokens
* internal authentication secrets

---

# 7. Organization Members

Create:

```text
organization_members
```

Purpose:

Connects platform users to organizations.

Conceptual fields:

```text
id
organization_id
user_id
role
status
joined_at
created_at
updated_at
```

Use explicit constraints.

At minimum:

```text
organization_id → organizations.id
user_id → auth.users.id
```

Prevent duplicate membership for the same user and organization.

The architecture must support:

```text
one user → multiple organizations
```

even if the initial deployment uses only one organization.

---

# 8. Roles

Define a minimal role model.

At minimum consider:

```text
member
admin
```

Do not create a large RBAC system yet.

Use a constrained database value rather than arbitrary strings if appropriate.

Do not trust role values supplied by the client.

Future moderator roles can be introduced in a later migration if the architecture requires them.

---

# 9. Membership Status

Define a minimal status model appropriate for the product.

For example:

```text
active
pending
suspended
removed
```

Do not add statuses that have no current purpose.

Document the meaning of every status you create.

---

# 10. Row Level Security

RLS is a mandatory security layer.

Enable RLS on:

```text
organizations
profiles
organization_members
```

Do not leave these tables publicly readable.

---

# 11. Profiles RLS

Define policies so authenticated users can:

### Read

Read only profile information that the application intentionally exposes.

The policy must not accidentally expose authentication information.

### Update

A user can update only their own profile.

A user must not be able to update:

* another user's profile
* their own role
* their own organization membership
* authentication identity
* moderation state

Do not put authorization logic in the frontend only.

---

# 12. Organization RLS

Users must not automatically gain access to every organization simply because they are authenticated.

Define policies around organization membership.

An authenticated user should only be able to access organizations they are legitimately associated with, subject to the product's future organization rules.

Do not implement the complete onboarding/admission flow yet.

The RLS foundation should make unauthorized cross-organization access difficult by default.

---

# 13. Organization Membership RLS

Membership is security-sensitive.

Normal members must not be able to arbitrarily:

* add themselves to organizations
* add other users
* change their role
* change another user's role
* mark themselves as active
* remove other members
* change membership status

Do not rely on client-side checks.

Where privileged membership operations are required, they should eventually go through a properly authorized server-side flow.

Do not create a service-role shortcut merely to make development easier.

---

# 14. SECURITY DEFINER Functions

If database functions are necessary for secure authorization checks:

* keep them minimal
* explicitly set `search_path`
* avoid dynamic SQL where unnecessary
* restrict execution permissions
* document why the function requires elevated execution

Do not create SECURITY DEFINER functions merely for convenience.

---

# 15. Indexes

Create only useful indexes.

At minimum consider:

### organizations

```text
slug
```

### profiles

```text
username
```

### organization_members

```text
organization_id
user_id
```

Ensure the unique membership constraint supports efficient lookup.

Do not create excessive indexes without justification.

---

# 16. Constraints

Use the database to enforce invariants wherever practical.

Examples:

* required fields
* valid UUID relationships
* unique organization slug
* unique username where appropriate
* unique `(organization_id, user_id)`
* valid role
* valid membership status

Do not rely exclusively on application validation for fundamental database invariants.

---

# 17. Timestamps

Use database-generated timestamps.

Do not trust clients to submit:

```text
created_at
updated_at
joined_at
```

where server/database generation is appropriate.

---

# 18. User Deletion

Define foreign-key behavior carefully.

Consider what should happen when an authenticated user is deleted from:

```text
auth.users
```

Do not blindly use cascading deletes.

Document the chosen behavior.

Remember that later message/accountability requirements may require retaining certain non-content records.

Do not implement message retention yet.

---

# 19. Seed Data

Do NOT create fake application users.

Do NOT create fake authentication accounts.

If a development organization seed is useful, keep it clearly isolated from production behavior.

Do not hard-code the actual organization's identity unless explicitly provided through configuration.

---

# 20. Database Types

After creating the schema, generate or update database types if the existing project uses generated Supabase types.

Keep generated types synchronized with the migration state.

Do not manually fake database types.

---

# 21. Application Integration

Add only the minimal application-side types/helpers necessary to use the new schema safely.

Do not build:

* organization dashboard
* profile page
* onboarding
* people directory
* search
* messaging

Those belong to later prompts.

---

# 22. Validation

Before declaring completion:

Run the appropriate project checks:

```text
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
npm.cmd run test:e2e
```

Also validate the database migration using the available Supabase CLI/local environment.

If a local Supabase environment is available, test:

1. migration applies cleanly
2. migration can be reset/reapplied
3. tables exist
4. constraints exist
5. indexes exist
6. RLS is enabled
7. policies behave as intended

Do not claim RLS works based only on reading the SQL.

Actually test it where the available environment allows.

---

# 23. Security Tests

Create focused database/security tests for:

### Profiles

* authenticated user can access their allowed profile
* user cannot update another user's profile

### Organizations

* unauthorized organization access is denied

### Membership

* normal user cannot arbitrarily modify membership
* duplicate membership is rejected
* cross-organization access is rejected

### Identity

* users cannot modify authentication identity through profile operations

Do not create message security tests yet.

---

# 24. Documentation

Update:

```text
context/06-progress-tracker.md
```

Record:

* database migration foundation completed
* core schemas created
* RLS foundation created
* validation results
* remaining database work

If the actual implementation differs from `context/09-security-and-foundation-design.md`, stop and explain the discrepancy instead of silently changing architecture.

---

# 25. Required Database Documentation

Create:

```text
docs/database.md
```

Document:

* table purpose
* relationships
* important constraints
* roles/statuses
* RLS philosophy
* migration workflow
* how to apply/reset migrations locally
* how database types are generated
* security considerations

Keep it concise and implementation-oriented.

---

# STRICT RULES

## DO NOT

* implement E2EE
* install crypto libraries
* create `messages`
* create `public_keys`
* create `blocks`
* create `reports`
* create moderation tables
* implement messaging
* implement inbox
* implement search
* create fake users
* expose service-role keys
* bypass RLS
* create unrestricted policies
* use frontend-only authorization
* weaken organization isolation

## DO

* use migrations
* use foreign keys
* use constraints
* use indexes intentionally
* enable RLS
* test RLS
* keep organization logic tenant-safe
* preserve future multi-organization support
* keep authentication identity separate from application profile data
* document security decisions
* keep the schema minimal

---

# Definition of Done

This task is complete only when:

* Supabase migration structure is established
* `organizations` exists
* `profiles` exists
* `organization_members` exists
* foreign keys are correct
* constraints are correct
* useful indexes exist
* RLS is enabled
* RLS policies are implemented
* unauthorized membership manipulation is prevented
* profile self-update rules are enforced
* cross-organization access is restricted
* database types are synchronized if applicable
* database documentation exists
* migrations have been validated
* security tests pass
* application lint passes
* TypeScript passes
* unit tests pass
* build passes
* E2E tests pass
* progress tracker is updated

And:

* no messaging implementation exists
* no E2EE implementation exists
* no crypto dependency has been added
* no `messages` table has been created
* no `public_keys` table has been created

---

# Final Response Required From the Agent

Return:

## 1. Database Summary

What was created?

## 2. Migration Files

List migrations created.

## 3. Tables

List each table and its purpose.

## 4. RLS Policies

Summarize each important policy.

## 5. Constraints and Indexes

List important database constraints and indexes.

## 6. Security Validation

Explain how RLS and authorization were tested.

## 7. Tests

Report:

* lint
* typecheck
* unit tests
* build
* E2E
* database tests

## 8. Files Created/Modified

List important files.

## 9. Remaining Work

Identify the next database/application foundation tasks.

## 10. Recommended Next Prompt

Recommend the next implementation stage.

**Do not automatically continue into the next prompt.**
