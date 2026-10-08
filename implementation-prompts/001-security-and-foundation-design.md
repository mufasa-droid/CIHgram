# 001 — Security and Foundation Design

## Purpose

This is the first implementation prompt for the Anonymous Messaging Platform.

Do **NOT** implement application features yet.

The goal of this task is to resolve and document the security-critical architectural decisions that must be frozen before database implementation, messaging implementation, or cryptographic dependency installation.

The product context in `AGENTS.md` and the `context/` directory is authoritative.

---

# Mandatory Reading

Before doing anything else, read:

1. `AGENTS.md`
2. `context/01-project-overview.md`
3. `context/02-ai-workflow-rules.md`
4. `context/03-code-standards.md`
5. `context/04-ui-context.md`
6. `context/05-architecture-context.md`
7. `context/06-progress-tracker.md`
8. `context/07-product-invariants.md`
9. `context/08-security-and-privacy.md`

Also review the previous architecture audit if it exists in this project.

Do not modify those context files unless explicitly instructed.

---

# Task

Produce a formal **Security and Foundation Design** for the platform.

You must resolve the five currently identified foundation decisions:

1. E2EE protocol and key lifecycle
2. Organization admission/provisioning
3. Message-read API anonymity enforcement
4. Abuse-report disclosure mechanism
5. Message deletion semantics

---

# 1. E2EE DESIGN

The platform requires true client-side encryption.

The following are hard requirements:

* Plaintext message content must exist only on the user's client during normal operation.
* Plaintext must never be sent to the application server during normal message delivery.
* Plaintext must never be stored in PostgreSQL.
* Plaintext must never be included in logs, analytics, URLs, telemetry, or server-side exceptions.
* The recipient must never receive the sender's identity through the message retrieval API.
* The server may retain sender/recipient metadata for abuse prevention and accountability.
* The server must not possess a recipient's private decryption key.
* Do not invent custom cryptography.
* Do not design a homemade encryption protocol.

## Required analysis

Evaluate the most appropriate established approach for this product's one-way message model.

At minimum, evaluate:

* Libsodium sealed-box style public-key encryption
* HPKE
* Signal-style protocols

Compare them against:

* Browser compatibility
* Security properties
* One-way sender → recipient use case
* Key generation
* Key storage
* Key rotation
* Device changes
* Account recovery
* Message confidentiality
* Message authenticity/integrity
* Replay considerations
* Library maturity
* TypeScript/browser support
* Implementation complexity
* Long-term maintainability

Then recommend **ONE** approach for v1.

The recommendation must explain why the other approaches are not necessary or are unnecessarily complex for this product's initial one-way messaging model.

## Important

Do not install a crypto package yet.

First document:

* chosen protocol/construction
* exact cryptographic primitives
* message encryption format
* associated metadata
* versioning strategy
* public-key format
* private-key handling
* failure behavior
* key rotation strategy

---

# 2. PRIVATE KEY LIFECYCLE

Design the complete lifecycle.

## Generation

Answer:

* Where is the key generated?
* When is it generated?
* What entropy/source is used?

## Storage

Answer:

* Where is the private key stored in the browser?
* Is IndexedDB used?
* Is it encrypted at rest locally?
* What protects it from casual browser storage access?

## Server

Define exactly:

* What key material is sent to Supabase?
* What key material is NEVER sent?

## Multiple devices

Decide how the system behaves when the same account is used on another browser/device.

Consider:

* device-specific keys
* account-level identity keys
* adding a new device
* public-key registration
* revoking a device/key

## Recovery

Choose a realistic v1 recovery strategy.

Explicitly evaluate:

* no recovery/device-only key
* passphrase-encrypted backup
* encrypted key backup
* recovery phrase

Do not silently assume that Supabase Auth recovery can recover the E2EE private key.

Explain the security tradeoff.

## Account deletion

Define what happens to:

* private keys
* public keys
* encrypted messages
* received messages
* sent-message metadata

---

# 3. MESSAGE ENCRYPTION FORMAT

Design a versioned encrypted-message envelope.

The design must clearly separate:

* ciphertext
* cryptographic metadata
* protocol version
* key identifier/version
* nonce/ephemeral data if applicable
* algorithm identifier if required

Use a conceptual structure such as:

```text
EncryptedMessageEnvelope
├── version
├── algorithm/protocol
├── recipient_key_id
├── cryptographic parameters
└── ciphertext
```

Use the exact structure appropriate to the selected protocol rather than blindly copying this example.

Explain which fields are safe for the server to store.

