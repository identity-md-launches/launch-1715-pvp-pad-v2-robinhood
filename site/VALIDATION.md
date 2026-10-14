# Implementation and validation record

Reviewed on 2026-10-14. The static implementation and Chromium checks are complete. WebKit compatibility and real wallet signing remain unverified. `dist/` is the finished IPFS export; publication is the contributor plane’s post-submission handoff. No public CID is claimed.

## What was checked

All runtime assets are included in both `site/` and `dist/`: generated JS, local ethers and Coinbase SDK, ABI and verification manifests, CSS, fonts, licenses, favicon and original social artwork. Source, scripts, frontend manifest and lockfile are in `site/`. No contract, existing dependency, Foundry configuration, ignore file or Git metadata was changed. No live transaction was submitted.

The tests served the actual export under `/preview/`, exercising relative URLs and hash navigation. They did not use a development server or a separate test UI. Synthetic addresses and state exist only in `site/tests/` and are excluded from the runtime export.

| Command / check | Actual result |
| --- | --- |
| `forge build --skip test --skip script` | Passed with the repository’s existing lint warnings. Used only to derive the deployed contracts’ ABIs and runtime fingerprints. |
| `node site/scripts/abi.mjs` | All five canonical ABI hashes matched the pinned deployment: PadToken, PadGame, PvPPad, PadLiquidity and KingOfThePad. |
| `node site/scripts/typecheck.mjs` | Passed with strict checking and `noEmit`. |
| `node site/scripts/test.mjs` | 12 checks passed: raffle boundary, UTF-8 limits, rankings, payout caps and weights, no survivors, pool price inversion, integer slippage, both swap directions, zero-output rejection and tiny balances. |
| `node site/scripts/build.mjs` | Passed. Generated the complete, locally bundled `dist/` export. |
| `PLAYWRIGHT_BROWSERS_PATH=/tmp/pvp-browsers node site/tests/browser.mjs` | 22 Chromium interaction checks passed; no page-script errors. Four axe scans returned no violations. See `review/browser-results.json`. |
| `PLAYWRIGHT_BROWSERS_PATH=/tmp/pvp-browsers node site/tests/live.mjs` | Public chain reads succeeded. Chain ID 4663 and all five normalized runtime bytecodes matched. No script errors; both local font families loaded. See `review/live-read.json`. |
| Pinned `taste.mjs` with live RPC | 16/16 checks passed at 320, 390 and 1440 widths. See `review/taste-online.json`. |
| Pinned `taste.mjs --offline` | 16/16 checks passed in the RPC-unavailable state. Local UI, navigation, fonts and artwork still rendered. See `review/taste-offline.json`. |

The browser suite covers registry-only navigation, launch filters, no-wallet reads, keyboard wallet opening and dismissal, EIP-6963 connection, 0.001 ETH entry, `draw(32)`, one-based seats and the hero’s actual seat count, 0.002 ETH roll, the three-future-L2-block reveal boundary, `resolvePending(8)`, finalization, graduation, claims, buy quotes and router calldata, token and Permit2 approvals before a sell, UTF-8 launch validation and preview, crown bids, `distribute(8)`, both fee claims, burns, keeper selection, owner salt mining and CREATE2 verification, RPC failures, rejected wallet requests, unknown launch rejection, failed genesis restart, public-opening access, bounded history queries, wrong-chain recovery and all four mobile wallet links. Coinbase’s locally bundled provider module was instantiated, without passkey authentication.

These are interface and encoding checks using an ABI-aware RPC/wallet fixture, **not an EVM execution test or proof that a live swap will succeed**. They do not move funds. Exact transaction values, methods, relevant parameters and workflow order are asserted. The live pad was closed with zero registered launches during validation, so later game phases were exercised with explicitly synthetic fixtures.

The final recorded live read at 14:10 UTC observed block 88,427,509, `opened = false`, `launchCount = 0`, owner `0x5b95A971B4583A5f011E9DA082acdD679b870D06` and opening deadline `1794568179`. The UI’s own coherent snapshot was block 88,427,504. These are observations at that time, not fixed application values. The only external host observed during read-only browsing was the configured Robinhood RPC.

## Better Interface coverage

