# PvP Pad design system

## Overview

PvP Pad is a public, wallet-optional interface to short onchain games and their coins. The visual anchor is The Spireth’s Ethereum rhombus: a single vertical board, broad at zero and narrow at both bells. The tiles, eight pixel Imp shapes, favicon and social artwork are original. No character or image files were copied from The Spireth.

The pad uses a quiet dark interface around the game. A gold action identifies the next step. State, costs and timers sit beside that action. On phones the current game action precedes the board; supporting balances, feed and ranking follow it. Real chain data is never replaced by sample activity in the production export.

The implementation is in `site/style.css`, `site/src/app.ts` and `site/src/board.ts`. Generated `site/app.js` and `dist/` are build outputs.

## Colors

All UI colors are semantic CSS variables in `site/style.css:13`.

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#09090b` | Page, input background, text on gold |
| `--surface` | `#18181b` | Panels, cards, dialogs, board |
| `--raised` | `#27272a` | Neutral buttons, selected rows, notifications |
| `--line` | `#3f3f46` | Dividers and control outlines |
| `--text` | `#fafafa` | Primary text |
| `--muted` | `#a1a1aa` | Supporting text and labels |
| `--up` | `#34d399` | Positive floors, live states, curve progress |
| `--down` | `#f87171` | Negative floors, failures and errors |
| `--gold` | `#fbbf24` | Primary action, bells and crown |
| `--focus` | `#fafafa` | Two-pixel keyboard focus ring |

Measured WCAG solid-color pairs: text/background 19.06:1; text/surface 16.97:1; muted/surface 6.91:1; muted/raised 5.81:1; background/gold 11.92:1; green/surface 9.22:1; red/surface 6.40:1. Browser probe results and canvas measurement limitations are in `site/VALIDATION.md`.

The additional purple, blue, orange, pink and cyan sprite colors distinguish address-derived Imps, not interface status. Ghosts use reduced canvas opacity. Every status also has a word; no task depends on color alone. Gold’s three uses follow the explicit brief.

## Typography

Geist Sans and Geist Mono variable Latin WOFF2 files are local in `site/fonts/`, with their OFL licenses. `font-display: swap` keeps content readable during loading. Geist uses `system-ui, sans-serif` fallbacks; Geist Mono uses `monospace`. Live Chromium checks confirmed both fonts loaded.

| CSS token | Size | Role |
| --- | --- | --- |
| `--small` | 13 px | Badges, supporting labels, feed and compact table |
| `--body` | 16 px | Body, inputs, buttons |
| `--medium` | 20 px | Card headings, large statistics |
| `--large` | 24 px | Panel headings, desktop brand |
| `--title` | 36 px | Page headings and mobile hero |
| `--display` | 56 px | Desktop genesis hero |

Rendered weights are 400, 600 and 700. Body line height is 1.5; short headings use 1.1. Headings balance wrapping; descriptions use pretty wrapping and a maximum 68-character measure. Display tracking is −0.045em; section headings use −0.02em. Prices, timers, heights and amounts use Geist Mono with tabular digits. Inputs remain 16 px on phones. Amount calculations use integers; presentation never turns a positive tiny balance into a displayed zero. Trade confirmation shows the exact minimum output.

## Layout

The shared shell is at most 1240 px wide. Side padding is 32 px on desktop, 20 px at 640 px and below, and 16 px at 350 px and below. Common internal gaps are 8–12 px; panels use 20–24 px padding and groups use 24–48 px gaps. Body copy stays in normal document flow; there is no sticky navigation obscuring headings.

The desktop pad hero pairs genesis information with the board. Launch cards use three columns, two below 900 px and one below 640 px. Secondary pages use a two-column `.split`, collapsing to one at 640 px. The game has a large board at left and actions at right on desktop. At 640 px, `.game-action` uses `display: contents` so the first action panel is followed directly by the board, then secondary panels and results. The board scales to available width; exact heights and all seats are also available in the table.

The board canvas has a 640 × 1280 logical coordinate space and all floors from −50 to +50. Its floor labels use 24 logical pixels; sparse groups use larger sprites, dense groups smaller ones. Imps sharing a floor stack for visibility. Address hashes select one of eight original shapes and eight colors. A white outline identifies the connected wallet.

