# PvP Pad v2

Launchpad on Robinhood Chain (chain id 4663) where every launch is a fast Spireth dice game, all
payments in ETH. Contracts only: this deployment mints **no token**. Every token, including the
genesis "Pepes Value Pepes" (PVP), is created later by the pad itself as an EIP-1167 clone.
Based on `identity-md-launches/launch-1643-dontbuythistoken` at
`2ed30a2f81876c537e98f792e7239012e3e64311`; this is a fresh deployment, not an upgrade.

> **Legal review before public launch.** This is a game of chance with real ETH stakes, an auction
> and token issuance. Get a legal review for the jurisdictions you operate in before opening the pad
> or publishing a site. Nothing here is legal advice. Tests passing is not a security audit: see
> `docs/AUDIT.md`.

## Contracts (deploy order)

| # | Contract | Constructor args | Role |
|---|----------|------------------|------|
| 0 | `PadToken` | none | ERC-20 template, cloned per launch (1e9 supply, 18 decimals, locked until graduation) |
| 1 | `PadGame` | none | Template: bonding curve + Spireth game, cloned per launch |
| 2 | `PvPPad` | `$owner`, `$contract:PadToken`, `$contract:PadGame` | Registry, clone factory, carry pot, open switch, bounded upkeep |
| 3 | `PadLiquidity` | `0x8366a39cc670b4001a1121b8f6a443a643e40951` (v4 PoolManager), `$contract:PvPPad` | Graduation into Uniswap v4, LP owned forever, fee collection for the king, PvP burn |
| 4 | `KingOfThePad` | `$contract:PvPPad`, `$contract:PadLiquidity`, `0x5b95a971b4583a5f011e9da082acdd679b870d06` (dev) | Crown auction; its constructor binds everything through `PvPPad.startGenesis()`; genesis is created at open |

`$owner` and dev are both `0x5b95a971b4583a5f011e9da082acdd679b870d06` (immutable). Nothing is owned
by the factory or by IMD; `PvPPad.owner()` and `KingOfThePad.owner()` both return the dev.

`PadHook` is **not** in the manifest. `openPad(salt)` CREATE2-deploys it from `PadLiquidity`.

Constructors are nonpayable, call only earlier manifest contracts (one-shot bindings), and never
ArbSys or the PoolManager. The five contracts must deploy atomically in one transaction. No token,
game clone, hook or pool is created in that transaction; the token template has zero supply and
empty name/symbol. `openPad(salt)` later creates the hook and the genesis launch. This corrects a
contradiction in the base implementation, whose king constructor minted genesis despite its README.
Deploy order and constructor arguments are unchanged. The deployment target is <13M gas, with a
hard cap of 16,777,216; every application runtime must be <24,576 bytes. The offline manifest
validator and deployment tests check the artifacts and constructor rehearsal (see test report).
The local raw-CREATE2 rehearsal measured 11,672,882 gas including calldata/intrinsic costs; later
opening with hook and genesis measured 788,443 gas, or 12,461,325 combined. The authorized launch
pipeline still checks its factory-specific overhead and final transaction gas.

## After launch (owner's checklist)

1. **Mine the salt.** Read `PadLiquidity.hookInitCodeHash()` and the `PadLiquidity` address. Find a
   `salt` such that `address(uint160(uint256(keccak256(0xff ++ padLiquidity ++ salt ++ initCodeHash))))`
   has `address & 0x3FFF == 0x2000` (exactly the v4 `BEFORE_INITIALIZE_FLAG`). `PadLiquidity.hookAddressFor(salt)`
   predicts it on chain. About 1 in 16,384 salts match; the test helper `mineSalt()` in
   `test/Base.t.sol` shows the loop.
2. **Open the pad.** Call `PvPPad.openPad(salt)` from the owner. Anyone may call it 30 days after
   deployment (`openDeadline()`). It can only succeed once, cannot be undone and grants nothing else.
   Until then no game exists; `launch` and `takeCrown` revert. Games also gate `enter` and `roll` on the open switch.
