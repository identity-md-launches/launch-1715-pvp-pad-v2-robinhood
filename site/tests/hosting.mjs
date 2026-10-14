import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { verifyHosting } from "../scripts/verify-hosting.mjs";
import { root } from "../scripts/check-export.mjs";

const dist = resolve(root, "dist");
const server = createServer(async (req, res) => {
  try {
    const [, mode, ...parts] = new URL(req.url, "http://localhost").pathname.split("/");
    const file = parts.join("/") || "index.html";
    const path = resolve(dist, file);
    if (!path.startsWith(dist + "/")) throw new Error("Invalid path");
    if (mode === "missing" && file.endsWith(".woff2")) {
      res.writeHead(404).end("Not found");
      return;
    }
    if (mode === "html" && file === "app.js") {
      res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><html>Gateway error</html>");
      return;
    }
    let data = await readFile(path);
    if (mode === "truncated" && file === "salt-worker.js") data = data.subarray(0, 275000);
    if (mode === "changed" && file === "config.json") data = Buffer.from(data.toString().replace('"chainId": 4663', '"chainId": 4664'));
    res.setHeader("content-type", { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" }[extname(path)] || "text/plain");
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  for (const mode of ["complete", "missing", "html", "truncated", "changed"]) {
    // Explicit local fixture, not a claim about a published CID.
    const report = await verifyHosting({ host: `${base}/${mode}/`, gateway: `${base}/complete/`, cid: null });
    assert.equal(report.passed, mode === "complete", mode);
    assert.equal(report.checks.length, (report.fileCount + 1) * 2);
    assert.ok(report.checks.filter((c) => c.origin === "gateway").every((c) => c.passed));
    if (mode === "html") assert.ok(report.checks.some((c) => c.status === 200 && c.htmlInsteadOfAsset && !c.passed));
    console.log(`PASS hosting verifier: ${mode} (${report.checks.length} URL checks)`);
  }
} finally { server.close(); }
