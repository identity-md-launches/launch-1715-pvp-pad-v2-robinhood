import {
  Contract,
  FetchRequest,
  Interface,
  JsonRpcProvider,
  keccak256,
  ZeroAddress,
} from "ethers";
import type {
  ABIs,
  ChainEvent,
  Config,
  Game,
  Imp,
  Launch,
  Snapshot,
  Verification,
} from "./types";
import { market, poolId, same, STATE_ABI } from "./math";
export async function mapLimit<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  limit = 6,
): Promise<R[]> {
  const result: R[] = Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        result[i] = await fn(items[i]);
      }
    }),
  );
  return result;
}
export class Chain {
  provider: JsonRpcProvider;
  verified = false;
  events: ChainEvent[] = [];
  logCursor: number;
  logError = "";
  logBusy = false;
  logTarget = 0;
  scannedTo = 0;
  private verification?: Promise<void>;
  pad: Contract;
  liquidity: Contract;
  king: Contract;
  state: Contract;
  constructor(
    public config: Config,
    public abis: ABIs,
    public manifest: Verification,
  ) {
    const request = new FetchRequest(config.rpc);
    request.timeout = 12000;
    this.provider = new JsonRpcProvider(request, config.chainId, {
      staticNetwork: true,
      batchMaxCount: 40,
      batchStallTime: 20,
    });
    this.pad = this.contract(config.PvPPad, "PvPPad");
    this.liquidity = this.contract(config.PadLiquidity, "PadLiquidity");
    this.king = this.contract(config.KingOfThePad, "KingOfThePad");
    this.state = new Contract(config.StateView, STATE_ABI, this.provider);
    this.logCursor = config.deploymentBlock;
  }
  contract(address: string, name: string) {
    return new Contract(address, this.abis[name], this.provider);
  }
  async verify() {
    if (this.verified) return;
    if (this.verification) return this.verification;
    this.verification = this.verifyAll().finally(() => {
      this.verification = undefined;
    });
    return this.verification;
  }
  private async verifyAll() {
    if (
      Number(await this.provider.send("eth_chainId", [])) !==
      this.config.chainId
    )
      throw new Error("RPC is on the wrong chain. Transactions are disabled.");
    await mapLimit(
      Object.entries(this.manifest.contracts),
      async ([name, v]) => {
        let code = await this.provider.getCode(v.address);
        if (code === "0x") throw new Error(`${name} has no deployed code.`);
        for (const m of v.masks)
          code =
            code.slice(0, 2 + m.start * 2) +
            "0".repeat(m.length * 2) +
            code.slice(2 + (m.start + m.length) * 2);
        if (keccak256(code) !== v.codeHash)
          throw new Error(`${name} code differs from the pinned build.`);
      },
    );
    const [liq, king, poolManager] = await Promise.all([
      this.pad.liquidity(),
      this.pad.king(),
      this.liquidity.poolManager(),
    ]);
    if (
      !same(liq, this.config.PadLiquidity) ||
      !same(king, this.config.KingOfThePad) ||
      !same(poolManager, this.config.PoolManager)
    )
      throw new Error("Deployment bindings do not match configuration.");
    await mapLimit(
      [
        this.config.PoolManager,
        this.config.UniversalRouter,
        this.config.Quoter,
        this.config.StateView,
        this.config.Permit2,
      ],
      async (address) => {
        if ((await this.provider.getCode(address)) === "0x")
          throw new Error("A configured Uniswap contract has no code.");
      },
    );
    this.verified = true;
  }
  async verifyLaunch(id: number) {
    const [row, game, token] = await Promise.all([
      this.pad.getLaunch(id),
      this.pad.gameOf(id),
      this.pad.tokenOf(id),
    ]);
    if (!same(row.game, game) || !same(row.token, token))
      throw new Error("Launch registry mismatch.");
    const templates = this.manifest.contracts;
    await Promise.all(
      [
        ["PadGame", game],
        ["PadToken", token],
      ].map(async ([name, addr]) => {
        const code = (await this.provider.getCode(addr)).toLowerCase();
        const expected = `0x363d3d373d3d3d363d73${templates[name].address.slice(2).toLowerCase()}5af43d82803e903d91602b57fd5bf3`;
        if (code !== expected)
          throw new Error("Launch is not a clone of the pinned template.");
      }),
    );
    return { row, game, token };
  }
  async read(address: string, gameId: number): Promise<Snapshot> {
    await this.verify();
    const block = await this.provider.getBlock("latest");
    if (!block) throw new Error("Latest block unavailable.");
    const opts = { blockTag: block.number };
    const p = this.pad,
      l = this.liquidity,
      k = this.king;
    const [
      opened,
      owner,
      deadline,
      genesisId,
      genesisGraduated,
      count,
      king,
      bid,
      crownedAt,
      nextBid,
      challengeAt,
      bucket,
      lastBurn,
      totalBurn,
      pools,
      l2,
    ] = await Promise.all([
      p.opened(opts),
      p.owner(opts),
      p.openDeadline(opts),
      p.genesisId(opts),
      p.genesisGraduated(opts),
      p.launchCount(opts),
      k.king(opts),
      k.bid(opts),
      k.crownedAt(opts),
      k.nextMinBid(opts),
      k.challengeOpensAt(opts),
      l.burnBucket(opts),
      l.lastBurnAt(opts),
      l.totalBurnedEth(opts),
      l.poolCount(opts),
      this.provider.call({
        to: "0x0000000000000000000000000000000000000064",
        data: "0xa3b1b31d",
        blockTag: block.number,
      }),
    ]);
    const launches = await mapLimit(
      Array.from({ length: Number(count) }, (_, i) => i + 1),
      (id) => this.readLaunch(id, opts),
    );
    const selected = launches.find(
      (x) => x.id === (gameId || Number(genesisId)),
    );
    const [game, kingClaim, liquidityClaim] = await Promise.all([
      selected ? this.readGame(selected, address, opts) : undefined,
      address ? k.claimable(address, opts) : 0n,
      address ? l.claimable(address, opts) : 0n,
    ]);
    return {
      block: block.number,
      l2Block: Number(BigInt(l2)),
      timestamp: block.timestamp,
      updated: Date.now(),
      opened,
      owner,
      deadline: Number(deadline),
      genesisId: Number(genesisId),
      genesisGraduated,
      launches,
      game,
      king,
      bid,
      crownedAt: Number(crownedAt),
      nextBid,
      challengeAt: Number(challengeAt),
      kingClaim,
      liquidityClaim,
      burnBucket: bucket,
      lastBurnAt: Number(lastBurn),
      totalBurnedEth: totalBurn,
      poolCount: Number(pools),
    };
  }
  async readLaunch(id: number, opts: object): Promise<Launch> {
    const p = this.pad;
    const [row, game, token] = await Promise.all([
      p.getLaunch(id, opts),
      p.gameOf(id, opts),
      p.tokenOf(id, opts),
    ]);
    if (!same(row.game, game) || !same(row.token, token))
      throw new Error(`Registry mismatch for launch ${id}.`);
    const g = this.contract(game, "PadGame");
    const [status, entries, seats, signupEnd, hardEnd, endTime, pot, raised] =
      await Promise.all([
        g.status(opts),
        g.entryCount(opts),
        g.impCount(opts),
        g.signupEnd(opts),
        g.hardEnd(opts),
        g.endTime(opts),
        g.pot(opts),
        g.ethRaised(opts),
      ]);
    const launch: Launch = {
      id,
      token,
      game,
      creator: row.creator,
      createdAt: Number(row.createdAt),
      name: row.name,
      ticker: row.ticker,
      imageURL: row.imageURL,
      status: Number(status),
      entries: Number(entries),
      seats: Number(seats),
      signupEnd: Number(signupEnd),
      hardEnd: Number(hardEnd),
      endTime: Number(endTime),
      pot,
      raised,
    };
    if (launch.status === 5)
      try {
        const key = await this.liquidity.poolKey(token, opts);
        const [slot, supply] = await Promise.all([
          this.state.getSlot0(poolId(key), opts),
          this.contract(token, "PadToken").totalSupply(opts),
        ]);
        if (slot[0] === 0n) throw new Error("Pool price unavailable");
        Object.assign(launch, market(slot[0], supply));
      } catch {
        launch.marketError = "Pool price unavailable";
      }
    return launch;
  }
  async readGame(launch: Launch, address: string, opts: object): Promise<Game> {
    const g = this.contract(launch.game, "PadGame");
    const [
      playStart,
      draw,
      quote,
      funded,
      bellRinger,
      bellRang,
      pendingCount,
      rollPot,
      releaseCap,
      myEntry,
      mySeat,
      myTokens,
      claimable,
    ] = await Promise.all([
      g.playStart(opts),
      g.drawProgress(opts),
      g.quote(1800000000000000n, opts),
      g.fundedPot(opts),
      g.bellRinger(opts),
      g.bellRang(opts),
      g.pendingCount(opts),
      g.rollPot(opts),
      g.fundedReleaseCap(opts),
      address ? g.entryOf(address, opts) : 0n,
      address ? g.impOf(address, opts) : 0n,
      address
        ? this.contract(launch.token, "PadToken").balanceOf(address, opts)
        : 0n,
      address ? g.claimable(address, opts) : 0n,
    ]);
    const imps = await mapLimit(
      Array.from({ length: launch.seats }, (_, i) => i),
      async (i) => {
        const [v, alive] = await Promise.all([
          g.getImp(i, opts),
          g.isAlive(i, opts),
        ]);
        return {
          seat: i + 1,
          owner: v.owner,
          height: Number(v.height),
          lastRoll: Number(v.lastRoll),
          heightReachedAt: Number(v.heightReachedAt),
          nonce: Number(v.nonce),
          pendingRoll: Number(v.pendingRoll),
          heightRoll: Number(v.heightRoll),
          alive,
        } satisfies Imp;
      },
    );
    const mine = imps.find((x) => x.seat === Number(mySeat));
    let pendingCommit = 0;
    if (mine?.pendingRoll)
      pendingCommit = Number(
        (await g.getRoll(mine.pendingRoll - 1, opts)).commitBlock,
      );
    return {
      ...launch,
      imps,
      playStart: Number(playStart),
      draw: {
        entries: Number(draw.entries),
        seated: Number(draw.seated),
        target: Number(draw.target),
        commit: Number(draw.commit),
        seeded: draw.seeded,
        complete: draw.complete,
      },
      myEntry: Number(myEntry),
      mySeat: Number(mySeat),
      myTokens,
      claimable,
      quote: quote.tokensOut,
      funded,
      bellRinger,
      bellRang,
      pendingCount: Number(pendingCount),
      pendingCommit,
      rollPot,
      releaseCap,
    };
  }
  async scan(launches: Launch[], head: number, onUpdate: () => void) {
    if (this.logBusy) return;
    this.logBusy = true;
    this.logTarget = head;
    const known = new Map<string, Interface>([
      [this.config.PvPPad.toLowerCase(), new Interface(this.abis.PvPPad)],
      [
        this.config.PadLiquidity.toLowerCase(),
        new Interface(this.abis.PadLiquidity),
      ],
      [
        this.config.KingOfThePad.toLowerCase(),
        new Interface(this.abis.KingOfThePad),
      ],
      ...launches.map(
        (l) =>
          [l.game.toLowerCase(), new Interface(this.abis.PadGame)] as [
            string,
            Interface,
          ],
      ),
    ]);
    try {
      let chunks = 0;
      while (this.logCursor <= head && chunks++ < 6) {
        let size = this.config.logChunk,
          logs: any[] = [];
        let end = 0;
        while (true) {
          end = Math.min(head, this.logCursor + size - 1);
          try {
            logs = await this.provider.getLogs({
              address: [...known.keys()],
              fromBlock: this.logCursor,
              toBlock: end,
            });
            break;
          } catch (e) {
            if (size <= 32) throw e;
            size = Math.max(32, Math.floor(size / 2));
          }
        }
        const start = this.logCursor;
        this.events = this.events.filter(
          (e) => e.block < start || e.block > end,
        );
        for (const log of logs) {
          const iface = known.get(log.address.toLowerCase());
          const parsed = iface?.parseLog(log);
          if (!parsed) continue;
          const args: Record<string, any> = {};
          parsed.fragment.inputs.forEach(
            (input, i) => (args[input.name] = parsed.args[i]),
          );
          this.events.push({
            key: `${log.blockHash}:${log.index}`,
            address: log.address,
            name: parsed.name,
            args,
            block: log.blockNumber,
            index: log.index,
            hash: log.transactionHash,
          });
        }
        this.events.sort((a, b) => a.block - b.block || a.index - b.index);
        this.logCursor = end + 1;
        this.scannedTo = end;
        this.logError = "";
        onUpdate();
      }
      if (this.logCursor > head)
        this.logCursor = Math.max(this.config.deploymentBlock, head - 32); // Re-read overlap on the next poll to repair shallow reorgs.
    } catch {
      this.logError =
        "History scan paused. It will retry; totals may be incomplete.";
    } finally {
      this.logBusy = false;
      onUpdate();
    }
  }
}