3. **Watch the genesis game.** Its first paid entry starts signup. Anyone can advance its draw after
   signup (`draw(32)`, game `poke()` or pad upkeep). If play ends without a single roll it is marked failed; call `PvPPad.restartGenesis()` (or just `launch(...)`, which does
   the same while the genesis is failed) to relaunch PvP. Nothing else is needed.
4. There are no other settings. Fees, timings and sizes are constants (below).

## Rules implemented

- **Open switch.** `openPad(salt)` by owner, or anyone after 30 days; once; deploys `PadHook` and
  reverts with `hook flags` unless the address has exactly the beforeInitialize flag.
- **Launch.** `launch(name<=32, ticker<=10, imageURL<=200)` by anyone after PvP graduates. 1e9
  supply minted to the game clone; transfers locked until graduation except by the game and
  `PadLiquidity`; unlocked inside the graduation transaction. While the current genesis is failed,
  `launch()` relaunches PvP instead (same as `restartGenesis()`) and returns the new genesis id.
- **Curve.** Virtual constant product, 1 ETH and 1e9 tokens virtual, 800M on the curve (sold out at
  exactly 4 ETH), 200M reserved for LP. Only rolls buy, no sells. Once sold out, the roll's 90% goes
  to the pot.
- **Seat raffle.** `enter()` costs **exactly 0.001 ETH**, once per address per game, with no entry cap.
  Contract wallets are welcome; there are no EOA or `tx.origin` checks. First entry starts a 10-minute
  signup. Every entry fee, including genesis fees and losing entries, goes immediately to
  `PadLiquidity.fundBurn`; **no refunds**, even if genesis fails. The bucket waits for PvP graduation.
  After signup, the first `draw(n)` or upkeep commits its ArbSys L2 block. At commit+4 or later it
  latches `keccak256(abi.encode(game, arbHash(commit+1), arbHash(commit+2), arbHash(commit+3)))`.
  If commit+1 is more than 256 L2 blocks old before seed capture, the next call recommits. A latched
  seed never changes, even if later chunks are delayed. Sparse Fisher–Yates with rejection sampling
  draws `min(entries, 200)` unique seats uniformly, including random seat order when everyone fits.
  `draw(n)` performs at most 32 random trials; upkeep also performs at most 32 per game. Keep calling
  until `drawComplete()`. Caller, entry timing and chunk size are not seed inputs. See audit for
  sequencer influence and keeper withholding risks; this is **not VRF randomness**.
- **Game.** Drawn seats are Imp records, not NFTs. Rolls revert until the entire draw completes.
  Play starts at draw completion and ends at the bell, all dead, or 50 minutes after play start. Roll = 0.002 ETH,
  60 s cooldown: 90% curve buy (tokens to roller), 8% pot, 2% burn bucket (genesis: pot). Dice:
  `rand % 8` maps to -4..-1 / +1..+4. Height clamps at ±50; reaching it rings the bell and ends the
  game. Death: 10 minutes without a roll (from play start if never rolled).
- **RNG.** Each roll stores its commit L2 block from ArbSys (0x64) `arbBlockNumber()`. Outcome =
  `keccak(game, imp, nonce, arbBlockHash(commit+1), (commit+2), (commit+3))`. Anyone resolves; every
  roll and poke resolves up to 8 oldest pending rolls; an Imp's roll resolves its previous
  one. Unresolved past the 256-block window: |height| moves 4 toward 0.
- **End.** Living Imps ranked by |height| desc, earlier `heightReachedAt` wins ties; top
  `ceil(living/2)` split 80% of the pot with triangular weights (`paid - rank`); bell ringer 20% (no
  bell: all to ranks; none living: carry pot for the next launch). Finalizer gets 0.5% of the pot,
  max 0.005 ETH, paid from roll income only. ETH the pad put into the pot (carry pot, king share;
  `fundedPot`) is paid out only when at least 5 Imps are living at the end and at most 3x the
  roll-earned pot (`rollPot()`); the rest returns to the carry pot. `fundPot` is pad-only.
- **Graduation.** Permissionless after finalization: curve ETH + remaining tokens into a v4 pool
  (native ETH / token, fee 10000, tickSpacing 200, hooks = PadHook) initialized at the final curve
  price, full range (ticks ±887200), owned forever by `PadLiquidity`; excess tokens to `0x…dEaD`.
  No ETH raised: all tokens burned, launch marked failed.