The pinned guide’s workflow and core principles in all six domains were applied during implementation, followed by a source and rendered review. Supporting material was consulted for wallet dialogs, forms, focus, errors, responsive reflow, fonts, motion and design documentation. The final tokens and components are documented in the root `DESIGN.md`; the supplied attribution/license is retained in `review/design-guide-LICENSE.txt`.

| Domain | Source review | Rendered review and result |
| --- | --- | --- |
| Accessibility | Native links, buttons, labels, dialog semantics, skip link, heading order, named canvas, equivalent seat table, visible focus, `aria-invalid`, error associations, status announcements and reduced motion. | Keyboard activation, Escape, focus return and route-preserving skip navigation passed. Axe found zero violations on game, launch, rules and the wallet dialog. Target probe passed. No screen-reader or physical-device session was performed. |
| Layout | First action before supporting detail; one-column phone flow, bounded shell, responsive grid, mobile board order, wrapping and compact table. | Inspected screenshots at 390 and 1440; measured reflow at 320, 390, 768 and 1440 with no horizontal overflow. The 390 first screen shows product and primary action. No text overlaps or clipping in the probe. |
| Writing | Costs and irreversible effects beside entry/roll controls; clear wallet, network, closed-pad, stale-read and empty states; precise review text; partial-history labels; plain rules and shared risk footer. | First-screen copy stayed under the probe’s budget. No all-caps eyebrows, repeated lines or excessive slogan stack. Rejected requests and RPC failures retain useful recovery actions. |
| Typography | Six semantic sizes, two locally bundled families, three weights, 16 px fields, mono prices/timers/heights, tabular digits, controlled line length and wrapping. | Both fonts loaded in live Chromium. The probe found at most five sizes including one-offs on the reviewed home screens, two families and three weights. Mobile inputs and tables were inspected. |
| Colors | Requested semantic palette, high-contrast text, words alongside every status, visible focus and a distinct own-Imp outline. | All measured solid-background text passed the probe’s 4.5:1 threshold (3:1 for large text). Calculated token pairs are recorded in `DESIGN.md`. One canvas-overlay text box was outside the probe’s contrast measurement. Canvas art and faded ghosts are not claimed as measured text. |
| UI | State-specific next actions, native confirmation dialogs, controlled forms, progress, transaction receipts with explorer links, bounded notifications, disabled stale actions and local wallet selection. | Primary workflows and recovery states passed the fixture suite. The production owner worker found and verified a salt against the fixture’s `hookAddressFor`. No backend, indexer, relay or remote asset CDN is involved. |

## Findings and corrections

These references identify the final implementation containing each correction, not an unresolved warning list.

| Finding | Correction and evidence |
| --- | --- |
| ethers returns read-only pool-key tuples, which broke quote encoding. | `src/app.ts:879`: copy the returned tuple into a plain array before Quoter and router use. Both buy and sell interaction checks pass. |
| Small nonzero ETH or token outputs could look like zero; a third slippage decimal could silently round. | `src/math.ts:43`, `src/math.ts:142`, `src/app.ts:255`, `src/app.ts:913`: explicit small-value formatting, eight-decimal ETH quotes, exact minimum in review and strict two-decimal slippage input. Unit and sell checks pass. |
| Polling could replace a focused control or interrupt board animation. | `src/app.ts:455`: restore form/action focus and preserve the existing canvas. Native dialog closure explicitly returns focus to its originating control. Keyboard validation passes. |
| The phone board appeared after supporting panels, with undersized floor labels; leaderboard addresses squeezed columns. | `style.css:1315`, `src/board.ts:198`, `src/app.ts:260`: action then board on phones, larger logical labels/sprites, compact seat links with full addresses available through the explorer. Mobile screenshots and overflow checks pass. |
| Accumulated transaction receipts obscured controls. | `style.css:1344`, `src/app.ts:640`: capped scrollable stack, newest first, individual dismissals and Dismiss all. Interaction checks use those controls successfully. |
| Editing a form during a transaction workflow could lose newly typed input when the older operation completed. | `src/app.ts:488`, `src/app.ts:653`: disable workflow forms, capture the sender, guard account changes and defer cleanup correctly. A successful launch only navigates away if the visitor is still on the launch page. |
| Near-head history could be labelled complete before its last chunk finished. | `src/data.ts:436`, `src/app.ts:161`: an explicit scanned-through watermark controls the partial-history label. Recent blocks are re-read to repair shallow reorganizations. |
| Rabby’s mobile link used the wrong query shape. | `src/app.ts:601`: use its documented `_cmd=open-dapp` and `dapp` parameters. The mobile link check passes. |
| The die result depended on historical logs catching up. | `src/app.ts:757`: read the resolved pending roll immediately from the current view; deduplicate the later event animation. The reveal interaction passes. |
| The skip link’s fragment could be mistaken for an application route and return to the pad. | `src/app.ts:1196`: prevent route mutation, focus the existing main element and scroll it into view. The navigation check now activates the skip link from Rules and asserts that the route and focus are preserved. |
| The genesis hero used the entry count under the Seats label after drawing. | `src/app.ts:216`: display `impCount`-derived seats for play/results. The drawing interaction now checks a fixture with 64 entries and five seats. |

