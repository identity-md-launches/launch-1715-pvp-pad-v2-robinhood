import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { requireTool } from "./tools.mjs";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

export async function inspectExport() {
  const dist = resolve(root, "dist");
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      assert.ok(!entry.isSymbolicLink(), `Symlink in export: ${path}`);
      if (entry.isDirectory()) await walk(path);
      else {
        const data = await readFile(path);
        files.push({ file: relative(dist, path), bytes: data.length, sha256: sha256(data) });
      }
    }
  }
  await walk(dist);
  files.sort((a, b) => a.file.localeCompare(b.file));
  const names = new Set(files.map((f) => f.file));
  assert.ok(!files.some((f) => /(^|\/)(node_modules|\.cache)\//.test(f.file)));
  assert.ok(!files.some((f) => /\.(map|tgz|zip)$/.test(f.file)));
  assert.ok(!files.some((f) => /^vendor\/.*\.js$/.test(f.file)), "Vendor JS must not be published");

  const ts = requireTool("typescript");
  const bundles = [];
  for (const file of ["app.js", "salt-worker.js"]) {
    const source = await readFile(resolve(dist, file), "utf8");
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
    assert.equal(ast.parseDiagnostics.length, 0, `${file} must parse`);
    let imports = 0;
    function visit(node) {
      if (ts.isImportDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier)) imports++;
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          node.expression.getText(ast) === "importScripts")) imports++;
      ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.equal(imports, 0, `${file} must be self-contained, including dynamic imports`);
    assert.ok(!/vendor\/[^"'\s]+\.js/.test(source), `${file} still references vendor JS`);
    assert.deepEqual(await readFile(resolve(root, "site", file)), Buffer.from(source));
    bundles.push({ file, runtimeImports: imports });
  }
  for (const file of ["config.json", "abi.json", "verification.json", "index.html", "style.css"]) {
    assert.deepEqual(await readFile(resolve(dist, file)), await readFile(resolve(root, "site", file)), `${file} copy differs`);
  }
  for (const file of ["index.html", "style.css"]) {
    const source = await readFile(resolve(dist, file), "utf8");
    const references = file.endsWith("html")
      ? [...source.matchAll(/(?:src|href)="([^"#]+)"|property="og:image"\s+content="([^"]+)"/g)].map((m) => m[1] || m[2])
      : [...source.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1]);
    for (const ref of references) {
      if (/^https?:/.test(ref) && file.endsWith("html")) continue; // external navigation links
      assert.ok(ref.startsWith("./"), `${file}: non-relative runtime asset ${ref}`);
      assert.ok(names.has(ref.slice(2)), `${file}: missing ${ref}`);
    }
  }
  for (const file of ["salt-worker.js", "config.json", "abi.json", "verification.json",
    "assets/wallet-coinbase.svg", "assets/wallet-metamask.svg", "assets/wallet-phantom.svg", "assets/wallet-rabby.svg"])
    assert.ok(names.has(file), `Missing runtime asset ${file}`);
  for (const entry of await readdir(resolve(root, "site/vendor"))) {
    if (/\.(txt|md)$/i.test(entry))
      assert.deepEqual(await readFile(resolve(dist, "vendor", entry)), await readFile(resolve(root, "site/vendor", entry)));
  }
  return { label: "pvp-pad", fileCount: files.length, totalFileBytes: files.reduce((n, f) => n + f.bytes, 0), bundles, files };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await inspectExport();
  const out = process.argv.indexOf("--out");
  if (out !== -1) await writeFile(process.argv[out + 1], JSON.stringify(report, null, 2) + "\n");
  console.log(`PASS ${report.fileCount} export files, ${report.totalFileBytes} bytes; both JS entry points have zero runtime imports.`);
}
