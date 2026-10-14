# PvP Pad republish validation

Run on 2026-10-14, starting at 15:05 UTC. This record supersedes the previous website build's validation. Scope: repair JavaScript packaging and prepare the complete existing static site for republication under **pvp-pad**. No contract, address, configuration value, ABI, page, styling or wallet feature was changed. No real transaction was submitted.

## Export and preservation

`dist/` contains **24 files / 1,184,875 bytes**. `app.js` is 569,100 bytes and `salt-worker.js` is 380,562 bytes. Both have **zero static imports, dynamic imports or importScripts calls**. Coinbase initializes on selection with its code already in app.js. `dist/vendor/` contains only the four original license/notice files. The old vendor JavaScript files remain unchanged build intermediates in `site/vendor/`; production never requests them.

The complete inventory, file sizes and SHA-256 values are in [review/export-audit.json](review/export-audit.json). `verification.json` is retained because the existing app needs it to verify deployed code. Fonts, artwork and notices are retained. No dependency archive, node_modules, cache, sourcemap or registry mirror is in the export. Source, unchanged manifest/lockfile and generated export are included in the submission.

Compared against HEAD: **112 contract/source/dependency/config files were byte-for-byte unchanged**, excluding the single intended wallet import edit. This includes every contract and Solidity dependency, Foundry config, frontend manifest/lockfile, all three JSON manifests, HTML, CSS and remaining TypeScript source. Source/export manifest hashes match:

| File | SHA-256, unchanged from HEAD |
| --- | --- |
| config.json | `4c41e743f853aaee96da962384572b1546e33663242c55a3bf49578962690d9f` |
| abi.json | `ff0ef8746cbd0adda853a56eb9eaff61c81c346d263ac20d2856b3f0f447dd28` |
| verification.json | `03b82374cced2262fdcbefcf4a7f2a283b80f973a0998bad2ddfaa907a309648` |

Chain ID 4663, both RPC URLs, the three pad addresses, Uniswap addresses, deployment block and every other config value remain identical. No Git metadata, ignore file, protected build configuration or dependency was edited.

## Commands and actual outcomes

Installed locked tools with `npm ci --prefix /tmp/pvp-pad-tools`, using copies of the existing manifest/lockfile. Browser tools: `/tmp/pvp-browser` (Playwright 1.58.2, axe 4.11.0); browsers: `/tmp/pvp-browsers`.

| Command / check | Actual result |
| --- | --- |
| `node site/scripts/build.mjs` | Passed. Vendors built first and inlined with splitting disabled; dependency graphs and output AST audited. |
| `node site/scripts/typecheck.mjs` | Passed: TypeScript strict, noEmit. |
| `node site/scripts/test.mjs` | 12/12 passed: raffle/UTF-8 limits, payout/ranking boundaries, prices, slippage, swap encodings and tiny balances. |
| `forge build --skip test --skip script --out /tmp/pvp-foundry-out --cache-path /tmp/pvp-foundry-cache` | Passed with existing lint warnings. Only supplies unchanged bytecode to fixtures; no contract edit/deployment or ABI regeneration. |
| `PVP_FOUNDRY_OUT=/tmp/pvp-foundry-out PLAYWRIGHT_BROWSERS_PATH=/tmp/pvp-browsers node site/tests/browser.mjs` | **23/23 Chromium checks passed**, zero page errors, vendor requests or missing local assets. Four axe scans: zero violations. |
| `PLAYWRIGHT_BROWSERS_PATH=/tmp/pvp-browsers node site/tests/live.mjs` | Passed: chain 4663, all five normalized deployed bytecodes matched, both fonts loaded, mobile primary action visible, no script errors. |
| `node site/scripts/check-export.mjs --out /tmp/pvp-export-audit.json` | Passed: 24 complete files, identical source/export manifests, relative HTML/CSS assets, retained notices, import-free bundles. |
| `node site/tests/hosting.mjs` | 5/5 scenarios passed, 50 URL checks each. Complete export accepted; 404 fonts, HTTP 200 HTML replacing app.js, truncated worker and modified config each rejected. Local fixtures, not live-host evidence. |
| Pinned `taste.mjs --out test/scratch/taste` | **16/16 passed** at 320, 390 and 1440 with live RPC. |
| Pinned `taste.mjs --out /tmp/pvp-taste-offline --offline` | **16/16 passed** with external requests blocked. Local recovery interface/assets remained usable. |
| Assigned browser tool | Actual export inspected at 390×844 and 1440×1000, including screenshots, live closed-pad state, keyboard wallet opening, visible focus, Escape/focus return, resources and console. No horizontal overflow or page errors. |

The probe used `IMD_PLAYWRIGHT=/tmp/pvp-browser/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/tmp/pvp-browsers`. Reports: [taste-online.json](review/taste-online.json) and [taste-offline.json](review/taste-offline.json).

The browser suite serves dist under `/preview/`, refuses every vendor JS request, and also records worker requests. Coverage: navigation/filters, keyboard wallet dialog, EIP-6963 connection, entry, draw(32), one-based seats, roll/reveal timing, finalize/graduate/claim, buy/sell calldata and approvals, launch validation/preview, crown/fee/burn actions, keeper, worker salt mining/CREATE2 verification, RPC errors, rejection, unknown launch, public opening, bounded log scans, wrong-chain recovery, four mobile links and the actual bundled Coinbase button reaching its SDK popup flow. The popup is deliberately blocked in the fixture; no passkey/login/signature is requested.

