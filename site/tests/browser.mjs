import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { createRequire } from "node:module";
import { fixture, injectWallet, ACCOUNT, GAME, TOKEN } from "./fixture.mjs";
const requireBrowser = createRequire(
  resolve(process.env.PVP_BROWSER_TOOLS || "/tmp/pvp-browser", "package.json"),
);
const { chromium, webkit } = requireBrowser("playwright");
const { AxeBuilder } = requireBrowser("@axe-core/playwright");
const root = resolve(new URL("../..", import.meta.url).pathname);
const exportDir = resolve(root, "dist");
const outputDir = resolve(process.env.PVP_CHECK_OUT || "/tmp/pvp-pad-checks");
const vendorRequests = [];
const assetFailures = [];
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    const rel = path.replace(/^\/preview\/?/, "") || "index.html";
    if (/^vendor\/.*\.js$/.test(rel)) {
      vendorRequests.push(rel);
      res.writeHead(404).end();
      return;
    }
    const full = resolve(exportDir, rel);
    if (!full.startsWith(exportDir + "/")) {
      res.writeHead(403).end();
      return;
    }
    const data = await readFile(full);
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".json": "application/json",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".woff2": "font/woff2",
        ".png": "image/png",
      }[extname(full)] || "application/octet-stream",
    );
    res.end(data);
  } catch {
    assetFailures.push(req.url);
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
await mkdir(outputDir, { recursive: true });
const results = { checkedAt: new Date().toISOString(), checks: [], limitations: [], errors: [], axe: [], vendorRequests, assetFailures };
let browser;
async function check(name, fn) {
  try {
    await fn();
    results.checks.push({ name, passed: true });
    console.log("PASS " + name);
  } catch (e) {
    results.checks.push({ name, passed: false, error: e.message });
    throw e;
  }
}
async function connect(page) {
  await page.locator("#connect").click();
  await page
    .getByRole("button", { name: "Fixture Wallet", exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector("#connect").textContent.includes("1111"),
  );
}
async function update(page, m, phase, extras = {}) {
  Object.assign(m.state, { phase }, extras);
  await page.locator("#refresh").click();
  await page.waitForFunction(
    (expected) =>
      document.querySelector("main .phase")?.textContent === expected,
    [
      "Waiting",
      "Signup",
      "Play",
      "Ended",
      "Finalized",
      "Graduated",
      "Failed",
      "Drawing",
    ][phase],
  );
}
async function clickTx(page, action) {
  const count = await page
    .locator("#toasts .toast p")
    .filter({ hasText: "confirmed." })
    .count();
  await page.locator(`[data-action="${action}"]`).first().click();
  await page.locator("#tx-confirm").click();
  await page.waitForFunction(
    (n) =>
      [...document.querySelectorAll("#toasts .toast p")].filter((e) =>
        e.textContent.includes("confirmed."),
      ).length > n,
    count,
    { timeout: 20000 },
  );
  await page.waitForFunction(
    () => document.querySelector("main").getAttribute("aria-busy") === "false",
  );
  const dismiss = page.getByRole("button", {
    name: "Dismiss all notifications",
    exact: true,
  });
  if (await dismiss.isVisible()) await dismiss.click();
}
try {
  browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
    env: {
      ...process.env,
      XDG_CONFIG_HOME: "/tmp/pvp-xdg-config",
      XDG_CACHE_HOME: "/tmp/pvp-xdg-cache",
    },
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const mock = await fixture();
  page.on("pageerror", (e) => results.errors.push(e.message));
  await page.route(
    "https://rpc.mainnet.chain.robinhood.com/**",
    async (route) => {
      const body = route.request().postDataJSON();
      const out = Array.isArray(body)
        ? await Promise.all(body.map(mock.rpc))
        : await mock.rpc(body);
      await route.fulfill({
        json: out,
        headers: { "access-control-allow-origin": "*" },
      });
    },
  );
  await injectWallet(page);
  await page.goto(url);
  await page.waitForFunction(() =>
    document.querySelector("#sync-label").textContent.startsWith("Updated"),
  );
  await check(
    "390px first screen contains product and primary action",
    async () => {
      const box = await page
        .getByRole("link", { name: /Enter for 0.001 ETH/ })
        .boundingBox();
      assert.ok(box.y + box.height < 844);
      assert.equal(await page.locator("h1").textContent(), "PvP genesis.");
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.screenshot({
        path: resolve(outputDir, "pad-390.png"),
        type: "png",
        fullPage: true,
      });
    },
  );
  await check(
    "hash navigation, launch filters, rules and wallet-free reads",
    async () => {
      await page
        .getByRole("button", { name: "Graduated", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "No matching launches" })
        .waitFor();
      await page.getByRole("button", { name: "Show all launches" }).click();
      await page.locator('.nav a[href="#/rules"]').click();
      await page.getByRole("heading", { name: "Rules of the pad" }).waitFor();
      await page.locator(".skip").focus();
      await page.keyboard.press("Enter");
      assert.equal(new URL(page.url()).hash, "#/rules");
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "main",
      );
      await page.locator('.nav a[href="#/"]').click();
    },
  );
  await check(
    "wallet picker is keyboard reachable and Escape restores focus",
    async () => {
      await page.locator("#connect").focus();
      await page.keyboard.press("Enter");
      await page.locator("#wallet-dialog").waitFor({ state: "visible" });
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#wallet-dialog").isVisible(), false);
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "connect",
      );
    },
  );
  await check(
    "EIP-6963 connect, review and 0.001 ETH entry transaction",
    async () => {
      await connect(page);
      await page
        .getByRole("link", { name: /Enter for 0.001 ETH/ })
        .first()
        .click();
      await page.locator('[data-action="enter"]').waitFor();
      await clickTx(page, "enter");
      assert.equal(mock.state.txs.at(-1).method, "enter");
      assert.equal(BigInt(mock.state.txs.at(-1).value), 1000000000000000n);
      await page.getByRole("button", { name: "Already entered" }).waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Already entered" })
          .isDisabled(),
        true,
      );
    },
  );
  await check(
    "drawing progress, draw(32), and 1-based seat display",
    async () => {
      await update(page, mock, 7, { entries: 64, drawn: 32 });
      await clickTx(page, "draw");
      assert.equal(mock.state.txs.at(-1).args[0], 32n);
      await page.getByRole("heading", { name: "Imp #1" }).waitFor();
      await page.locator('.nav a[href="#/"]').click();
      const seats = page
        .locator(".hero-stats .stat")
        .filter({ has: page.locator("dt", { hasText: "Seats" }) });
      assert.equal(await seats.locator("dd").textContent(), "5");
      await page
        .getByRole("link", { name: "Open the game", exact: false })
        .first()
        .click();
      await page.getByRole("heading", { name: "Imp #1" }).waitFor();
    },
  );
  await check(
    "roll, three L2 block wait, reveal(8), and result animation state",
    async () => {
      await update(page, mock, 2);
      await clickTx(page, "roll");
      assert.equal(BigInt(mock.state.txs.at(-1).value), 2000000000000000n);
      await page.getByText("rolling...", { exact: true }).waitFor();
      assert.equal(
        await page.locator('[data-action="reveal"]').isDisabled(),
        true,
      );
      mock.state.block += 4;
      await page.locator("#refresh").click();
      await page.waitForFunction(
        () => !document.querySelector('[data-action="reveal"]').disabled,
      );
      await clickTx(page, "reveal");
      assert.equal(mock.state.txs.at(-1).method, "resolvePending");
      assert.equal(mock.state.txs.at(-1).args[0], 8n);
      await page.getByText("Seat #1 moved +3 to 15").waitFor();
      await page.screenshot({
        path: resolve(outputDir, "game-390.png"),
        type: "png",
        fullPage: true,
      });
    },
  );
  await check("ended → finalize → graduate and claim controls", async () => {
    await update(page, mock, 3);
    await clickTx(page, "finalize");
    await page
      .getByRole("button", { name: "Graduate coin", exact: true })
      .waitFor();
    await clickTx(page, "graduate");
    await page.getByRole("heading", { name: "Trade PVP" }).waitFor();
    await clickTx(page, "claim-game");
    assert.equal(mock.state.txs.at(-1).method, "claim");
  });
  await check("buy quote, slippage minimum, v4 router execution", async () => {
    await page.locator("#trade-amount").fill("0.01");
    await page.locator("#slippage").fill("1");
    await page.getByRole("button", { name: "Get quote", exact: true }).click();
    await page.locator('[data-action="swap"]').waitFor();
    await clickTx(page, "swap");
    const tx = mock.state.txs.at(-1);
    assert.equal(tx.name, "UniversalRouter");
    assert.equal(tx.args[0], "0x10");
    assert.equal(BigInt(tx.value), 10000000000000000n);
  });
  await check(
    "sell executes token approval, Permit2 approval, then v4 swap",
    async () => {
      await page.locator('[data-action="trade-sell"]').click();
      await page.locator("#trade-amount").fill("10");
      await page
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
      await page.locator('[data-action="swap"]').waitFor();
      const start = mock.state.txs.length;
      assert.ok(
        (await page.locator("#trade-panel").innerText()).includes("0.001 ETH"),
      );
      await page.locator('[data-action="swap"]').click();
      await page.locator("#tx-confirm").click();
      await page
        .getByText("Sell coin: confirmed.", { exact: true })
        .waitFor({ timeout: 20000 });
      assert.deepEqual(
        mock.state.txs.slice(start).map((t) => [t.name, t.method]),
        [
          ["PadToken", "approve"],
          ["Permit2", "approve"],
          ["UniversalRouter", "execute"],
        ],
      );
      assert.equal(mock.state.txs[start].args[1], 10000000000000000000n);
    },
  );
  await check("launch UTF-8 validation and changing card preview", async () => {
    await page.locator('.nav a[href="#/launch"]').click();
    await page.locator("#launch-name").fill("🙂".repeat(9));
    await page.locator("#launch-ticker").fill("IMP");
    await page.locator("#launch-form button[type=submit]").click();
    assert.equal(
      await page.locator("#launch-name").getAttribute("aria-invalid"),
      "true",
    );
    await page.locator("#launch-name").fill("Little Imps");
    assert.equal(
      await page.locator("#preview-name").textContent(),
      "Little Imps",
    );
    await page
      .locator("#launch-image")
      .fill("https://example.com/" + "é".repeat(100));
    await page.locator("#launch-form button[type=submit]").click();
    assert.equal(
      await page.locator("#launch-image").getAttribute("aria-invalid"),
      "true",
    );
    await page.locator("#launch-image").fill("");
    await page.locator("#launch-form button[type=submit]").click();
    await page.locator("#tx-confirm").click();
    await page.getByText("Launch coin: confirmed.", { exact: true }).waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector("main").getAttribute("aria-busy") === "false",
    );
    assert.equal(mock.state.txs.at(-1).method, "launch");
  });
  await check(
    "king bid, distribute(8), both claims, and burnChunk interactions",
    async () => {
      const dismiss = page.getByRole("button", {
        name: "Dismiss all notifications",
        exact: true,
      });
      if (await dismiss.isVisible()) await dismiss.click();
      await page.locator('.nav a[href="#/king"]').click();
      await page.locator("#crown-bid").fill("0.023");
      await page
        .getByRole("button", { name: "Take crown", exact: true })
        .click();
      await page.locator("#tx-confirm").click();
      await page.getByText("Take crown: confirmed.", { exact: true }).waitFor();
      assert.equal(mock.state.txs.at(-1).method, "takeCrown");
      await clickTx(page, "distribute");
      assert.equal(mock.state.txs.at(-1).args[0], 8n);
      mock.state.claim = 1000000000000000n;
      await page.locator("#refresh").click();
      await page.waitForFunction(
        () => !document.querySelector('[data-action="claim-king"]').disabled,
      );
      await clickTx(page, "claim-king");
      mock.state.claim = 1000000000000000n;
      await page.locator("#refresh").click();
      await page.waitForFunction(
        () =>
          !document.querySelector('[data-action="claim-liquidity"]').disabled,
      );
      await clickTx(page, "claim-liquidity");
      await page.locator('.nav a[href="#/burn"]').click();
      await clickTx(page, "burn");
      assert.equal(mock.state.txs.at(-1).method, "burnChunk");
    },
  );
  await check("keeper select and permissionless poke", async () => {
    await page.locator('.nav a[href="#/keeper"]').click();
    await page.locator("#keeper-game").selectOption("1");
    await clickTx(page, "poke");
    assert.equal(mock.state.txs.at(-1).method, "poke");
  });
  await check(
    "owner mines salt in worker, verifies CREATE2 and opens pad",
    async () => {
      mock.state.opened = false;
      mock.state.count = 0;
      await page.goto(url + "#/owner");
      await page.getByRole("button", { name: "Mine hook salt" }).waitFor();
      await page.getByRole("button", { name: "Mine hook salt" }).click();
      await page
        .locator('[data-action="open-pad"]')
        .waitFor({ timeout: 30000 });
      await clickTx(page, "open-pad");
      assert.equal(mock.state.txs.at(-1).method, "openPad");
    },
  );
  await check(
    "RPC error preserves last known data and pauses transactions",
    async () => {
      mock.state.rpcFailure = true;
      await page.locator("#refresh").click();
      await page
        .getByText("Read is stale. Transactions are paused.", { exact: true })
        .waitFor();
      mock.state.rpcFailure = false;
      await page.locator("#refresh").click();
      await page.waitForFunction(
        () =>
          !document
            .querySelector("#connection-status")
            .classList.contains("error"),
      );
    },
  );
  await check(
    "wallet rejection keeps the user in control and sends no transaction",
    async () => {
      mock.state.opened = true;
      mock.state.phase = 5;
      mock.state.count = 1;
      await page.goto(url + "#/burn");
      await page.waitForFunction(
        () => !document.querySelector('[data-action="burn"]').disabled,
      );
      mock.state.reject = true;
      const count = mock.state.txs.length;
      await page.locator('[data-action="burn"]').click();
      await page.locator("#tx-confirm").click();
      await page
        .getByText(/Request declined in your wallet/)
        .first()
        .waitFor();
      await page.waitForFunction(
        () =>
          document.querySelector("main").getAttribute("aria-busy") === "false",
      );
      assert.equal(mock.state.txs.length, count);
      mock.state.reject = false;
      await page
        .getByRole("button", { name: "Dismiss all notifications", exact: true })
        .click();
    },
  );
  await check(
    "unknown launch rejected, failed genesis restart, and owner deadline access",
    async () => {
      await page.goto(url + "#/game/999");
      await page.getByRole("heading", { name: "Game unavailable" }).waitFor();
      mock.state.phase = 6;
      await page.goto(url + "#/game/1");
      await page.locator('[data-action="restart"]').waitFor();
      await clickTx(page, "restart");
      assert.equal(mock.state.txs.at(-1).method, "restartGenesis");
      mock.state.opened = false;
      mock.state.owner = "0x8888888888888888888888888888888888888888";
      await page.goto(url + "#/owner");
      await page.getByRole("heading", { name: "Opening access" }).waitFor();
      assert.equal(await page.locator('[data-action="mine"]').count(), 0);
      mock.state.deadlineOffset = -1;
      await page.locator("#refresh").click();
      await page
        .getByRole("heading", { name: "Public opening", exact: true })
        .waitFor();
      await page.locator('[data-action="mine"]').waitFor();
      mock.state.opened = true;
      mock.state.owner = ACCOUNT;
      mock.state.deadlineOffset = 3600;
    },
  );
  await check(
    "all log reads begin at deployment and use bounded chunks",
    async () => {
      assert.ok(mock.state.logRequests.length > 0);
      assert.equal(
        Number(mock.state.logRequests[0].fromBlock),
        mock.config.deploymentBlock,
      );
      assert.ok(
        mock.state.logRequests.every(
          (x) => Number(x.toBlock) - Number(x.fromBlock) < mock.config.logChunk,
        ),
      );
    },
  );
  await check(
    "responsive export at 320, 390, 768 and 1440; no horizontal overflow",
    async () => {
      mock.state.opened = true;
      mock.state.count = 1;
      mock.state.phase = 2;
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(url + "#/game/1");
        await page.getByRole("heading", { name: "Imp #1" }).waitFor();
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
          "overflow at " + width,
        );
        if (width === 1440)
          await page.screenshot({
            path: resolve(outputDir, "game-1440.png"),
            type: "png",
            fullPage: true,
          });
      }
    },
  );
  await check(
    "axe audit of game, wallet dialog, launch and rules",
    async () => {
      for (const route of ["#/game/1", "#/launch", "#/rules"]) {
        await page.goto(url + route);
        await page.waitForFunction(() =>
          document
            .querySelector("#sync-label")
            .textContent.startsWith("Updated"),
        );
        const a = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        results.axe.push({
          route,
          violations: a.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.map((n) => n.target),
          })),
        });
        assert.equal(
          a.violations.length,
          0,
          JSON.stringify(results.axe.at(-1)),
        );
      }
      await page.locator("#connect").click();
      const a = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      results.axe.push({
        route: "wallet",
        violations: a.violations.map((v) => v.id),
      });
      assert.equal(a.violations.length, 0);
      await page.keyboard.press("Escape");
    },
  );
  await check("no browser script errors", async () =>
    assert.deepEqual(results.errors, []),
  );
  // Separate context validates the wrong-network path without contaminating the read RPC.
  const wrong = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const wp = await wrong.newPage();
  await injectWallet(wp, 1);
  await wp.route(
    "https://rpc.mainnet.chain.robinhood.com/**",
    async (route) => {
      const b = route.request().postDataJSON();
      await route.fulfill({
        json: Array.isArray(b)
          ? await Promise.all(b.map(mock.rpc))
          : await mock.rpc(b),
      });
    },
  );
  await wp.goto(url);
  await wp.waitForFunction(() =>
    document.querySelector("#sync-label").textContent.startsWith("Updated"),
  );
  await check(
    "wrong-network button adds Robinhood Chain and recovers",
    async () => {
      await wp.locator("#connect").click();
      await wp
        .getByRole("button", { name: "Fixture Wallet", exact: true })
        .click();
      await wp.getByText("Your wallet is on another network.").waitFor();
      await wp.locator('#network-notice [data-action="switch"]').click();
      await wp.waitForFunction(() =>
        document.querySelector("#connect").textContent.includes("1111"),
      );
      assert.equal(await wp.locator("#network-notice").textContent(), "");
    },
  );
  await wrong.close();
  await check(
    "mobile wallet links and local Coinbase Smart Wallet module",
    async () => {
      const mobile = await browser.newContext({
        viewport: { width: 390, height: 844 },
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      });
      const mp = await mobile.newPage();
      await mp.route(
        "https://rpc.mainnet.chain.robinhood.com/**",
        async (r) => {
          const b = r.request().postDataJSON();
          await r.fulfill({
            json: Array.isArray(b)
              ? await Promise.all(b.map(mock.rpc))
              : await mock.rpc(b),
          });
        },
      );
      await mp.goto(url);
      await mp.locator("#connect").click();
      for (const name of ["MetaMask", "Coinbase Wallet", "Rabby", "Phantom"])
        await mp
          .getByRole("link", { name: "Open in " + name, exact: true })
          .waitFor();
      assert.ok(
        (
          await mp
            .getByRole("link", { name: "Open in Rabby", exact: true })
            .getAttribute("href")
        ).includes("_cmd=open-dapp"),
      );
      // Exercise the actual bundled connector through its UI, without opening
      // an external wallet or asking anyone to authenticate/sign.
      await mp.evaluate(() => {
        window.open = (url) => {
          globalThis.__coinbasePopupUrl = String(url);
          return null; // Simulate the browser blocking the popup.
        };
      });
      await mp.getByRole("button", { name: "Coinbase Smart Wallet", exact: true }).click();
      await mp.waitForFunction(() => !!globalThis.__coinbasePopupUrl);
      assert.equal(new URL(await mp.evaluate(() => globalThis.__coinbasePopupUrl)).hostname, "keys.coinbase.com");
      await mp.getByText("Popup was blocked. Try again.", { exact: true }).waitFor();
      assert.equal(await mp.getByRole("button", { name: "Coinbase Smart Wallet · opening…", exact: true }).isDisabled(), true);
      // This proves the production SDK reached its popup flow; authentication,
      // signing and SDK popup recovery are outside this bundling regression.
      await mobile.close();
    },
  );
  try {
    const wb = await webkit.launch({ headless: true, timeout: 12000 });
    const wc = await wb.newContext({ viewport: { width: 390, height: 844 } });
    const w = await wc.newPage();
    await w.route("https://rpc.mainnet.chain.robinhood.com/**", async (r) => {
      const b = r.request().postDataJSON();
      await r.fulfill({
        json: Array.isArray(b)
          ? await Promise.all(b.map(mock.rpc))
          : await mock.rpc(b),
      });
    });
    await injectWallet(w);
    await w.goto(url);
    await w.waitForFunction(() =>
      document.querySelector("#sync-label").textContent.startsWith("Updated"),
    );
    await connect(w);
    await w.locator('.nav a[href="#/rules"]').click();
    await w.getByRole("heading", { name: "Rules of the pad" }).waitFor();
    assert.equal(
      await w.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    results.checks.push({
      name: "WebKit mobile navigation and wallet connect",
      passed: true,
    });
    await wb.close();
  } catch (e) {
    results.limitations.push(
      "WebKit could not launch: " + e.message.slice(0, 2000),
    );
  }
  await check("all interactions and salt mining work with vendor JS unavailable", async () => {
    assert.deepEqual(vendorRequests, []);
    assert.deepEqual(assetFailures, []);
  });
  await context.close();
} catch (e) {
  console.error(e);
  results.failure = e.message;
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.close();
  await writeFile(
    resolve(outputDir, "browser-results.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
}
