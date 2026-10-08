# 08 --- Security and Privacy

## 1. Security objective

The system should provide:

> Anonymous-to-recipient messaging with server accountability and
> client-side end-to-end encryption.

This document is a security architecture boundary, not a substitute for
a professional cryptographic/security review.

## 2. Threat model

We care about: - malicious users, - unauthorized API requests, -
cross-organization data access, - sender identity leakage, - message
plaintext leakage, - database compromise, - accidental server logging, -
abusive message flooding, - account takeover, - client-side tampering, -
broken access control, - insecure profile exposure.

## 3. Privacy boundary

### Server may know

-   authenticated account identity,
-   organization membership,
-   sender ID,
-   recipient ID,
-   message ID,
-   timestamps,
-   message ciphertext,
-   delivery/read metadata,
-   block relationships,
-   reports and moderation metadata.

### Server must not know during normal delivery

-   message plaintext.

### Recipient may know

-   decrypted message content,
-   their own message state.

### Recipient must not know

-   sender identity.

## 4. Encryption requirements

The application must use an established cryptographic
implementation/protocol.

Do not design a novel encryption scheme.

The protocol must specify: - identity key generation, - public/private
key handling, - message encryption, - message decryption, - key
rotation/versioning, - device handling, - recovery, - deletion
implications, - compromise considerations.

Before production release, the cryptographic implementation should
receive appropriate security review.

## 5. Key management

Key management is a first-class subsystem.

The agent must not: - store private keys in plaintext server database
fields, - send private keys to the server unnecessarily, - put private
keys in URLs, - log private keys, - expose private keys to
analytics/error reporting.

The final recovery design must balance: - usability, - device loss, -
account recovery, - privacy.

Possible design directions include encrypted key backup or a recovery
mechanism, but the final strategy must be explicitly chosen before
implementation.

## 6. Authentication

Initial authentication: - Google OAuth through Supabase Auth.

Requirements: - secure session handling, - server-side session
validation, - protected application routes, - account initialization
after first login, - no unnecessary signup fields.

Authentication identity is separate from public username/profile
identity.

## 7. Authorization

Every sensitive operation must verify authorization server-side.

Never trust: - user IDs supplied by clients, - organization IDs supplied
by clients, - role values supplied by clients, - hidden UI controls, -
client-side route protection.

Use database RLS and server-side checks as complementary defenses.

## 8. Organization isolation

A user must not be able to: - query another organization's private
membership data, - send to a user outside their permitted discovery
scope, - modify another organization's data, - infer private
organization membership through unauthorized endpoints.

## 9. Blocking

When sending a message: 1. authenticate sender, 2. resolve recipient, 3.
verify discovery eligibility, 4. check block relationship, 5. enforce
rate limits, 6. accept/store ciphertext only if authorized.

The block check must happen server-side.

## 10. Abuse prevention

Because message content is E2EE, the server cannot rely on plaintext
content scanning.

Use: - authentication requirements, - rate limits, - per-account message
quotas, - recipient abuse controls where appropriate, - account age/risk
signals, - block enforcement, - reporting, - moderation actions, -
suspicious behavioral signals.

Do not claim that server-side content moderation can inspect encrypted
plaintext.

## 11. Reporting

A report should contain: - reporter, - target, - reason, - timestamp, -
status, - moderation decision.

If a moderator needs message content, the product should provide an
explicit user-authorized disclosure mechanism for the reported content.

Reporting should not silently decrypt all private messages on the
server.

## 12. Moderation recommendation

Use a layered system:

### Automated safeguards

Rate limits, spam controls, account restrictions, suspicious activity
detection.

### User controls

Block and report.

### Human moderation

Review reports and disclosed content where appropriate.

### Enforcement

Warning → temporary restriction → suspension → removal, depending on
severity and policy.

Do not auto-ban solely from report count.

## 13. Data minimization

Collect only what is needed.

Avoid storing: - unnecessary personal details, - private profile
information, - message plaintext, - unnecessary device information.

## 14. Logging

Logs must not contain: - plaintext message bodies, - private keys, -
OAuth secrets, - access tokens, - unnecessary personal data.

Use structured logs for operational events.

## 15. Secrets

Secrets must live in environment variables/secure deployment
configuration.

Never commit: - Supabase service role keys, - OAuth client secrets, -
encryption secrets, - private keys, - database credentials.

The Supabase service role key must never be exposed to browser/client
code.

## 16. Client security

Treat client code as potentially inspectable/tamperable.

The client may improve UX but cannot be the final security boundary.

Server/database policies remain authoritative.

## 17. Security release gate

Before production: - review RLS policies, - test cross-user access, -
test cross-organization access, - test block bypass attempts, - inspect
network responses for sender identity leakage, - inspect logs for
plaintext leakage, - test key recovery, - test account deletion, - test
message deletion/retention, - conduct security review of the E2EE
implementation.

## 18. Important limitation

No web application can honestly promise that a user's device is
perfectly private. Malware, browser compromise, screenshots, or a
compromised endpoint can expose plaintext after decryption.

The product promise is specifically that the normal platform/server
infrastructure cannot read message plaintext.
