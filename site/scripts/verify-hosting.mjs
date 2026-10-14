import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectExport, sha256 } from "./check-export.mjs";

// Fetch all exported files, not just files the first route happens to request.
// Exact-byte comparison also rejects HTTP 200 error pages and truncated bundles.
export async function verifyHosting({ host, gateway, cid }) {
  const inventory = await inspectExport();
  const report = { checkedAt: new Date().toISOString(), ...inventory, cid, host, gateway, checks: [], passed: true };
  const index = inventory.files.find((f) => f.file === "index.html");
  for (const [origin, base] of [["host", host], ["gateway", gateway]]) {
    const baseUrl = new URL(base.endsWith("/") ? base : base + "/");
    if (!["http:", "https:"].includes(baseUrl.protocol)) throw new Error("Use an HTTP(S) site or gateway URL");
    const queue = [{ ...index, file: "" }, ...inventory.files];
    // Limit concurrency to avoid swamping a cold IPFS gateway.
    for (let i = 0; i < queue.length; i += 4) {
      const batch = await Promise.all(queue.slice(i, i + 4).map(async (file) => {
        const url = new URL(file.file.split("/").map(encodeURIComponent).join("/"), baseUrl).href;
        const check = { origin, file: file.file || "/", url, expectedBytes: file.bytes, status: null, passed: false };
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(45000), cache: "no-store" });
          const body = Buffer.from(await res.arrayBuffer());
          Object.assign(check, {
            status: res.status, finalUrl: res.url, contentType: res.headers.get("content-type"),
            bytes: body.length, sha256: sha256(body),
            htmlInsteadOfAsset: !!file.file && !file.file.endsWith(".html") &&
              (/text\/html/i.test(res.headers.get("content-type") || "") || /^\s*(?:<!doctype html|<html)/i.test(body.toString("utf8", 0, 512))),
          });
          check.passed = res.status === 200 && !check.htmlInsteadOfAsset && check.sha256 === file.sha256;
        } catch (e) { check.error = e.message; }
        return check;
      }));
      report.checks.push(...batch);
    }
  }
  report.passed = report.checks.every((check) => check.passed);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name) => args[args.indexOf(name) + 1];
  for (const name of ["--host", "--gateway", "--cid", "--out"]) {
    if (!args.includes(name) || !option(name) || option(name).startsWith("--"))
      throw new Error("Usage: node site/scripts/verify-hosting.mjs --host URL --gateway URL --cid CID --out REPORT.json");
  }
  const report = await verifyHosting({ host: option("--host"), gateway: option("--gateway"), cid: option("--cid") });
  await writeFile(option("--out"), JSON.stringify(report, null, 2) + "\n");
  console.log(`PvP Pad · ${report.totalFileBytes} file bytes · ${report.cid}`);
  console.log(`Host: ${report.host}\nIPFS gateway: ${report.gateway}`);
  for (const c of report.checks)
    console.log(`${c.passed ? "PASS" : "FAIL"} ${c.origin} ${c.file} HTTP ${c.status ?? "ERROR"} ${c.bytes ?? 0}/${c.expectedBytes} bytes${c.error ? " · " + c.error : ""}`);
  if (!report.passed) process.exitCode = 1;
}
