import { requireTool, toolsDir } from "./tools.mjs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
const ts = requireTool("typescript");
const src = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const options = {
  noEmit: true,
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  skipLibCheck: true,
  baseUrl: toolsDir,
  paths: { "*": ["node_modules/*"] },
  allowImportingTsExtensions: true,
};
const program = ts.createProgram(
  readdirSync(src)
    .filter((x) => x.endsWith(".ts"))
    .map((x) => resolve(src, x)),
  options,
);
const errors = ts.getPreEmitDiagnostics(program);
if (errors.length) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: (f) => f,
      getCurrentDirectory: () => src,
      getNewLine: () => "\n",
    }),
  );
  process.exit(1);
}
console.log("Typecheck passed (strict, noEmit)");