- **Genesis.** Launch #1 "Pepes Value Pepes" (PVP) is created by the pad at `openPad` and waits for
  its first paid entry. Its 2% burn share goes to its own pot. Other launches, the king and the burn wait
  until PvP graduates. If genesis fails (ended with no roll: token burned, `failed()`), anyone
  relaunches PvP with `restartGenesis()`; `genesisId()` names the current genesis and the burn buys
  the token of the genesis that graduated.
- **Burn.** Burn-bucket ETH waits in `PadLiquidity`; after PvP graduates anyone or upkeep buys PVP
  (max 0.02 ETH per buy, one buy per 10 minutes) straight to `0x…dEaD`. Every protocol swap (burn
  buy, fee sale) stops at a 0.5% sqrt-price move from spot (about 1% in price); the unfilled part
  stays in the bucket or the token stash. This bounds impact per call, not total MEV exposure.
- **King.** `takeCrown()` payable: first bid ≥ 0.01 ETH, then ≥ 110% of the current bid and only
  after the king held 1 hour. Old king refunded in full at once (push, claimable on failure). Extra
  (new − old; the whole first bid): 50% to pots of live games with ≥ 5 entries during signup/drawing or ≥ 5 Imps after drawing, among the last 10
  launches, weighted by roll-earned pot (none: carry pot), 25% burn bucket, 25% dev. That share is
  funded ETH inside the game and follows the funded-pot rule above. `takeCrown` runs upkeep with the
  bidder as beneficiary of any finalizer fee. Before replacing an existing king, it calls
  `distribute(8)` while the outgoing king is still the beneficiary; the first crown skips this step.
  Each pool collection has a 400k gas cap and independent failure handling; the entire pre-crown
  call has a 4.5M gas cap. A failed pool cannot block the bid or roll back healthy pool collections.
  `distribute(n)`: collect LP
  fees from the next min(n, 8, poolCount) pools round-robin, sell the token side (chunk-capped), send all to the king
  (escrowed while there is no king).
- **Upkeep.** Entry, roll, poke, finalize, graduation, launch and crown actions run bounded pad upkeep:
  resolve ≤8 rolls and advance the draw/lifecycle on the latest game and one older game round-robin,
  `distribute(2)`, and one burn chunk. External lifecycle/fee/burn failures are caught; direct calls
  surface failures for retry. `PadGame.poke()` and `PvPPad.upkeep()` are public. `draw(n)` advances
  only that game's raffle, with no nested pad upkeep.
- **Safety.** ETH pushes are gas-capped (30k) with claimable fallback (`claim()` on each contract);
  reentrancy guards; checks-effects-interactions; bounded loops (200 Imps, 8 rolls, 10 games, n
  pools); internal accounting; `transferFrom` only spends the caller's allowance; v4 only via
  `PoolManager.unlock` with the contract's own funds.

## Named constants (choices the brief left open)

| Constant | Value | Where |
|----------|-------|-------|
| `MAX_DISTRIBUTE_POOLS` / `COLLECT_GAS` / `CROWN_DISTRIBUTE_GAS` | 8 pools / 400,000 per pool / 4,500,000 per pre-crown batch | PadLiquidity / KingOfThePad |
| `ENTRY_PRICE` / `DRAW_BATCH` / `MAX_PLAY` | 0.001 ETH / 32 trials per call / 50 minutes from completed draw | PadGame |
| `SELL_CHUNK` | 2,000,000 tokens per fee collection | PadLiquidity |
| `PadLib.PUSH_GAS` | 30,000 gas per ETH push | PadLib |
| `KING_MAX_GAMES` / `KING_MIN_IMPS` | 10 / 5 | PvPPad |
| `FUNDED_MIN_LIVING` / `FUNDED_RELEASE_MULTIPLE` | 5 living Imps / 3x the roll-earned pot to pay funded ETH out | PadGame |
| `IMPACT_BPS` | 50 (0.5% sqrt price, about 1% price) max move per protocol swap | PadLiquidity |
| `LIQUIDITY_MARGIN_PPM` | 1 ppm liquidity haircut so the manager never asks for more than held | PadLiquidity |
| Wall-clock timing | `block.timestamp` for minutes/hours/days; ArbSys block numbers for the RNG commit window | PadGame |
| Genesis name / ticker | "Pepes Value Pepes" / "PVP" | PvPPad |

