# 05 --- Architecture Context

## 1. Architecture goal

Build an organization-first anonymous messaging platform that can later
expand into a multi-organization or public network without replacing the
core user/message architecture.

## 2. Stack

-   Next.js App Router
-   React
-   TypeScript
-   Tailwind CSS
-   Supabase Auth
-   Supabase PostgreSQL
-   Supabase Storage
-   Supabase Row Level Security
-   Vercel
-   Zod
-   Motion
-   Lucide
-   Vitest
-   Playwright

Additional dependencies require justification.

## 3. System boundaries

### Client

Responsible for: - UI - local state - composing plaintext -
encryption/decryption - holding necessary client-side key material -
presenting decrypted message content

### Application/server

Responsible for: - authentication/session validation - authorization -
organization membership checks - discovery/search rules - recipient
validation - block enforcement - rate limiting - message metadata
handling - ciphertext persistence - reporting - moderation -
audit/security events

The server must not receive message plaintext during normal message
delivery.

### Database

Stores: - users - profiles - organizations - organization memberships -
public encryption keys / key metadata - encrypted messages - message
metadata - blocks - reports - moderation actions - appropriate
security/audit records

## 4. Organization model

Users are platform-level identities.

Organizations are separate entities.

Membership connects users to organizations.

Conceptual model:

`users` `organizations` `organization_members`

Initial behavior: - one organization may be the initial tenant, -
eligible members discover other eligible members in that organization.

Future behavior: - multiple organizations, - public/global users, -
configurable discovery scope.

Never hard-code an organization name into business logic.

## 5. Core data model

Initial conceptual entities:

### User

Platform identity.

### UserProfile

Public information such as: - username - display name - avatar -
optional bio

### Organization

A tenant/community.

### OrganizationMember

Links a user to an organization and includes membership/role/status.

### PublicKey

Stores public cryptographic identity information required for message
encryption.

### Message

Stores: - message ID - sender ID - recipient ID - ciphertext -
encryption protocol/version metadata - timestamps/status fields -
recipient-side state such as starred/read where appropriate

Never store plaintext body.

### Block

`blocker_id` and `blocked_id`.

### Report

Reporter, target message/user, reason, status, timestamps, and
moderation references as appropriate.

### ModerationAction

Administrative enforcement such as warning, restriction, suspension, or
removal.

## 6. Message lifecycle

1.  Sender authenticates.
2.  Sender selects recipient.
3.  Client fetches recipient's approved public encryption information.
4.  Sender writes plaintext locally.
5.  Client encrypts locally.
6.  Client sends ciphertext + required metadata.
7.  Server authenticates sender.
8.  Server verifies recipient.
9.  Server checks organization/discovery eligibility.
10. Server checks block state.
11. Server applies rate limits/abuse controls.
12. Server stores ciphertext and metadata.
13. Recipient later fetches ciphertext.
14. Recipient decrypts locally.
15. Recipient sees plaintext.
16. Sender identity is not included in recipient-facing message content.

## 7. Message interaction model

Messages are one-way.

There is no conversation object in the initial architecture.

Every opening of a recipient creates a new composer.

Closing a composer ends that composer instance.

Previous messages are not reopened as a conversation.

## 8. Authorization model

Authorization must be enforced server-side.

Examples: - A user can update only their own profile. - A user can
block/unblock according to their own block records. - A sender cannot
send to a recipient who has blocked them. - Organization-restricted
discovery must not leak members from other organizations. - Recipient
message retrieval must not expose another user's messages. -
Administrative actions require explicit administrative authorization.

## 9. Search

Initial search should support public profile fields appropriate for
discovery, likely username/display name.

Do not expose: - email address, - authentication provider identifiers, -
private metadata, - internal database identifiers unless required.

Search results should respect organization visibility.

## 10. Storage

Supabase Storage for profile images.

Do not put message plaintext into: - database, - logs, - analytics, -
error tracking, - server console, - URL parameters, - client telemetry.

## 11. Future scalability

Do not prematurely add: - microservices, - queues, - separate backend
servers, - GraphQL, - Redis, - event buses.

Introduce them only when actual requirements justify them.

## 12. Realtime

Realtime delivery may be added later.

The initial product can use ordinary authenticated fetching.

If realtime is added, the ciphertext/privacy boundary remains unchanged.

## 13. Architecture decision

The product is intentionally: - full-stack Next.js, - Postgres-backed, -
organization-aware, - server-authorized, - client-encrypted, - one-way
messaging.
