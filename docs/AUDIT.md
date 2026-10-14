# PvP Pad v2: self-review and trust model

This is the builder's own review, not an independent audit. Work holding other people's funds
needs a separate adversarial review before release.

## Privileges

| Who | Power | Notes |
|-----|-------|-------|
| Owner / dev (`0x5b95…0d06`) | `openPad(salt)` before day 30; receives 25% of king extras | Cannot pause, upgrade, sweep, mint or change fees. After 30 days anyone can open. |
| Anyone | enter, draw, roll, poke, finalize, graduate, launch (after PvP), restartGenesis (only after a failed PvP), takeCrown, distribute, burnChunk, claim | All permissionless, all bounded. |
| PvPPad (contract) | only caller of `PadGame.fundPot` | Carry pot at creation and the king's games share; nobody can donate to a pot. |
| Factory / IMD | none | No `msg.sender` / `tx.origin` ownership anywhere. |
| PadLiquidity | Only sender allowed by `PadHook.beforeInitialize`; may unlock tokens; owns all LP forever | No withdrawal path for LP exists. |

## Findings and accepted risks

1. **On-chain randomness.** Dice use ArbSys block hashes of the three L2 blocks after the commit
   block. On Arbitrum-stack chains the sequencer orders transactions and produces blocks, so a
   colluding sequencer could in principle bias outcomes. There is no player secret, by design, so
   players cannot grief by withholding. The 60 s cooldown plus 8-roll resolution batch keeps the
   pending queue short; past the 256-block window a roll expires and moves the Imp 4 toward 0.
   Accepted per brief; documented here.
2. **Finalization gas.** `_finalize` packs one sort key per living Imp (|height|, commit block, roll
   id, index) and heap-sorts them in memory, then pushes up to 100 payments at 30k gas each. The
   200 living Imps in reverse rank order with EOA recipients measured 3,780,025 gas
   (`test_finalizeWith200LivingImpsStaysUnderFiveMillionGas`). The first version used an insertion
   sort that re-read storage in the comparator and cost 21.8M gas in that case, which upkeep could
   never afford (revision finding). A finalize that still runs out of gas inside upkeep is simply
   skipped there and `finalize()` can be called directly with more gas.
3. **Upkeep try/catch.** Graduation, distribution and burns run inside try/catch during upkeep so a
   PoolManager revert never blocks entries or rolls. A persistently reverting graduation would leave a
   game finalized but ungraduated; `graduate()` can still be called directly and will surface the
   revert reason.
4. **Genesis failure remains recoverable, with paid griefing.** The first entry costs 0.001 ETH
   and starts signup. A failed genesis now requires the raffle to finish and then everyone to die
   without a roll. Anyone may restart it through `restartGenesis()` or `launch()`. The bot loses its
   entry fee permanently to the burn bucket each round, plus gas. Three failed one-entry rounds cost
   exactly 0.003 ETH in the regression test; the bucket retains all fees until a PvP graduates.
   New entries in future rounds cost again. A bot cannot close honest signup by being fast because
   the list has no cap. A bot also cannot force failure if an honest seated wallet pays for a roll.
5. **Liquidity rounding.** `PadLiquidity` computes full-range liquidity with its own mulDiv and takes
   a 1 ppm haircut so the real PoolManager (which rounds amounts up) never asks for more ETH than
   sent. Any ETH dust left goes to the burn bucket; token excess goes to dEaD.
6. **Real v4 exercised offline.** All PoolManager-dependent tests now compile and deploy unmodified
   Uniswap v4-core v4.0.0 (`e50237c43811bd9b526eff40f26772152a42daba`); the old behavioral mock is
   removed. Tests use actual liquidity, swap, donation, fee-growth, delta settlement and storage
   layout logic, including sold-out graduation after 2,400 actual rolls and a one-roll small raise.
   Hook salt is mined locally, foreign initialization goes through the real manager (which wraps
   hook errors), and `extsload` is checked against upstream StateLibrary. A test router only pays
   deltas and takes proceeds. MockArbSys remains intentional. This does not verify the implementation
   deployed at the inherited chain address, nor sequencer behavior; no RPC/fork was used.