**Do not put plaintext in metadata.**

---

# 4. MESSAGE AUTHENTICITY AND ABUSE CONSIDERATIONS

Because the platform is anonymous to recipients but accountable to the server, distinguish clearly between:

* confidentiality
* integrity
* authenticity
* sender anonymity
* server accountability

Explain what the selected cryptographic design guarantees and what it does **not** guarantee.

Consider:

* ciphertext tampering
* replay
* duplicate submissions
* message IDs
* timestamps
* server-side rate limits
* blocked senders
* malicious clients

Do not claim cryptography prevents abuse.

---

# 5. ORGANIZATION ADMISSION

The initial deployment is for one organization, but the architecture must remain capable of supporting multiple organizations later.

Evaluate:

### Option A — Google hosted domain

Users with an approved organization domain are admitted.

### Option B — Invite system

Users join using an invitation token/link.

### Option C — Pre-approved user list

Admins provision eligible accounts.

### Option D — Hybrid

Use domain validation plus an explicit approval/invite layer.

Choose the simplest secure approach appropriate for the initial organization deployment.

Requirements:

* Do not hard-code the organization name throughout the application.
* Do not rely solely on frontend checks.
* Organization membership must be server-enforced.
* A user outside the organization must not be able to discover or message organization members.
* The architecture must allow additional organizations later.

Document:

* signup flow
* OAuth callback behavior
* membership creation
* rejected-user behavior
* admin/provisioning behavior
* future multi-organization compatibility

---

# 6. MESSAGE READ API AND ANONYMITY

This is a critical security boundary.

The `messages` table may contain:

* `sender_id`
* `recipient_id`
* `ciphertext`
* metadata
* timestamps
* message state

But a recipient must **NEVER** receive `sender_id`.

Do not rely on a frontend convention such as:

```ts
const { sender_id, ...safeMessage } = message
```

That is insufficient.

Design the server-side read architecture.

Evaluate:

* Next.js Server Actions
* Next.js Route Handlers
* PostgreSQL views/functions
* another explicitly justified server-mediated approach

The chosen approach must guarantee that recipient-facing responses contain only safe fields.

Define:

* recipient authorization
* query filtering
* returned fields
* RLS responsibilities
* server-side authorization responsibilities
* how starred/read/deleted state is updated
* how a malicious client is prevented from requesting another user's messages

Explicitly explain why the chosen approach prevents accidental `sender_id` leakage.

---

# 7. MESSAGE SENDING SECURITY

Design the send flow.

The server must verify:

1. authenticated user
2. sender identity from the authenticated session
3. valid recipient
4. organization eligibility
5. recipient eligibility
6. sender/recipient relationship
7. block state
8. rate limits
9. payload size
10. ciphertext/envelope validation
11. protocol version
12. recipient public-key version

The client must **NOT** be trusted to submit:

* arbitrary `sender_id`
* arbitrary `organization_id`
* arbitrary role
* arbitrary moderation status
* arbitrary ownership fields

Document the complete flow:

```text
User selects recipient
        ↓
Client retrieves recipient public key
        ↓
User writes plaintext locally
        ↓
Client encrypts locally
        ↓
Ciphertext sent to server
        ↓
Server authenticates sender
        ↓
Server validates recipient/org/block/rate limits
        ↓
Server stores ciphertext + metadata
        ↓
Composer closes/reset
```

Adjust the flow if the selected cryptographic protocol requires a different sequence.

---

# 8. ABUSE REPORTING AND E2EE

The server normally cannot inspect message plaintext.

Therefore reporting must **NOT** secretly undermine the E2EE architecture.

Evaluate:

### Option A — Explicit plaintext disclosure

The recipient chooses to report a message and explicitly submits the decrypted content to authorized moderators.

### Option B — Moderator public-key encryption

The client decrypts the message and re-encrypts the reported content for a moderator public key.

### Option C — Metadata-only reporting

Only metadata is reported and moderators cannot inspect content.

Choose the best v1 approach.

The design must make clear that:

* normal messages remain E2EE
* reporting is an explicit user action
* users are told what information will be disclosed
* the server cannot silently inspect normal ciphertext
* reports have access controls
* reported content must not appear in ordinary logs
* moderator access must be auditable

If moderator public-key encryption is recommended, specify how moderator keys are provisioned and rotated.

Do not implement reporting cryptography yet.

---

# 9. MESSAGE DELETION SEMANTICS

Resolve:

