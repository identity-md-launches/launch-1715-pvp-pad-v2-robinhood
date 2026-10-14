import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toolsDir, requireTool } from "./tools.mjs";
import { inspectExport } from "./check-export.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const site = resolve(root, "site");
const { build } = requireTool("esbuild");
const bundledEthers = {
  name: "local-ethers",
  setup(b) {
    b.onResolve({ filter: /^ethers$/ }, () => ({
      path: resolve(site, "vendor/ethers.js"),
    }));
  },
};
await mkdir(resolve(site, "vendor"), { recursive: true });
const ethersBuild = await build({
  metafile: true,
  stdin: { contents: 'export * from "ethers";', resolveDir: toolsDir },
  bundle: true,
  format: "esm",
  minify: true,
  target: "es2022",
  outfile: resolve(site, "vendor/ethers.js"),
  legalComments: "eof",
});
const coinbaseBuild = await build({
  metafile: true,
  entryPoints: [resolve(site, "src/coinbase.ts")],
  outfile: resolve(site, "vendor/coinbase.js"),
  bundle: true,
  format: "esm",
  minify: true,
  target: "es2022",
  legalComments: "eof",
  nodePaths: [resolve(toolsDir, "node_modules")],
});
// Build vendors first, then inline them into each independent entry point.
// No splitting: the deferred Coinbase import must not emit a runtime chunk.
const appBuild = await build({
  entryPoints: [
    resolve(site, "src/app.ts"),
    resolve(site, "src/salt-worker.ts"),
  ],
  outdir: site,
  bundle: true,
  splitting: false,
  metafile: true,
  format: "esm",
  minify: true,
  target: "es2022",
  plugins: [bundledEthers],
  legalComments: "eof",
  nodePaths: [resolve(toolsDir, "node_modules")],
});
for (const [file, output] of Object.entries(appBuild.metafile.outputs)) {
  if (output.imports.length) {
    throw new Error(`${file} has runtime imports: ${JSON.stringify(output.imports)}`);
  }
}
for (const [name, file] of [
  ["geist", "geist-latin-wght-normal.woff2"],
  ["geist-mono", "geist-mono-latin-wght-normal.woff2"],
]) {
  await cp(
    resolve(
      toolsDir,
      `node_modules/@fontsource-variable/${name}/files/${file}`,
    ),
    resolve(site, "fonts", file),
  );
  await cp(
    resolve(toolsDir, `node_modules/@fontsource-variable/${name}/LICENSE`),
    resolve(site, "fonts", `${name}-OFL.txt`),
  );
}
await cp(
  resolve(toolsDir, "node_modules/ethers/LICENSE.md"),
  resolve(site, "vendor/ethers-LICENSE.md"),
);
await cp(
  resolve(toolsDir, "node_modules/@coinbase/wallet-sdk/LICENSE"),
  resolve(site, "vendor/coinbase-LICENSE.txt"),
);
const runtimePackages = new Map();
for (const built of [ethersBuild, coinbaseBuild]) {
  for (const input of Object.keys(built.metafile.inputs)) {
    const path = resolve(input);
    const match = path.match(/^(.*node_modules\/(?:@[^/]+\/[^/]+|[^/]+))\//);
    if (!match) continue;
    const packageRoot = match[1];
    const meta = JSON.parse(
      await readFile(resolve(packageRoot, "package.json"), "utf8"),
    );
    if (runtimePackages.has(meta.name)) continue;
    const notices = [];
    for (const filename of (await readdir(packageRoot)).filter((f) =>
      /^(licen[sc]e|copying|notice)(\.|$)/i.test(f),
    )) {
      try {
        notices.push(await readFile(resolve(packageRoot, filename), "utf8"));
      } catch {}
    }
    runtimePackages.set(
      meta.name,
      `${meta.name} ${meta.version} (${meta.license || "see bundled notice"})\n${notices.join("\n")}`,
    );
  }
}
await writeFile(
  resolve(site, "vendor/THIRD-PARTY-NOTICES.txt"),
  [...runtimePackages.values()].join("\n\n" + "=".repeat(72) + "\n\n"),
);
await rm(resolve(root, "dist"), { recursive: true, force: true });
await mkdir(resolve(root, "dist"));
for (const f of [
  "index.html",
  "app.js",
  "salt-worker.js",
  "style.css",
  "config.json",
  "abi.json",
  "verification.json",
  "fonts",
  "assets",
])
  await cp(resolve(site, f), resolve(root, "dist", f), { recursive: true });
// Retain every vendor notice, but publish no separately loadable vendor JS.
await mkdir(resolve(root, "dist/vendor"));
for (const file of await readdir(resolve(site, "vendor"))) {
  if (/\.(txt|md)$/i.test(file))
    await cp(resolve(site, "vendor", file), resolve(root, "dist/vendor", file));
}
const audit = await inspectExport();
console.log(`Production export: dist/ (${audit.fileCount} files, ${audit.totalFileBytes} bytes; self-contained app.js and salt-worker.js)`);