An initial Coinbase test double threw from window.open and left the SDK waiting. The corrected fixture returns `null`, matching a browser-blocked popup; no production behavior was changed. It verifies initialization and the blocked-popup message, not external wallet authentication or popup recovery.

The live read at 15:11 UTC observed block **88,463,851**, `opened = false`, `launchCount = 0`; the coherent UI snapshot was block 88,463,846. Game phases therefore use the existing explicitly synthetic RPC/wallet fixture. Tests validate UI behavior and encoding, not funded EVM execution or live swap success.

Fresh evidence in [review/](review/): browser-results.json, live-read.json, live-pad-390.png, live-pad-1440.png, pad-390.png, game-390.png, game-1440.png and wallet-390.png. The 390 first screen shows product, entry price and main action. Title, favicon, description, og:title and local og:image are present and unchanged.

## Better Interface review

Applied the pinned workflow, core principles of all six domains and design-documentation section. The repair restores the existing interface and preserves its visual direction. [DESIGN.md](../DESIGN.md) documents source tokens, six-size type scale, components and responsive behavior. Guide attribution remains in review/design-guide-LICENSE.txt.

| Domain | Coverage and evidence |
| --- | --- |
| Accessibility — Checked | Source: native controls/dialogs, labels, skip link, focus, named board/equivalent seat table, errors and reduced motion. Rendered: keyboard opening, Escape/focus return, visible mobile dialog focus and four zero-violation axe scans. Screen reader and physical devices unperformed. |
| Layout — Checked | Existing shell/grids/board ordering/breakpoints preserved. No overflow at 320/390/768/1440; mobile/desktop screenshots inspected. Main action precedes board at 390. Native 200% zoom and pseudo-localization unperformed; no RTL/localized product. |
| Writing — Checked | Existing action labels, entry cost, risk footer, closed/empty/error/recovery copy reviewed. No copy change. Copy-budget/repetition probes pass. |
| Typography — Checked | Local Geist/Geist Mono, sizes, weights, line heights and wrapping preserved. Both faces loaded. Type size/face/tracking probes pass; mobile labels and tables fit. |
| Colors — Checked | Semantic tokens and text state cues preserved. Probe found no solid-background text failures at 4.5:1/3:1 thresholds. Canvas, translucent overlays and arbitrary user images are not fully measured contrast pairs. |
| UI — Checked | Rest/loading/empty/error, filters, wallet, transaction review and worker progress exercised in production bundles. Offline recovery and reduced-motion probe pass. Slow-motion replay and real wallet authentication unperformed. |

### Findings and corrections

| Severity / source | Evidence, correction and recheck |
| --- | --- |
| High — site/scripts/build.mjs:9 | Previously external ethers imports made missing vendor/ethers.js prevent startup and mining. Resolve to the local vendor input and inline in each entry. Graph/AST checks and browser suite pass with vendor requests denied. |
| High — site/src/wallet.ts:107 | Computed URL import escaped bundling and depended on vendor/coinbase.js. Literal import plus splitting:false (site/scripts/build.mjs:48) embeds it. Real Coinbase UI reaches popup flow with no vendor request. |
| Medium — site/tests/browser.mjs:610; site/tests/live.mjs:77 | Prior tests directly imported removed runtime vendor files. Now test Coinbase through the UI and use locked Node ethers for the auxiliary chain check. Both suites pass on dist. |
| Verification gap — site/scripts/verify-hosting.mjs:9 | First-route browsing misses worker/deferred assets and partial pins. Added full inventory fetch from both endpoints, status/HTML/length/SHA checks and nonzero failure exit. Five local fault scenarios pass; live checks require publication below. |

No UI redesign/new feature was needed. The assigned browser emitted Geist preload warnings on repeated reloads; requests returned 200 and both fonts loaded. The existing preload was preserved. WebKit downloaded but **could not launch** because system libraries (including libgstreamer and libgtk-4) are missing; not a pass. Real mobile apps, passkeys, signing, screen readers and native Safari remain unverified.

## Publication and completion

**Incomplete: the publication gate is blocked by the installed runtime.** Local repair, production export, typecheck, interactions and design review are complete. `imd site publish dist --name pvp-pad` exited **2** with:

> refused: imd site publishes this contributor's own site, never a job's work. A job's website is hosted by the plane when the job completes: commit the source and the export in dist/ and submit. There is nothing to publish and nothing to ask an operator for.

No new hosted URL, IPFS CID or pinned-byte count was returned. Consequently **none of the required live-host or IPFS-gateway file checks could run**. [review/publication.json](review/publication.json) records the command, refusal and every exported filename with null status codes, explicitly marked unperformed. The publication result is `passed: false`; the site is not claimed to have been republished. This is a runtime restriction, not missing requester information, so no requester-input file or question is created.

A complete standalone Git bundle of the 204-file submission tree measured **1,581,486 bytes** before this small failure record was added (limit 8,388,608); all source file bytes totaled 5,381,411. Measurement used an isolated /tmp Git repository; the task's Git metadata was untouched. A history-inclusive clone could not be measured because the supplied repository has unavailable promisor objects. The final pre-report bundle measured **1,583,015 bytes**, with 205 files / 5,388,210 uncompressed bytes. The final documentation update is below 1 KB, leaving more than 6 MB of bundle headroom.

The delivered `site/scripts/verify-hosting.mjs` fetches every URL from both endpoints and fails on any non-200, HTML asset error, omission, truncation or byte mismatch. See [README](README.md#verify-a-publication). The 1,184,875-byte local export total is **not a claim of bytes pinned**. No new CID or hosted URL is invented; the previous CID is not presented as the repaired version.