* What does "delete" mean for a recipient?
* Is deletion soft-delete or hard-delete?
* Can a recipient delete only their local inbox record?
* Can sender metadata remain for abuse/accountability?
* What happens to ciphertext?
* What happens when an account is deleted?
* What happens when a private key is lost?
* Are sent messages deleted immediately or retained for abuse records?

Choose a clear v1 policy.

The policy must preserve privacy and accountability while avoiding unnecessary data retention.

---

# 10. DATABASE FOUNDATION

Based on the decisions above, produce the proposed database model.

At minimum consider:

* `profiles`
* `organizations`
* `organization_members`
* `public_keys`
* `messages`
* `blocks`
* `reports`
* `moderation_actions`

Do **NOT** write migrations yet.

For each table provide:

* purpose
* important columns
* relationships
* security sensitivity
* RLS requirements
* indexes
* deletion behavior

Identify fields that should **NEVER** be exposed to normal clients.

---

# 11. RLS + SERVER AUTHORIZATION

Define the security division between:

### PostgreSQL RLS

and

### Next.js server authorization

Do not assume one replaces the other.

Explain:

* which operations RLS protects
* which operations the server layer protects
* how sender identity remains hidden
* how organization isolation works
* how blocks are enforced
* how message reads are restricted
* how profiles are protected
* how reports are restricted
* how moderator access works

---

# 12. THREAT MODEL

Create a concise threat model covering:

### Threat actors

* normal malicious user
* authenticated spammer
* blocked user
* compromised browser/client
* malicious client modification
* database exposure
* leaked server logs
* compromised server credentials
* unauthorized moderator
* accidental API data leakage

For each threat identify:

* asset
* attack
* mitigation
* residual risk

Do not claim the system can prevent endpoint compromise.

Explicitly document that once plaintext is displayed on a recipient's device, the platform cannot guarantee what the recipient does with it.

---

# 13. DEPENDENCY DECISION

After completing the architecture analysis, provide a dependency table:

| Dependency              | Needed now? | Why |
| ----------------------- | ----------: | --- |
| `@supabase/supabase-js` |             |     |
| `@supabase/ssr`         |             |     |
| `zod`                   |             |     |
| `motion`                |             |     |
| `lucide-react`          |             |     |
| crypto library          |             |     |
| `vitest`                |             |     |
| `playwright`            |             |     |
| testing-library         |             |     |

**Do not install anything during this task.**

Do not choose a crypto package without explaining why it matches the selected protocol.

---

# 14. OUTPUT DOCUMENT

Create:

```text
context/
└── 09-security-and-foundation-design.md
```

This document becomes part of the project's permanent architecture context.

It must contain:

1. Decision summary
2. E2EE protocol
3. Key lifecycle
4. Encryption envelope
5. Message send flow
6. Message read flow
7. Organization admission
8. Reporting/disclosure
9. Message deletion
10. Database model
11. RLS/server authorization
12. Threat model
13. Dependency decisions
14. Open questions, if any

Use clear headings and implementation-oriented language.

---

# 15. UPDATE PROGRESS

After creating the document, update:

```text
context/06-progress-tracker.md
```

Only update the relevant progress/decision sections.

Do not rewrite unrelated sections.

Record:

* security foundation design completed
* decisions made
* remaining blockers, if any

---

# STRICT RULES

## DO NOT

* write application code
* create database migrations
* create Supabase tables
* install dependencies
* implement encryption
* implement authentication
* implement UI
* implement messaging
* create API routes
* create Server Actions
* modify product invariants
* weaken anonymity
* expose sender identity
* store plaintext
* invent cryptography
* invent missing product requirements

## DO

* inspect the existing project
* reason carefully about security
* compare established cryptographic approaches
* document assumptions
* identify residual risks
* make explicit recommendations
* keep the architecture simple
* preserve future multi-organization support
* preserve the one-way messaging model

---

# Definition of Done

This task is complete only when:

* `context/09-security-and-foundation-design.md` exists
* all five foundation decisions are resolved or explicitly marked as requiring a deliberate product decision
* E2EE protocol is selected and justified
* private-key lifecycle is defined
* recipient-safe message API architecture is defined
* organization admission is defined
* reporting disclosure is defined
* message deletion semantics are defined
* database foundation is documented
* RLS/server authorization responsibilities are documented
* threat model is documented
* dependency decisions are documented
* `context/06-progress-tracker.md` is updated
* no application code has been implemented
* no dependencies have been installed

At the end, return a concise report containing:

1. Decisions made
2. Files created/updated
3. Remaining questions
4. Recommended next implementation prompt

**Do not begin implementation after this task.**
