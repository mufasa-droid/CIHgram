# 04 --- UI Context

## 1. Design direction

The visual language is:

> Quiet editorial simplicity + modern product precision + generous
> whitespace.

The UI should feel designed, not decorated.

Reference principles: - 7U Design principles - Emil Kowalski's
interaction/animation philosophy

These are references for quality and interaction thinking, not templates
to copy.

## 2. Core visual principles

### Simplicity

Every element must justify its existence.

If text can be removed without reducing understanding, remove it.

### Whitespace

Whitespace is a primary component of the design.

Do not fill empty space merely because it is available.

### Typography

Use typography to create hierarchy rather than cards, gradients, and
decorative graphics.

Prefer: - strong but restrained page headings, - comfortable body
text, - clear metadata, - compact secondary labels.

### Color

Use a restrained palette.

A neutral base with one controlled accent is preferred.

Avoid: - neon gradients, - excessive purple/blue AI aesthetics, -
rainbow accents, - glowing UI.

### Surfaces

Prefer: - open canvas, - subtle separators, - occasional restrained
surface elevation.

Avoid: - card stacking everywhere, - glassmorphism, - heavy shadows.

## 3. Layout

The application should feel spacious on desktop and natural on mobile.

People discovery should feel like a directory/search experience, not a
dashboard.

Messages should feel like a quiet inbox.

Profile settings should be focused and uncluttered.

## 4. Message composer

The composer is a transient modal/dialog or equivalent focused surface.

It should: - clearly identify the recipient, - provide a large
comfortable writing area, - make anonymity understandable without
excessive explanation, - provide a clear send action, - close cleanly, -
reset completely when opened again.

It is not a persistent conversation.

## 5. Motion

Motion should communicate: - opening/closing, - state change, -
feedback, - hierarchy.

Use short, purposeful transitions.

Avoid: - constant floating animations, - parallax for decoration, -
excessive spring effects, - animation that delays useful work.

Respect `prefers-reduced-motion`.

## 6. Responsive behavior

Mobile is first-class.

The core flow must work comfortably on narrow screens: -
authentication, - discovery, - search, - composer, - inbox, -
profile/settings.

Do not simply shrink the desktop layout.

## 7. Content density

Default to less information.

A user should understand: - where they are, - what they can do, - who
they are messaging,

without reading a large block of UI copy.

## 8. Anti-patterns

Do not introduce: - generic AI landing-page aesthetics, - oversized
gradient hero sections, - fake testimonials, - fake statistics, - skill
bars, - decorative dashboards, - excessive badges, - unnecessary
icons, - excessive tooltips, - notification spam.

## 9. Design quality bar

Before accepting a UI implementation ask: - Is the hierarchy obvious? -
Can anything be removed? - Is the spacing intentional? - Does the
interaction feel immediate? - Does the UI look distinctive without
relying on decoration? - Does it remain understandable with animation
disabled?