7. **Hook address.** `openPad` reverts unless `address & 0x3FFF == 0x2000`. The v4 PoolManager
   validates the same mask at `initialize`. Only PadLiquidity can initialize pools with the hook.
8. **Price-impact cap on protocol swaps.** Burn buys (max 0.02 ETH per 10 minutes) and fee sales
   (max 2M tokens per collection) run inside upkeep, which anyone can trigger in the same transaction
   as their own swaps, so a self-sandwich needs no mempool race. Each protocol swap now carries a
   sqrt-price limit `IMPACT_BPS` = 0.5% from the pre-swap spot (about 1% in price, read from the
   PoolManager's slot0 through `extsload`); v4 fills only up to the limit and the unfilled ETH or
   tokens stay for the next chunk. An attacker who pushes the price first gains at most about 1% of
   the position they hold through the chunk and pays the 1% pool fee twice on it, and the tested single-pool round trip loses money (`test_sandwichOnBurnChunkDoesNotPay`).
   This is a tested scenario, not a proof against all MEV strategies or external venues. The cost is slower burns in a thin PvP pool:
   the pool is as deep as the genesis raise, and a chunk fills only what a 1% move allows
   (`test_burnChunkStopsAtOnePercentPriceMoveAndKeepsTheRest`). The limit is relative to the current
   spot, so it bounds damage per chunk rather than detecting manipulation; a thin PvP pool remains a
   known weakness of the design.
9. **King accounting.** The king contract never holds a settled bid: the whole first bid is split,
   and each later bid refunds the previous king and splits the extra. The balance therefore equals
   the sum of claimables. Tested.
10. **Token lock bypass.** While locked, only `msg.sender == game || liquidity` may move tokens.
    Approvals do not bypass the lock (tested). The lock is per-token and only PadLiquidity can
    unlock it.
11. **Reentrancy.** Every entry point that moves ETH has a guard. Upkeep callbacks into a game that
    is already locked return immediately. Pushes have 30k gas, insufficient to re-enter any
    state-changing function meaningfully; failures become claimable.
12. **Timestamps.** Minutes/hours/days use `block.timestamp` (sequencer-controlled within protocol
    bounds). Block numbers from ArbSys are used only for the RNG window. The brief's "timing uses
    ArbSys" was read as the RNG commit window, because L2 block cadence is not a reliable clock.

13. **Funded pots (carry pot, king share) are escrowed inside the game.** `PadGame.fundedPot`
    tracks ETH the pad put into a pot (carry at creation, king's 50% games share) apart from what
    rolls earned. At the end it is paid out only if at least `FUNDED_MIN_LIVING` (5) Imps are living,
    and never more than `FUNDED_RELEASE_MULTIPLE` (3) times the roll-earned pot; whatever is not
    released returns to the carry pot (`FundedReturned`) and reaches the next launch. The finalizer
    fee (0.5%, max 0.005 ETH) is paid from roll income only, so no fee can be farmed from funded
    ETH. The king's weighting uses the roll-earned pot and `fundPot` is pad-only, so a pot cannot be
    steered by donations. Why the 3x cap: a sybil with five wallets who rolls X ETH gets back its roll
    pot (8%), at most 3x that from funded ETH (24%) and at most about half of the curve ETH by dumping
    its tokens into the graduated pool (45%), about 77% of X: capturing funded ETH costs more than it
    returns. Five paid entries now make a launch "live" during signup/drawing, and five seats do so after
    drawing (no EOA check); that share is still capped by the game's own roll income and otherwise
    returns to the carry. Revision findings 66c81d1d and 5832a371.
14. **Upkeep callers and fees.** `KingOfThePad.takeCrown` runs `pad.upkeepFor(msg.sender)`, so a
    finalizer fee paid by that upkeep goes to the bidder, not to the king contract (which cannot
    claim). `upkeepFor` accepts games and the king contract only. Revision finding f7386928.
15. **Roll after the bell.** `roll()` resolves the Imp's previous roll first; if that resolution rings
    the bell the call now reverts `game over` instead of recording a roll after the end.
16. **Dead Imps and the bell.** A roll resolved after its Imp has died (quiet chain, no L2 blocks)
    still moves the height but cannot ring the bell or earn the 20% share.
17. **Tie-break.** `heightReachedAt` is the commit L2 block of the roll that reached the height, with
    the roll index as a second key, so ties follow commit order, not who resolved first.
18. **Receive guard.** `PadLiquidity.receive()` accepts ETH only from the PoolManager; all other ETH
    enters through `fundBurn` or `graduate` and is credited to a bucket.
19. **One-shot binders.** `bindLiquidity`, `startGenesis` and `bindKing` accept the first caller.
    They are safe only because the launch deploys the five contracts in one transaction from the
    factory; a rehearsal in separate transactions must not leave a window between them. Trust
    assumption of the deployment policy, documented, not changed.
20. **upkeepStep lock.** `upkeepStep` now sets the game's reentrancy lock while it finalizes or
    graduates, so the protection no longer rests on the 30k push gas cap alone.
21. **Outgoing king fees fixed.** After validating a bid and while the crown reentrancy guard is
    held, `takeCrown()` calls `distribute(8)` before changing `king`; the first crown skips this
    pre-step. `distribute` clamps all requests to eight pools and uses round-robin traversal.
    Each pool is an external self-call limited to 400,000 gas, caught independently, with a
    `PoolCollectionFailed` event on failure. Healthy pools still pay the outgoing king; rejecting
    receivers get liquidity-contract claimables. The pre-crown batch itself is capped at 4.5M gas
    and caught. Tests inject pool and distributor reverts and verify payment-before-crown ordering.
    More than eight pools, failed pools, and fees earned later during upkeep may pay a future king;
    the design does not checkpoint an unbounded historical entitlement.
22. **Paid Sybil entry remains possible; speed no longer buys seats.** No EOA checks, one entry per
    wallet, no cap on wallets. Every entry costs 0.001 ETH, including unselected wallets. For H honest
    and B bot entries, let N=H+B and S=min(N,200). Bot seats follow Hypergeometric(N,B,S), with mean
    S*B/N, assuming unbiased future hashes. A bot pays 0.001*B ETH plus transaction/helper-wallet gas.
    Examples with H=200 honest entrants:

    | Bot entries | Entry cost | Expected bot seats (of 200) | Expected share |
    |---:|---:|---:|---:|
    | 200 | 0.200 ETH | 100 | 50% |
    | 201 | 0.201 ETH | 100.249 | >50% in expectation only |
    | 800 | 0.800 ETH | 160 | 80% |
    | 1,800 | 1.800 ETH | 180 | 90% |
    | 3,800 | 3.800 ETH | 190 | 95% |
    | 4,800 | 4.800 ETH | 192 | 96% (5,000 total entries) |

    With H=200, B=240 costs **0.240 ETH plus gas** and gives about **95.073%** probability of
    at least 101 seats. This is computed as
    `sum(comb(B,k)*comb(H,200-k), k=101..200) / comb(H+B,200)`; B=239 is below 95%.
    It assumes exactly 200 honest entries and unbiased hashes, not additional honest demand.
    Expected majority is not a guaranteed majority. If total entries are <=200 everyone gets a
    seat, but randomized seat order removes entry-order preference in the last ranking tie-break.
    When H is small, domination is correspondingly cheap: with no honest entrants 101 bot wallets
    buy all 101 seats for 0.101 ETH. No claim of one human per seat or Sybil resistance is made.
    These fees supplement, rather than replace, the base funded-pot safeguards (#13).
23. **Raffle seed, liveness and bounded gas.** The first post-signup draw/upkeep commits its ArbSys
    block; the seed uses the next three L2 block hashes, available starting at commit+4. The oldest
    hash remains valid through current=commit+257; at commit+258 the unseeded draw recommits.
    No L1 block number/hash, timestamp, prevrandao, caller, entry order or chunk size enters the seed.
    Fisher–Yates selects from the shrinking remaining set with a sparse mapping (no scan over all
    entrants). Rejection sampling avoids modulo bias; each call performs <=32 trials, including
    rejected samples, so the cryptographically negligible rejection case cannot create an
    unbounded loop. The monotonically increasing nonce makes chunk boundaries irrelevant.
    Once seeded, no caller can reset the raffle; a stalled partial draw resumes with the same seed.
    Play and death clocks start only on completion. Statistical tests over 256 different mocked
    future hash triples test both early and late entries; these do not prove unbiased chain hashes.
    Keepers must capture the seed promptly. A sole keeper could withhold an unfavorable seed until
    its hash window expires; a competing public caller can prevent this. Sequencer bias/censorship
    and coordinated keeper withholding remain accepted risks of the requested block-hash mechanism.
24. **Native settlement selected explicitly.** Real v4 allows anyone to `sync(token)` while locked;
    the synced currency is transient transaction state, not scoped to an unlock caller. The base's
    ETH `settle{value: ...}` could revert when preceded by an unrelated token sync in the same
    transaction. `_settleEth` now always calls `sync(address(0))` first. Real-manager tests dirty
    this state before graduation and burn, and verify success and conservation.
25. **No token at deployment.** The base called `_create` in the last constructor and minted genesis,
    contradicting its own contracts-only/no-token description. The five constructors now only deploy
    templates and bind the application contracts. `openPad(salt)` creates the hook and genesis in
    one reversible transaction; failure rolls back the open switch. This satisfies the final
    decision while retaining deploy order, constructor args, ownership, genesis identity and the
    public day-30 opening fallback. No post-deploy configuration call is needed to complete the
    manifest deployment; opening is the existing intentional public-launch action.

## Edges covered by tests and known gaps

Covered: open/salt/expiry/once, hook foreign initialize (direct and through the manager), genesis
gating of launch and king, deploy gas and opcode scan, paid signup window, uniqueness and uncapped entry list, roll preconditions,
split (genesis and non-genesis), curve quotes and sold-out cap, token lock and unlock, RNG
resolution timing, expiry, own-previous-roll resolution, batch of 8, bell, death, all-dead,
50-minute play cap, ranking with ties and triangular weights, bell share, finalizer fee cap,
claimable fallback, ETH conservation, graduation (pool, unlock, burn excess, price), failed
graduation, upkeep-driven finalize/graduate, king bid rules, king split, live-game weighting,
refund claimable, distribute to king and escrow, burn chunk cap and interval, paid failed genesis
restart (via `launch` and `restartGenesis`) through to a graduated second PvP and a burn on its
pool, funded pot returned with fewer than five living, 3x release cap with five living, finalizer
fee from roll income only, `fundPot` pad-only, king share weighted by roll pot, finalizer fee to
the bidder through `takeCrown`, roll after own bell reverts, dead Imp cannot ring, commit-order
tie-break, 200 living Imps finalize gas, burn chunk partial fill at the price limit, self-sandwich
does not pay.

Additional coverage: entry fee amount and burn routing (genesis and later games), no refunds,
contract wallets, paginated entry/seat views, everyone seated at <=200 and exactly 200 at 5,000,
recommit boundaries, chunk independence, delayed draw clocks, king eligibility before/after draw,
statistical fairness, outgoing king fee ordering, pool-failure isolation, real token-side fee sale,
partial burn fills and real slot0 reads. See `docs/TEST-REPORT.md` for measured results.

Known limits: local real-core tests do not attest target-chain deployed code or sequencer entropy.
No VRF or external oracle is added. Immutable LP and burn mechanics retain exposure to market price,
liquidity depth and MEV. Fee collection's gas cap can skip a path with unusually expensive tick
crossings; retries remain permissionless. The application has no upgrade, sweep or operator rescue.
The one-shot binders still require atomic deployment (#19). Statistical fairness is not a formal
proof, and tests passing is not an independent adversarial review.

## Tools run

The final test report records `forge build`, `forge test`, `forge fmt --check`, the offline manifest
validator, fuzz/invariant results and gas measurements. No deployment, broadcast, RPC or fork calls.
Slither/Mythril and an independent security review were not performed in this assignment.
