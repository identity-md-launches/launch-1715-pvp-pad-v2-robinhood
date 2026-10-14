import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { createRequire } from "node:module";
const requireBrowser = createRequire(
  resolve(process.env.PVP_BROWSER_TOOLS || "/tmp/pvp-browser", "package.json"),
);
const { chromium } = requireBrowser("playwright");
const root = resolve(new URL("../..", import.meta.url).pathname),
  dist = resolve(root, "dist");
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(
      new URL(req.url, "http://local").pathname,
    ).replace(/^\/preview\//, "");
    const f = resolve(dist, path || "index.html");
    if (!f.startsWith(dist + "/")) throw Error("Path");
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".json": "application/json",
        ".css": "text/css",
        ".woff2": "font/woff2",
        ".svg": "image/svg+xml",
        ".png": "image/png",
      }[extname(f)] || "application/octet-stream",
    );
    res.end(await readFile(f));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
  env: {
    ...process.env,
    XDG_CONFIG_HOME: "/tmp/pvp-xdg-config",
    XDG_CACHE_HOME: "/tmp/pvp-xdg-cache",
  },
});
await mkdir(resolve(root, "artifacts"), { recursive: true });
const report = { at: new Date().toISOString(), errors: [], requests: [] };
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.origin !== new URL(url).origin && !report.requests.includes(u.origin))
      report.requests.push(u.origin);
  });
  await page.goto(url);
  await page.waitForFunction(
    () =>
      document.querySelector("#sync-label").textContent.startsWith("Updated"),
    {},
    { timeout: 45000 },
  );
  report.ui = await page.locator("#main").innerText();
  report.status = await page.locator("#sync-label").textContent();
  report.chain = await page.evaluate(async () => {
    const [{ Interface, keccak256 }, config, abi, verification] =
      await Promise.all([
        import("./vendor/ethers.js"),
        fetch("./config.json").then((r) => r.json()),
        fetch("./abi.json").then((r) => r.json()),
        fetch("./verification.json").then((r) => r.json()),
      ]);
    let id = 0;
    const rpc = async (method, params = []) => {
      const r = await fetch(config.rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      }).then((r) => r.json());
      if (r.error) throw Error(r.error.message);
      return r.result;
    };
    const chainId = Number(await rpc("eth_chainId"));
    const block = Number(await rpc("eth_blockNumber"));
    const contracts = [];
    for (const [name, v] of Object.entries(verification.contracts)) {
      let code = await rpc("eth_getCode", [v.address, "latest"]);
      for (const m of v.masks)
        code =
          code.slice(0, 2 + m.start * 2) +
          "0".repeat(m.length * 2) +
          code.slice(2 + (m.start + m.length) * 2);
      contracts.push({
        name,
        address: v.address,
        normalizedRuntimeMatches: keccak256(code) === v.codeHash,
      });
    }
    const iface = new Interface(abi.PvPPad);
    const view = async (name) =>
      iface.decodeFunctionResult(
        name,
        await rpc("eth_call", [
          { to: config.PvPPad, data: iface.encodeFunctionData(name) },
          "latest",
        ]),
      )[0];
    return {
      chainId,
      block,
      contracts,
      opened: await view("opened"),
      launchCount: String(await view("launchCount")),
      owner: await view("owner"),
      openDeadline: String(await view("openDeadline")),
    };
  });
  await page.screenshot({
    path: resolve(root, "artifacts/live-pad-390.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: resolve(root, "artifacts/live-pad-1440.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const primary = await page.locator(".hero .primary").boundingBox();
  report.mobilePrimaryVisible =
    !!primary && primary.y >= 0 && primary.y + primary.height <= 844;
  // Review the unconnected mobile wallet sheet using the real export; do not request signatures.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#connect").click();
  await page.screenshot({ path: resolve(root, "artifacts/wallet-390.png") });
  await page.keyboard.press("Escape");
  report.fonts = await page.evaluate(() => ({
    sans: document.fonts.check("16px Geist"),
    mono: document.fonts.check('16px "Geist Mono"'),
  }));
  await context.close();
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  report.error = e.message;
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
  await writeFile(
    resolve(root, "artifacts/live-read.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}
