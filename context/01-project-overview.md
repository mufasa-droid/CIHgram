# 01 --- Project Overview

## 1. Overview

This product is a minimal, privacy-focused anonymous messaging platform.

It is being built first for use inside an organization. Every eligible
member of the organization's network can discover other eligible members
and send them one-way anonymous messages.

The platform may later become a broader public service. Therefore, the
architecture must be organization-ready without hard-coding the initial
organization into application logic.

The central product promise is:

> Send someone a message without revealing your identity to them.

The platform itself remains accountable: it may know the sender and
recipient relationship for authentication, abuse prevention, blocking,
rate limiting, reporting, and moderation. The platform must not have
access to message plaintext.

## 2. Goals

### Primary goals

-   Extremely simple onboarding.
-   Google authentication with minimal friction.
-   Organization-based initial discovery.
-   Global discovery within the applicable organization.
-   Search for people.
-   One-way anonymous message sending.
-   True client-side end-to-end encryption for message content.
-   Recipient-only message decryption.
-   Simple received-message inbox.
-   Star/favorite messages.
-   Editable public profile.
-   Blocking and reporting.
-   Account-level moderation and enforcement.
-   Responsive, accessible, calm UI.
-   Architecture that can later support multiple organizations and
    public users.

### Secondary goals

-   Fast perceived performance.
-   Clear empty/loading/error states.
-   Strong server-side authorization.
-   Small and maintainable codebase.
-   Good automated test coverage around security-sensitive behavior.

## 3. Core user flow

### First visit

Onboarding → Sign up / Log in → account setup → People.

### Discovery

People → search or browse → select person → transient message composer.

### Sending

Select recipient → compose message → encrypt locally → submit ciphertext
and required metadata → server validates recipient/block/rate limits →
store ciphertext → composer closes.

### Re-opening a person

Selecting the same person later creates a completely new message
composer. It must not reopen a conversation or previous draft.

### Receiving

Recipient opens Messages → sees anonymous messages → opens one →
decrypts locally → reads it → may star/favorite, delete, or report.

## 4. Scope

### In scope

-   Onboarding
-   Google authentication
-   Minimal account creation
-   Organization membership
-   People discovery
-   Search
-   Public profiles
-   Anonymous one-way messaging
-   E2EE message content
-   Inbox
-   Read/unread state
-   Star/favorite
-   Delete/archive behavior as defined by the final product decision
-   Blocking
-   Reporting
-   Moderation/admin foundations
-   Profile and settings
-   Responsive web experience

### Out of scope for initial release

-   Two-way conversations
-   Replies
-   Group messaging
-   Public comments
-   Reactions
-   Voice/video
-   Anonymous public posting
-   Social feed
-   AI-generated messages
-   Complex notification center
-   Billing/subscriptions
-   Multiple organizations exposed through a user-facing organization
    switcher
-   Public global discovery

These may be considered later without changing the core message model.

## 5. Success criteria

The first production-ready version should allow a new member to:

1.  Open the platform.
2.  Understand the product quickly.
3.  Sign in with Google.
4.  Enter or confirm minimal profile information.
5.  See eligible people.
6.  Search for a person.
7.  Open a message composer.
8.  Send an anonymous encrypted message.
9.  Close the composer.
10. Reopen that person and receive a completely new composer.
11. Recipient sees the message but not sender identity.
12. Recipient can star/favorite or report it.
13. A blocked sender cannot send to the blocker.
14. Server/database never stores plaintext message content.
15. Existing users remain isolated by authorization and organization
    rules.

## 6. Product language

Prefer: - Person - Profile - Anonymous message - Message composer -
Inbox / Messages - Recipient - Sender - Block - Report

Avoid: - Chat - Conversation - Chat history - Anonymous chat - Thread

The product is intentionally one-way. It is not a conventional chat
application.