Chromium reflow was checked at 320, 390, 768 and 1440 px. Native Safari, physical devices, screen readers and browser-native 200% zoom remain unverified; those limits are not equivalent to the tested narrow viewports.

## Elevation & depth

The surface system is flat: no card shadows, gradients, glow or texture overlays. Tone separates the page, panels and raised controls. One-pixel borders communicate controls, dividers and selected states. Dialogs use the browser top layer with a translucent black backdrop. Notifications occupy a compact, scrollable bottom-right stack; each has an explorer link and dismissal, plus one control to dismiss the stack. Notifications remain until dismissed.

## Shapes

Panels and cards use `--radius: 12px`; buttons and inputs use 8 px. Dialogs use 20 px, becoming bottom sheets with rounded top corners below 640 px. Status badges use 6 px and a small circular marker. The rhombus, pixel bell, crown and octahedral die provide the product-specific geometry.

## Components

- **Action button:** `button()` / `action()` in `site/src/app.ts`, `.button` in CSS. Gold `.primary` for the next action; neutral and `.plain` for secondary actions. States cover hover, focus, pressed, disabled and transaction progress. Wallet absence offers connection; a wrong chain offers Add Robinhood Chain. Transactions pause when the read is stale.
- **Status badge:** `phase()`, with words for all eight contract states. The state order is explicit rather than inferred from numeric order.
- **Statistics and curve:** `stat()` produces semantic description-list cells. `curve()` uses a native progress element with an accessible name and a 4 ETH target.
- **Cards:** `card()` presents registry identity, phase, counts, pot, curve and the next navigation action. Graduated price and market cap are denominated in ETH.
- **Forms:** persistent labels, 16 px fields, input hints and adjacent errors. Launch limits are validated in UTF-8 bytes; ticker and name are escaped before rendering. Invalid fields receive `aria-invalid`, an associated message and focus. A preview reflects the draft.
- **Wallet picker:** native dialog, EIP-6963 wallet rows, locally bundled marks, mobile app links and a lazily loaded Coinbase Smart Wallet SDK. Escape, close button and backdrop dismiss it; focus returns to Connect. The mobile sheet has at least 52 px wallet rows.
- **Transaction review and receipts:** a native dialog states destination context, amount and network before a wallet prompt. The sender is captured for the workflow. The receipt stack distinguishes confirmation and failure, and links every submitted hash to the explorer. Forms are disabled while a workflow is in progress.
- **Board and die:** `Board` and `impSVG()` in `site/src/board.ts`. A resolved die tumbles for 900 ms; the Imp then advances floor by floor at 160 ms per step. Motion is not a source of outcomes. Reduced motion skips both animations; the result and table remain.
- **Tables and feeds:** small, consistent numeric columns and native links. Seats are always shown as 1-based. History totals are explicitly partial until the deployment-to-head scan completes.
- **Skip navigation:** the keyboard skip link focuses and scrolls the current `main` element without changing its hash route.
- **Shared states:** initial read, RPC failure/retry, stale data, closed pad, unconnected wallet, wrong chain, empty filtered list, pending transaction and rejected transaction each have a designed state. The experimental-contract risk footer appears on every route.

## Do’s and don’ts

Start a new view with `header()`, `.split` or `.stack`, and `.panel`. Put its next action before supporting information. Reuse `action()` for a transaction, preserve the explicit review step and keep prices in ETH unless a genuine conversion source is added. Keep exact transaction arithmetic in bigint.

Use the existing six-size type scale and palette. Add accessible text alongside visual status. Preserve native links, labels, buttons and dialogs. Avoid marketing chrome above the product, unverified activity, name-based token discovery, remote font/script CDNs and decorative animation. A new page must retain the shared footer, chain freshness indicator and wallet handling.

Design and review used the pinned Better Interface guide by Jakub Krehel (MIT) and its documentation adaptation from Paul Bakaus’s Impeccable (Apache-2.0). Attribution and licenses are retained in `site/review/design-guide-LICENSE.txt` and `site/README.md`.