## Screenshots and probe details

- `review/live-pad-390.png` and `live-pad-1440.png`: actual closed live deployment, no fabricated launches. The 390 screenshot was visually inspected; its primary button is above the fold.
- `review/pad-390.png`, `game-390.png` and `game-1440.png`: synthetic signup/play fixtures used to inspect otherwise unavailable live states. The game screenshot shows action, board, ghost treatment, feed and complete table.
- `review/wallet-390.png`: local wallet sheet at a 390 px viewport; desktop user agent. Mobile user-agent links were checked separately by the interaction suite.
- Probe JSON files retain actual check outputs, measurements and limitations. Comfortable 44 px targets are advisory: some compact links are smaller, while the minimum target/spacing check passes. The main action is 48 px tall and wallet rows are at least 52 px.

The pinned probe was invoked from the repository root with:

```sh
IMD_PLAYWRIGHT=/tmp/pvp-browser/node_modules/playwright/index.mjs \
PLAYWRIGHT_BROWSERS_PATH=/tmp/pvp-browsers \
XDG_CONFIG_HOME=/tmp/pvp-xdg-config XDG_CACHE_HOME=/tmp/pvp-xdg-cache \
node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste
```

The offline run adds `--offline`. Probe scratch output is disposable; reports are copied into `site/review/` for delivery. Browser tools were Playwright 1.58.2 and axe 4.11.0 installed outside the checkout. The supplied browser service could not launch its Chromium process; local Playwright with writable XDG paths worked.

## Remaining limitations

- WebKit could not launch because its host dependency check reported missing `libgles2`. An isolated local-library attempt also failed to start a working browser. Safari/WebKit, Firefox, physical iOS/Android app opening, screen readers, browser-native 200% zoom and an RTL mirror were not verified. Full keyboard traversal of every control was not performed; the wallet focus path was exercised. This brief specifies a dark theme only, so no light-theme implementation or review is claimed.
- No real passkey login, installed wallet transaction, mainnet entry, opening, approval, swap or claim was sent. Fixture coverage is not chain execution assurance. The live contracts are experimental and unaudited.
- The client reconstructs history in memory from the deployment block. A long-lived registry or a restrictive RPC can make the scan slow. Partial totals are labelled; reload starts a new scan. It handles a 32-block overlap, not arbitrary deep reorganizations.
- The requested eight die outcomes and board motion are implemented; reduced-motion behavior and resulting state were checked. Fine-grained animation timing was not measured with a physical-device recording or the browser Animations panel at 10% speed. The preview hero’s board is decorative; exact player heights are available on the game table.
- Uniswap addresses come from the supplied network configuration. Core bytecodes and bindings are verified, but the site does not audit Uniswap, wallet services, optional image hosts or contract economics.
- IPFS publication occurs after the export is submitted. No deployment transaction, hosting account or private key is required by the static build.

The 26 runtime files total less than 810 KB. The complete working-tree snapshot was about 4.11 MB uncompressed and its independently created, self-contained Git bundle was about 1.34 MB, below the 8 MiB limit. The bundle measurement used a temporary repository outside the checkout; a direct history bundle could not be produced because the supplied partial clone lacks an ancestor object and the source Git directory is read-only. No source Git metadata was changed. The delivered report and documentation add less than 100 KiB to those bounds. See `review/export-audit.json` for the exact measured snapshot, runtime hashes, protected-path check and byte budget. These worker-side results carry no independent certification of behavior.
