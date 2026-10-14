import {
  AbiCoder,
  formatEther,
  keccak256,
  parseEther,
  ZeroAddress,
} from "ethers";
import type { Game, Imp } from "./types";
export const PHASES = [
  "Waiting",
  "Signup",
  "Play",
  "Ended",
  "Finalized",
  "Graduated",
  "Failed",
  "Drawing",
];
export const ENTRY = parseEther("0.001"),
  ROLL = parseEther("0.002");
export const POOL_TYPE =
  "tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
export const ROUTER_ABI = [
  "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
];
export const QUOTER_ABI = [
  `function quoteExactInputSingle(tuple(${POOL_TYPE} poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)`,
];
export const STATE_ABI = [
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
];
export const PERMIT_ABI = [
  "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
];
export const coder = AbiCoder.defaultAbiCoder();
export function same(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}
export function short(a: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "No wallet";
}
export function eth(v: bigint | undefined, digits = 5) {
  if (v === undefined) return "—";
  if (v > 0n && v < 10n ** BigInt(18 - digits))
    return "<" + (10 ** -digits).toFixed(digits);
  return Number(formatEther(v)).toLocaleString("en-US", {
    maximumFractionDigits: digits,
  });
}
export function tokens(v: bigint | undefined) {
  if (v === undefined) return "—";
  if (v > 0n && v < 10n ** 16n) return "<0.01";
  return Number(formatEther(v)).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}
export function remaining(end: number, now: number) {
  if (!end) return "Not started";
  const s = Math.max(0, Math.ceil(end - now));
  return `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ":" : ""}${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
export function odds(n: number) {
  return n <= 200 ? 100 : (200 / n) * 100;
}
export function rankImps(imps: Imp[]) {
  return imps
    .filter((i) => i.alive)
    .sort(
      (a, b) =>
        Math.abs(b.height) - Math.abs(a.height) ||
        a.heightReachedAt - b.heightReachedAt ||
        a.heightRoll - b.heightRoll ||
        a.seat - b.seat,
    );
}
export function projectPayouts(g: Game) {
  const ranked = rankImps(g.imps),
    earned = g.pot - g.funded;
  let fee = (g.pot * 50n) / 10000n;
  fee = fee > parseEther("0.005") ? parseEther("0.005") : fee;
  fee = fee > earned ? earned : fee;
  const released =
    ranked.length < 5 ? 0n : g.funded < g.releaseCap ? g.funded : g.releaseCap;
  const distributable = earned - fee + released;
  const bell = g.bellRang ? (distributable * 20n) / 100n : 0n;
  const rankPot = distributable - bell,
    paid = Math.ceil(ranked.length / 2),
    weights = BigInt((paid * (paid + 1)) / 2);
  return {
    fee,
    distributable,
    bell,
    paid,
    rows: ranked.map((imp, index) => ({
      imp,
      amount:
        (index < paid ? (rankPot * BigInt(paid - index)) / weights : 0n) +
        (same(imp.owner, g.bellRinger) ? bell : 0n),
    })),
  };
}
export function poolId(key: unknown) {
  return keccak256(coder.encode([POOL_TYPE], [key]));
}
export function market(sqrt: bigint, supply: bigint) {
  const r = Number(sqrt) / 2 ** 96;
  const price = r > 0 ? 1 / (r * r) : 0;
  return { price, marketCap: price * Number(formatEther(supply)) };
}
export function swapEncoding(
  key: any,
  buy: boolean,
  amount: bigint,
  minOut: bigint,
  extended = true,
) {
  if (
    amount <= 0n ||
    amount >= 1n << 128n ||
    minOut <= 0n ||
    minOut >= 1n << 128n
  )
    throw new Error("Swap amount is outside the supported range.");
  const fields = extended
    ? `${POOL_TYPE},bool,uint128,uint128,uint256,bytes`
    : `${POOL_TYPE},bool,uint128,uint128,bytes`;
  const vals = extended
    ? [key, buy, amount, minOut, 0n, "0x"]
    : [key, buy, amount, minOut, "0x"];
  const params = [
    coder.encode([`tuple(${fields})`], [vals]),
    coder.encode(["address", "uint256"], [buy ? key[0] : key[1], amount]),
    coder.encode(["address", "uint256"], [buy ? key[1] : key[0], minOut]),
  ];
  return {
    commands: "0x10",
    inputs: [coder.encode(["bytes", "bytes[]"], ["0x060c0f", params])],
    value: buy ? amount : 0n,
  };
}
export function slippageBps(input: string) {
  if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(input.trim()))
    throw new Error(
      "Use slippage from 0.01% to 5%, with at most two decimals.",
    );
  const value = Number(input);
  if (!Number.isFinite(value) || value < 0.01 || value > 5)
    throw new Error("Choose slippage from 0.01% to 5%.");
  return Math.round(value * 100);
}
export function minOutput(out: bigint, bps: number) {
  if (!Number.isInteger(bps) || bps < 1 || bps > 500)
    throw new Error("Choose slippage from 0.01% to 5%.");
  return (out * BigInt(10000 - bps)) / 10000n;
}
export function safeImage(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" ? u.href : "";
  } catch {
    return "";
  }
}
export function launchErrors(name: string, ticker: string, url: string) {
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  const e: Record<string, string> = {};
  if (!name.trim() || bytes(name) > 32)
    e.name = "Use 1 to 32 UTF-8 bytes for the name.";
  if (!ticker.trim() || bytes(ticker) > 10)
    e.ticker = "Use 1 to 10 UTF-8 bytes for the ticker.";
  if (bytes(url) > 200 || (url && !safeImage(url)))
    e.image =
      "Use an HTTPS image URL of at most 200 UTF-8 bytes, or leave it empty.";
  return e;
}
export function validPool(key: any, token: string, hook: string) {
  return (
    same(key[0], ZeroAddress) &&
    same(key[1], token) &&
    Number(key[2]) === 10000 &&
    Number(key[3]) === 200 &&
    same(key[4], hook)
  );
}
export function errorText(error: unknown) {
  const e = error as any;
  if (e?.code === 4001 || e?.code === "ACTION_REJECTED")
    return "Request declined in your wallet. You can try again.";
  return String(
    e?.reason || e?.shortMessage || e?.message || "Request failed. Try again.",
  ).slice(0, 220);
}
