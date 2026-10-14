# PvP Pad static website

A wallet-optional interface for the existing PvPPad, PadLiquidity and KingOfThePad deployment on Robinhood Chain 4663. No contract source, deployment, dependency or Foundry configuration was changed. The website contains no backend or indexer.

`site/` contains source and a complete directly servable site. `dist/` is the production export for the job’s IPFS publisher. Both contain relative runtime URLs and hash routing, so a gateway subpath works without rewrites. Pin the **entire contents of `dist/`** with `index.html` at the root, retaining the existing label **pvp-pad**. The export is 24 files / 1,184,875 bytes, including notices. See [VALIDATION.md](./VALIDATION.md) for the publication result and verification limitations. The local publishing CLI refused this job with exit 2: only the contributor plane can publish job exports after submission. No new URL/CID or completed live-host verification is claimed.

## Install, preview and rebuild

Use Node.js 22+ and npm. From the repository root, keep dependencies outside the checkout:

```sh
mkdir -p /tmp/pvp-pad-tools
cp site/package.json site/package-lock.json /tmp/pvp-pad-tools/
npm ci --prefix /tmp/pvp-pad-tools
node site/scripts/typecheck.mjs
node site/scripts/test.mjs
node site/scripts/build.mjs
node site/scripts/check-export.mjs
python3 -m http.server 8080 --directory dist
```

Open `http://localhost:8080`. `file://` does not support the fetch and module-worker behavior this app needs. Set `PVP_TOOLS` if using another dependency directory. The helper scripts resolve their locked tools from that directory; do not commit a `node_modules` directory or package cache. The existing source manifest and lockfile are unchanged.

The build regenerates the locked ethers and Coinbase vendor files, then **inlines those files into `app.js`**. Coinbase initializes only when selected, without fetching another script. `salt-worker.js` also contains its own ethers implementation. Code splitting is disabled. The build checks both output dependency graphs and parses the resulting JavaScript to reject static imports, dynamic imports and `importScripts`. The site makes **zero runtime requests for `vendor/*.js`**; those two files remain source build intermediates in `site/vendor/` and are excluded from `dist/`. All vendor LICENSE/notice files remain in the export. Fonts and artwork remain local, and `verification.json` remains required by the existing contract checks. There are no sourcemaps, dependency tarballs or registry mirrors in the export.

The interface uses TypeScript and native browser components, bundled with esbuild to keep the export small. The authoritative editable files are `src/*.ts`, `style.css`, `index.html` and `config.json` inside `site/`. Generated JS is included to make the site immediately servable. Original social artwork is in `assets/social.svg` and its exported PNG; `scripts/social.mjs` regenerates the PNG using a local Playwright installation.

## Contract integration

`config.json` contains the exact requested chain, RPC, explorer, deployment block and contract addresses. `abi.json` comes from the existing Foundry build. All five canonical, recursively key-sorted JSON ABI Keccak hashes matched the pinned deployment. The source commit and expected normalized runtime hashes are preserved in `verification.json`.

To recheck the ABI against the unchanged contracts:

```sh
forge build --skip test --skip script
node site/scripts/abi.mjs
node site/scripts/build.mjs
```

The ABI script uses the pinned deployment input when available, otherwise the delivered verification manifest. Runtime verification masks compiler-declared immutable regions and compares the remaining deployed code with the build, then checks pad/liquidity/king bindings and the presence of configured Uniswap contracts. Game transactions also verify the selected launch through `getLaunch`, `gameOf` and `tokenOf`, and require the registered game/token to be the expected minimal-proxy clones. Names and tickers never establish identity.

Views use one block tag per refresh. Polling runs every six seconds after each read completes. History starts at block 88,319,791 in chunks of at most 2,000 blocks, reducing the chunk when an RPC rejects it; six chunks are processed per polling cycle. The newest 32 blocks are re-read to repair shallow reorganizations. History is in memory, not an indexer; a new visit reconstructs it again. Large registries/history can take time and require an RPC that retains historical logs. Partial history is labelled. Reads pause transactions after errors or 30 seconds without an update.

The brief’s presentation uses 1-based entries and seats. The actual pinned contract has **zero-based `getImp`, `isAlive`, `getRoll`, Rolled/Resolved/Bell indices**, while `entryOf`, `impOf`, Entered and Seated are 1-based. The adapter follows the ABI/source for calls and normalizes every displayed seat. Pending roll pointers are decremented for `getRoll`. Reveal eligibility uses `ArbSys.arbBlockNumber() > commit + 3`, matching the three completed future L2 blocks in the source.

Trading reads `PadLiquidity.poolKey(token)` and quotes through the configured Quoter. It encodes UniversalRouter `V4_SWAP` (`0x10`) with `SWAP_EXACT_IN_SINGLE`, `SETTLE_ALL`, `TAKE_ALL` (`0x060c0f`). Robinhood’s `extendedSwapParams` includes `minHopPriceX36`; the absolute reviewed minimum is enforced, and quotes expire after 30 seconds. The transaction has a five-minute deadline. Sells request only the amount being sold in both ERC-20 and Permit2 approvals, with a 30-minute Permit2 expiration. After approvals the quote is checked again without lowering the reviewed minimum. No unlimited approvals are requested. ETH is represented by the native-currency zero address inside the pool key, not an invented recipient.

