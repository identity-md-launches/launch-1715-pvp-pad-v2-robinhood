import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { requireTool, toolsDir } from "./tools.mjs";
const { build } = requireTool("esbuild");
const { parseEther, AbiCoder, ZeroAddress } = requireTool("ethers");
await mkdir("/tmp/pvp-unit", { recursive: true });
await build({
  entryPoints: [new URL("../src/math.ts", import.meta.url).pathname],
  outfile: "/tmp/pvp-unit/math.mjs",
  bundle: true,
  format: "esm",
  platform: "node",
  nodePaths: [resolve(toolsDir, "node_modules")],
});
const m = await import(pathToFileURL("/tmp/pvp-unit/math.mjs"));
let tests = 0;
function test(name, fn) {
  fn();
  console.log("PASS " + name);
  tests++;
}
test("raffle odds are exact at the 200-entry boundary", () => {
  assert.equal(m.odds(0), 100);
  assert.equal(m.odds(200), 100);
  assert.equal(m.odds(400), 50);
});
test("UTF-8 contract byte limits and HTTPS image URL validation", () => {
  assert.deepEqual(m.launchErrors("Coin", "COIN", ""), {});
  assert.ok(m.launchErrors("🙂".repeat(9), "OK", "javascript:alert(1)").name);
  assert.ok(
    m.launchErrors("Okay", "🙂".repeat(3), "http://example.com").ticker,
  );
  assert.ok(m.launchErrors("Okay", "OK", "data:image/svg+xml,test").image);
});
const imp = (seat, height, alive = true) => ({
  seat,
  owner: "0x" + String(seat).repeat(40),
  height,
  alive,
  heightReachedAt: 100 + seat,
  heightRoll: seat,
});
test("absolute height, earlier block/roll, then lower seat break ties", () => {
  const a = [imp(3, 4), imp(1, -8), imp(2, 8), imp(4, 49, false)];
  assert.deepEqual(
    m.rankImps(a).map((x) => x.seat),
    [1, 2, 3],
  );
});
const game = {
  imps: [imp(1, 10), imp(2, -9), imp(3, 8), imp(4, -7), imp(5, 6)],
  pot: parseEther("1"),
  funded: parseEther("0.5"),
  releaseCap: parseEther("0.2"),
  bellRang: true,
  bellRinger: "0x" + "1".repeat(40),
};
test("funded cap, finalizer cap, triangular ranking and 20% bell", () => {
  const p = m.projectPayouts(game);
  assert.equal(p.fee, parseEther("0.005"));
  assert.equal(p.distributable, parseEther("0.695"));
  assert.equal(p.bell, parseEther("0.139"));
  assert.equal(p.paid, 3);
  assert.ok(p.rows[0].amount > p.rows[1].amount);
  assert.equal(p.rows[3].amount, 0n);
  assert.ok(p.rows.reduce((v, r) => v + r.amount, 0n) <= p.distributable);
});
test("funded money is withheld below five living Imps", () => {
  const p = m.projectPayouts({ ...game, imps: game.imps.slice(0, 4) });
  assert.equal(p.distributable, parseEther("0.495"));
});
test("zero living Imps causes no division by zero", () =>
  assert.equal(m.projectPayouts({ ...game, imps: [] }).rows.length, 0));
test("spot price inverts currency1/currency0 and market cap uses supply", () => {
  const p = m.market((1n << 96n) * 10000n, parseEther("1000000000"));
  assert.equal(p.price, 1e-8);
  assert.equal(p.marketCap, 10);
});
test("slippage uses integer basis points and rejects unsafe limits", () => {
  assert.equal(m.minOutput(10000n, 100), 9900n);
  assert.throws(() => m.minOutput(100n, 0));
  assert.throws(() => m.minOutput(100n, 501));
});
test("v4 exact-in uses extended params, SETTLE_ALL and TAKE_ALL", () => {
  const key = [
    ZeroAddress,
    "0x3333333333333333333333333333333333333333",
    10000,
    200,
    "0x4444444444444444444444444444444444446000",
  ];
  for (const buy of [true, false]) {
    const s = m.swapEncoding(key, buy, 1000n, 900n);
    assert.equal(s.commands, "0x10");
    assert.equal(s.value, buy ? 1000n : 0n);
    const c = AbiCoder.defaultAbiCoder();
    const [actions, params] = c.decode(["bytes", "bytes[]"], s.inputs[0]);
    assert.equal(actions, "0x060c0f");
    const [swap] = c.decode(
      [`tuple(${m.POOL_TYPE},bool,uint128,uint128,uint256,bytes)`],
      params[0],
    );
    assert.equal(swap[1], buy);
    assert.equal(swap[2], 1000n);
    assert.equal(swap[3], 900n);
    assert.equal(swap[4], 0n);
    const [currency, max] = c.decode(["address", "uint256"], params[1]);
    assert.equal(currency.toLowerCase(), (buy ? key[0] : key[1]).toLowerCase());
    assert.equal(max, 1000n);
  }
});
test("zero-output swaps fail closed", () =>
  assert.throws(() => m.swapEncoding([], true, 1n, 0n)));
test("slippage input never silently rounds a third decimal", () => {
  assert.equal(m.slippageBps("0.29"), 29);
  assert.equal(m.slippageBps(".5"), 50);
  assert.throws(() => m.slippageBps("0.005"));
  assert.throws(() => m.slippageBps("1e-2"));
});
test("small nonzero balances are never displayed as zero", () => {
  assert.equal(m.eth(1n), "<0.00001");
  assert.equal(m.eth(parseEther("0.001"), 8), "0.001");
  assert.equal(m.tokens(1n), "<0.01");
});
console.log(`${tests} meaningful unit checks passed.`);
