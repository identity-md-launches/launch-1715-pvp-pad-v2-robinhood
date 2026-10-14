import { readFile, writeFile } from "node:fs/promises";
import { requireTool } from "./tools.mjs";
const { keccak256, toUtf8Bytes } = requireTool("ethers");
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
let deployment;
try {
  deployment = JSON.parse(await readFile(".imd/reads/deployment.json", "utf8"));
} catch {
  const pinned = JSON.parse(await readFile("site/verification.json", "utf8"));
  deployment = {
    sourceCommit: pinned.sourceCommit,
    contracts: Object.entries(pinned.contracts).map(([name, v]) => ({
      name,
      ...v,
    })),
  };
}
const abis = {},
  verification = { sourceCommit: deployment.sourceCommit, contracts: {} };
for (const d of deployment.contracts) {
  const artifact = JSON.parse(
    await readFile(`out/${d.name}.sol/${d.name}.json`, "utf8"),
  );
  const hash = keccak256(
    toUtf8Bytes(JSON.stringify(canonical(artifact.abi))),
  ).slice(2);
  if (hash !== d.abiHash)
    throw new Error(`${d.name}: ABI mismatch ${hash} != ${d.abiHash}`);
  abis[d.name] = artifact.abi;
  let code = artifact.deployedBytecode.object;
  const masks = Object.values(
    artifact.deployedBytecode.immutableReferences || {},
  ).flat();
  for (const m of masks)
    code =
      code.slice(0, 2 + m.start * 2) +
      "0".repeat(m.length * 2) +
      code.slice(2 + (m.start + m.length) * 2);
  verification.contracts[d.name] = {
    address: d.address,
    abiHash: hash,
    codeHash: keccak256(code),
    masks,
  };
  console.log(`${d.name}: canonical ABI matches ${hash}`);
}
await writeFile("site/abi.json", JSON.stringify(abis));
await writeFile("site/verification.json", JSON.stringify(verification));