The launch form fields "DONTBUYTHISTOKEN / DBTT" are not used: the brief's final decision is that this
deployment mints no token and genesis is PVP. If a launch named DONTBUYTHISTOKEN is wanted, anyone can
create it with `launch("DONTBUYTHISTOKEN", "DBTT", url)` after PvP graduates.

## Build and test

```
forge build
FOUNDRY_FUZZ_SEED=0x0d0a7fe17c0c810a05ce9611052247886ae0cb3e56fd81212056fc4f6cdd7542 forge test
forge fmt --check
python3 tools/validate_manifest.py
```

solc 0.8.26, via-IR, optimizer 200 runs, `bytecode_hash = "none"`, `cbor_metadata = false`.
forge-std, Uniswap v4-core v4.0.0 and its required Solmate file are vendored as plain files under
`lib/` (exact commits and licenses in `lib/DEPENDENCIES.md`). Tests compile and deploy the real
PoolManager locally. `test/RealV4.sol` only supplies callback routing; it does not replace pool math.
MockArbSys is etched at 0x64 to model L2 block windows. No fork, RPC, environment-reading test,
FFI, filesystem permission or external package installation is required. The base fuzz seed remains
pinned in foundry.toml; the command above overrides it with this assignment's verification seed.
Never deploy, broadcast or call RPCs from this assignment; the launch pipeline deploys the bytecode.

## Views, keepers and economic assumptions

`entryCount()`, `entryOf(wallet)` and `getEntrants(offset, limit)` expose the fixed entry list; pages
are capped at 200. `impOf(wallet)` is the **1-based** seat (zero if pending or unselected);
`myEntry()` returns the caller's 1-based entry, seat and draw-complete flag. `drawProgress()` returns
entry count, seats drawn, target, commit block, seeded and complete flags. Public getters expose
`drawSeed`, `drawNonce`, `drawCommitted`, `drawSeeded`, `drawComplete`, `firstEntryAt`, `playStartedAt`.
`signupEnd()`, `playStart()`, `hardEnd()` and `endTime()` are separate clocks. A not-yet-started play
clock returns zero. `status()` preserves the base codes 0 waiting, 1 signup, 2 play, 3 ended,
4 finalized, 5 graduated, 6 failed, and adds **7 drawing**. `Entered`, `DrawCommitted`, `DrawSeedReady`,
`Seated`, `DrawProgress` and `PlayStarted` provide indexer events (event entry/seat indexes are 0-based).

Operators should keep draw/roll resolution moving inside the **L2 256-block window**, which is not
256 seconds or 256 L1 blocks. Anyone can do this. There is no exclusive keeper, subscription, key or
owner setting. A stopped keeper delays the draw without aging the Imps; expired unseeded draws
recommit. Monitor failed pool collections, pending rolls, unfinished graduations and claimable ETH.
For >8 pools, pre-crown collection only covers the next eight; larger backlogs and failed pools are
not guaranteed to belong to the outgoing king after the crown changes.

The raffle limits speed advantage, not multi-wallet ownership. With H honest and B bot entries,
expected bot seats (when H+B>200) are `200*B/(H+B)`, and the bot pays `0.001*B ETH` irreversibly plus
gas. Majority probability follows a hypergeometric distribution, not a guarantee. See audit #22
for concrete costs, including repeated failed-genesis grief. Entry fees do not fund prize pots.

The PoolManager address is inherited unchanged from the pinned base/manifest; it has not been
queried in this job. The deployer must confirm chain 4663 and the intended live manager implementation
before public opening. Local real-core tests do not attest deployed chain bytecode. Legal review
and a separate independent adversarial review remain pre-launch operational responsibilities.

Docs: `docs/AUDIT.md` (trust model, findings, limits), `docs/TEST-REPORT.md`, `docs/VERIFY.md`
(source verification on robin.etherscan.io).