The crown, claims, burn, keeper and permissionless lifecycle actions use the generated ABI. Hook salt mining runs locally in a module Web Worker, then verifies its CREATE2 result with `hookAddressFor` before enabling `openPad`. The owner controls opening before `openDeadline`; afterwards anyone may open. No wallet keys, account secrets or recipient placeholders are included.

## Wallets and external requests

A single Connect control discovers extensions using EIP-6963, falls back to an injected browser wallet, and offers locally bundled Coinbase Smart Wallet. Mobile visitors can open the current URL in MetaMask, Coinbase Wallet, Rabby or Phantom. There is no relay or project ID. The only saved browser preference is the wallet connector choice; permissionless reads do not depend on it.

All site scripts, fonts, marks and artwork are local. Read-only production validation observed only the configured RPC as an external host. A user-selected wallet may contact its own service or open its passkey popup. An optional HTTPS image entered in the launch preview is fetched from that URL. Real passkey authentication, installed mobile apps, wallet custody and live signing were not exercised.

## Validation

The actual commands, results, source findings, screenshots and limitations are in [VALIDATION.md](./VALIDATION.md) and [review/](./review/). The root [DESIGN.md](../DESIGN.md) documents the final implementation.

Repeat the browser fixture suite with Playwright 1.58.2 and axe 4.11.0 installed separately:

```sh
npm install --prefix /tmp/pvp-browser playwright@1.58.2 @axe-core/playwright@4.11.0
PLAYWRIGHT_BROWSERS_PATH=/tmp/pvp-browsers node /tmp/pvp-browser/node_modules/playwright/cli.js install chromium webkit
forge build --skip test --skip script --out /tmp/pvp-foundry-out --cache-path /tmp/pvp-foundry-cache
PVP_FOUNDRY_OUT=/tmp/pvp-foundry-out PLAYWRIGHT_BROWSERS_PATH=/tmp/pvp-browsers node site/tests/browser.mjs
PLAYWRIGHT_BROWSERS_PATH=/tmp/pvp-browsers node site/tests/live.mjs
node site/tests/hosting.mjs
```

`PVP_BROWSER_TOOLS` changes the browser dependency location. These scripts own a short-lived local preview server under `/preview/` and close it. `PVP_FOUNDRY_OUT` selects the existing contract build artifacts (default `out/`). The fixture simulates RPC and EIP-1193 wallets and sends **no live transaction**. It refuses all vendor JS requests, exercises the real bundled Coinbase button up to a simulated blocked popup, and mines a salt with the production worker. The live script only reads the public chain. Reports default to `/tmp/pvp-pad-checks/`; `PVP_CHECK_OUT` overrides that directory. Reviewed delivery copies are in `site/review/`. WebKit was installed but could not launch because this machine lacks its shared libraries.

## Verify a publication

After the publisher supplies the actual hosted URL and CID, set `PVP_HOST_URL`, `PVP_IPFS_URL` (the gateway directory URL for that CID) and `PVP_IPFS_CID` to those values, then run:

```sh
node site/scripts/verify-hosting.mjs \
  --host "$PVP_HOST_URL" --gateway "$PVP_IPFS_URL" --cid "$PVP_IPFS_CID" \
  --out /tmp/pvp-hosting-verification.json
```

This fetches the directory page and **every exported file from both endpoints**, including the worker, both fonts, all artwork, JSON manifests and licenses. Every response must be HTTP 200 and match the local file's SHA-256 and length. HTML error responses, even with HTTP 200, fail. The command writes every URL/status/byte count/hash and exits nonzero on any failure. `node site/tests/hosting.mjs` verifies detection of missing fonts, HTML masquerading as JavaScript, a truncated worker and modified config. Export file bytes are not a claim about IPFS DAG overhead or bytes actually pinned; publication must provide the CID before the live check can pass.

## Attribution

- [The Spireth](https://github.com/Lavel0rz/Spireth), MIT: layout inspiration; its notice is in `assets/Spireth-LICENSE.txt`. No image files were copied.
- Geist and Geist Mono, SIL OFL: local font licenses in `fonts/`.
- ethers 6.15.0, MIT; Coinbase Wallet SDK 4.3.7, Apache-2.0; bundled dependency notices in `vendor/`.
- Wallet marks from [RainbowKit](https://github.com/rainbow-me/rainbowkit), MIT, with `assets/wallet-icons-LICENSE.txt`. Rabby’s deep link follows its [universal-link handler](https://github.com/RabbyHub/rabby-mobile/blob/develop/apps/mobile/src/hooks/universalLink.ts).
- Uniswap encoding checked against its [v4 swap guide](https://developers.uniswap.org/docs/protocols/v4/guides/swapping/swapping) and current [IV4Router](https://github.com/Uniswap/v4-periphery/blob/main/src/interfaces/IV4Router.sol)/[IV4Quoter](https://github.com/Uniswap/v4-periphery/blob/main/src/interfaces/IV4Quoter.sol) interfaces on 2026-10-14; the supplied network configuration selects the extended router tuple.
- Better Interface by Jakub Krehel, MIT, pinned commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`; documentation method from Paul Bakaus’s Impeccable, Apache-2.0, pinned commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`. Their combined supplied license is retained in `review/design-guide-LICENSE.txt`.

Experimental, unaudited contracts. You can lose everything you put in. Not financial advice. Check your local laws.
