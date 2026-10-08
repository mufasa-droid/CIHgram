# 07 --- Product Invariants

These rules must remain true across every implementation.

## Identity and anonymity

1.  A recipient must never be shown the sender's identity.
2.  Recipient-facing APIs must not return sender identity.
3.  Sender anonymity must not depend on hiding a UI field; the data
    boundary itself must protect it.
4.  The platform may know the sender/recipient relationship for
    accountability and abuse prevention.

## Message privacy

5.  Message plaintext must never be persisted on the server.
6.  Message plaintext must not be written to server logs.
7.  Message plaintext must not be sent to analytics or monitoring
    systems.
8.  Encryption/decryption must occur client-side according to the
    approved E2EE design.
9.  Do not invent a custom cryptographic protocol.

## Messaging behavior

10. Messages are one-way.
11. There is no conversation/thread in the initial product.
12. Opening a person creates a new composer.
13. Closing the composer ends that composer instance.
14. Reopening the same person creates another new composer.
15. Previous messages must not automatically populate a new composer.

## Discovery

16. Users can discover eligible users within their current discovery
    scope.
17. Search must not expose private account data.
18. Organization boundaries must be enforced server-side.

## Blocking

19. If A blocks B, B cannot send a message to A.
20. Blocking must be enforced server-side.
21. Client-side hiding is not sufficient.

## Reporting and moderation

22. Users can report messages/users.
23. Reporting does not automatically prove wrongdoing.
24. Moderation actions require an authorized moderation process.
25. If moderation needs to inspect encrypted content, disclosure must
    occur through an explicit, privacy-aware reporting flow rather than
    silently breaking E2EE.

## Profile

26. Users control their own editable profile fields.
27. Public profile data must be intentionally limited.
28. Email and authentication identifiers are not public profile data.

## UI

29. Simplicity is a product requirement.
30. Whitespace is intentional.
31. No generic AI visual language.
32. No unnecessary feature or information density.
33. Motion must support interaction, not decoration.
34. Core flows must remain usable with reduced motion.

## Architecture

35. Do not hard-code the initial organization's name.
36. Do not introduce unnecessary infrastructure.
37. Security-sensitive decisions must be documented.
38. Any change to an invariant requires explicit architectural review
    and documentation.
