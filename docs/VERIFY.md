# Verifying sources on robin.etherscan.io

The launch deploys the five manifest contracts from the bytecode built here. After the deployment
handoff provides addresses, verify each with the exact compiler settings from `foundry.toml`:

- Compiler: solc 0.8.26, EVM version cancun, optimizer on (200 runs), via-IR on,
  `bytecode_hash = "none"`, `cbor_metadata = false`.
- Standard JSON input is the easiest route: `forge verify-contract --show-standard-json-input`
  prints it without sending anything.

```
forge verify-contract <address> src/PadToken.sol:PadToken --chain-id 4663 \
  --verifier etherscan --verifier-url https://robin.etherscan.io/api --watch
forge verify-contract <address> src/PadGame.sol:PadGame --chain-id 4663 ...
forge verify-contract <address> src/PvPPad.sol:PvPPad --chain-id 4663 \
  --constructor-args $(cast abi-encode "constructor(address,address,address)" \
     0x5b95a971b4583a5f011e9da082acdd679b870d06 <PadToken> <PadGame>) ...
forge verify-contract <address> src/PadLiquidity.sol:PadLiquidity --chain-id 4663 \
  --constructor-args $(cast abi-encode "constructor(address,address)" \
     0x8366a39cc670b4001a1121b8f6a443a643e40951 <PvPPad>) ...
forge verify-contract <address> src/KingOfThePad.sol:KingOfThePad --chain-id 4663 \
  --constructor-args $(cast abi-encode "constructor(address,address,address)" \
     <PvPPad> <PadLiquidity> 0x5b95a971b4583a5f011e9da082acdd679b870d06) ...
```

`PadHook` is deployed later by `openPad(salt)`; verify it at `PvPPad.hook()` with constructor args
`(poolManager, padLiquidity)`. Clones (tokens and games) are EIP-1167 proxies: the explorer shows
them as proxies of `PadToken` / `PadGame` once the templates are verified.

Verification is the deployer's step; this repository never broadcasts or calls RPCs.

V2 verification checks
----------------------

Run `forge build`, `forge fmt --check` and `python3 tools/validate_manifest.py` locally before handing
off artifacts. The validator checks the exact original deployment order and constructor arguments,
static lowercase addresses, compiler pin, metadata settings, link references, runtime/initcode sizes
and the same forbidden-opcode scan as the protected deployment floor. No application requires an
external contract to exist during its constructor. The supplied PoolManager address is inherited
from the pinned base; this job has not attested its target-chain code.

There is **no genesis token or game clone at deployment** in v2. Verify the five applications and
confirm the initial token template has zero supply and empty name/symbol. The existing `openPad(salt)`
action subsequently creates both the hook and genesis clones. Do not expect a token constructor name,
symbol or token allocation in `launch.json`. No website, deployment transaction or chain address
for this fresh launch is produced by this job.

Use [Robinhood Etherscan](https://robin.etherscan.io) to submit the standard JSON for each confirmed
application address after the authorized deployment handoff. The command examples above are for
the deployer's later verification step; they were not executed here. Retain the exact compiler
version, optimization, Cancun and metadata settings when exporting JSON. Token/game clones use the
verified templates; the PadHook constructor arguments are the inherited manager and the confirmed
PadLiquidity address. Mine the hook salt anew using the final `hookInitCodeHash()` as described in
the README; salts or addresses from the base launch are not reusable assumptions.
