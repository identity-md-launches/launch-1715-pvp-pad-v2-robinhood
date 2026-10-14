import {
  Contract,
  formatEther,
  getAddress,
  parseEther,
  ZeroAddress,
} from "ethers";
import { Chain } from "./data";
import { Wallet } from "./wallet";
import { Board, bellSVG, dieSVG, impSVG } from "./board";
import {
  ENTRY,
  ROLL,
  PHASES,
  eth,
  tokens,
  short,
  same,
  odds,
  remaining,
  errorText,
  projectPayouts,
  launchErrors,
  safeImage,
  QUOTER_ABI,
  PERMIT_ABI,
  ROUTER_ABI,
  swapEncoding,
  minOutput,
  slippageBps,
  validPool,
} from "./math";
import type {
  ABIs,
  Config,
  Game,
  Launch,
  Snapshot,
  Verification,
} from "./types";
const $ = <T extends HTMLElement = HTMLElement>(q: string) =>
  document.querySelector<T>(q)!;
const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const attr = esc;
let config: Config,
  chain: Chain,
  wallet: Wallet,
  snapshot: Snapshot | undefined;
let rpcError = "",
  loading = true,
  reading = false,
  busy = "",
  route = "pad",
  gameId = 0,
  pollTimer = 0,
  board: Board | undefined,
  boardKey = "",
  lastWallet = "",
  filter = "all";
let saltWorker: Worker | undefined,
  salt = "",
  hookAddress = "",
  mineStatus = "",
  mineBusy = false;
let pendingConfirm: (() => Promise<void>) | undefined;
let workflowAccount = "";
let boardSignature = "";
let transactionFocus = "";
let draft = { name: "", ticker: "", image: "" };
let draftErrors: Record<string, string> = {};
let trade = {
  buy: true,
  amount: "",
  slippage: "1",
  quote: 0n,
  min: 0n,
  at: 0,
  game: 0,
  error: "",
  loading: false,
  key: [] as any[],
  input: 0n,
};
const seenResolved = new Set<string>();
const animatedRolls = new Set<string>();
let dieValue = "?";
let dieTumbleUntil = 0;
const toasts = new Map<
  string,
  { text: string; hash?: string; error?: boolean }
>();
function now() {
  return snapshot
    ? snapshot.timestamp + (Date.now() - snapshot.updated) / 1000
    : Date.now() / 1000;
}
function fresh() {
  return !!snapshot && !rpcError && Date.now() - snapshot.updated < 30000;
}
function value(v: unknown) {
  return esc(v === undefined ? "—" : v);
}
function phase(s: number) {
  return `<span class="phase p${s}">${PHASES[s] || "Unknown"}</span>`;
}
function stat(label: string, content: string) {
  return `<div class="stat"><dt>${label}</dt><dd>${content}</dd></div>`;
}
function button(
  label: string,
  action: string,
  disabled = false,
  primary = false,
  extra = "",
) {
  return `<button class="button ${primary ? "primary" : ""}" data-action="${action}" ${disabled ? "disabled" : ""} ${extra}>${label}</button>`;
}
function action(
  label: string,
  fn: string,
  allowed = true,
  primary = true,
  extra = "",
) {
  const connect = !wallet?.address;
  const wrong = wallet?.address && !wallet.correct;
  return button(
    connect
      ? "Connect to " + label.toLowerCase()
      : wrong
        ? "Add Robinhood Chain"
        : label,
    connect ? "connect" : wrong ? "switch" : fn,
    !allowed || !!busy || !!workflowAccount || (!connect && !wrong && !fresh()),
    primary,
    extra,
  );
}
function addressLink(address: string, label?: string) {
  return `<a href="${config.explorer}/address/${attr(address)}" target="_blank" rel="noopener noreferrer" title="${attr(address)}">${esc(label || short(address))} ↗</a>`;
}
function curve(l: Launch) {
  return `<div><div class="curve-label"><span>Curve</span><span class="mono">${eth(l.raised, 4)} / 4 ETH</span></div><progress max="4" value="${Math.min(4, Number(formatEther(l.raised)))}" aria-label="ETH raised toward 4 ETH"></progress></div>`;
}
function countdown(end: number) {
  return `<time data-end="${end}">${remaining(end, now())}</time>`;
}
function header(title: string, description: string) {
  return `<div class="page-head"><div><h1>${title}</h1><p>${description}</p></div></div>`;
}
function contracts(g: Launch) {
  return `<div class="contract-links">${addressLink(g.game, "Game contract")}${addressLink(g.token, "Token contract")}<span>Launch #${g.id} · Verified registry</span></div>`;
}
function historyNote() {
  const pending = !snapshot || chain.scannedTo < snapshot.block;
  return `<p class="history-note">${chain.logError ? esc(chain.logError) : pending ? `Loading history from block ${config.deploymentBlock.toLocaleString()}. Scanned to ${Math.max(config.deploymentBlock, chain.logCursor - 1).toLocaleString()}; totals are partial.` : "History synced from deployment; recent blocks are rechecked for reorganizations."}</p>`;
}
function noData() {
  return `<div class="notice ${rpcError ? "error" : ""}"><div><strong>${rpcError ? "Chain data unavailable" : "Reading live contracts"}</strong><p>${rpcError ? "The RPC could not be reached or verified. Retry to load current state." : "Balances and actions will appear after the first verified read."}</p></div>${button("Retry connection", "refresh")}</div>`;
}
function liveNotice() {
  return snapshot && !fresh()
    ? `<div class="notice error"><strong>Read is stale. Transactions are paused.</strong><p>Last successful update: ${new Date(snapshot.updated).toLocaleTimeString()}. Refresh to continue.</p></div>`
    : "";
}
function home() {
  const s = snapshot,
    g = s?.launches.find((l) => l.id === s.genesisId);
  let mainAction = "";
  let note = "";
  let subtitle = "A 50-minute Imp game. A coin at the end.";
  if (!s) {
    mainAction = button("Retry connection", "refresh", false, true);
    note = "Live state is unavailable. No entries or balances are assumed.";
  } else if (!s.opened) {
    mainAction = canOpen()
      ? `<a class="button primary" href="#/owner">Open the pad</a>`
      : wallet.address
        ? '<a class="button primary" href="#/owner">View opening details</a>'
        : action("Check opening access", "connect");
    note = `The pad is closed. Public opening ${new Date(s.deadline * 1000).toLocaleString()}.`;
  } else if (g) {
    const labels: Record<number, string> = {
      0: "Enter for 0.001 ETH",
      1: "Enter for 0.001 ETH",
      7: "Draw seats",
      2: "Open the game",
      3: "Finalize game",
      4: "Graduate PvP",
      5: "Trade PvP",
      6: "Restart PvP",
    };
    mainAction = `<a class="button primary" href="#/game/${g.id}">${labels[g.status]} <span aria-hidden="true">↗</span></a>`;
    note =
      g.status <= 1
        ? "Entry is nonrefundable and funds PvP burns. Up to 200 seats."
        : g.status === 5
          ? "PvP graduated. Trade or launch the next game."
          : "Each roll costs 0.002 ETH. Reach either bell to end the game.";
  }
  const rows =
    s?.launches.filter(
      (l) =>
        filter === "all" ||
        (filter === "active"
          ? [0, 1, 2, 7].includes(l.status)
          : l.status === 5),
    ) || [];
  return `${liveNotice()}<section class="hero" aria-labelledby="genesis-title"><div class="hero-copy">${g ? phase(g.status) : `<span class="phase">${s ? "Pad not open yet" : loading ? "Connecting" : "RPC unavailable"}</span>`}<h1 id="genesis-title">PvP genesis<span class="gold">.</span></h1><p>${subtitle}</p><div class="actions">${mainAction}</div><p class="hero-note">${note}</p><dl class="hero-stats">${stat("Entry", '0.001 <span class="small-text">ETH</span>')}${stat(g && [2, 3, 4, 5].includes(g.status) ? "Seats" : "Entries", g ? String([2, 3, 4, 5].includes(g.status) ? g.seats : g.entries) : "—")}${stat("Prize pot", g ? `${eth(g.pot)} <span class="small-text">ETH</span>` : "—")}</dl></div><div class="hero-board"><canvas id="board" role="img" aria-label="Ethereum rhombus board, from summit plus 50 to abyss minus 50. Player positions are available on the game page."></canvas><div class="board-caption">${s?.game?.imps.length ? `${s.game.imps.filter((i) => i.alive).length} living Imps` : "The board awaits."}<br>Two bells. One finish.</div></div></section>${!s ? noData() : ""}<section aria-labelledby="launches-title"><div class="section-head"><div><h2 id="launches-title">On the pad</h2><p>${s ? `${s.launches.length} registered ${s.launches.length === 1 ? "launch" : "launches"}` : "Coins appear only after registry verification."}</p></div><a class="button small plain" href="#/launch">Launch a coin ↗</a></div><div class="tabs" aria-label="Filter launches">${["all", "active", "graduated"].map((x) => `<button class="button small" data-action="filter" data-filter="${x}" aria-pressed="${filter === x}">${x[0].toUpperCase() + x.slice(1)}</button>`).join("")}</div>${rows.length ? `<div class="cards">${rows.map(card).join("")}</div>` : `<div class="empty"><h3>${!s ? "Waiting for the registry" : !s.opened ? "Genesis comes first" : filter === "all" ? "No launches yet" : "No matching launches"}</h3><p class="muted">${!s ? "Retry the connection to see verified launches." : !s.opened ? "Opening the pad creates the first PvP game. Other coins unlock when PvP graduates." : "Change the filter or return after the next game begins."}</p>${filter !== "all" ? button("Show all launches", "clear-filter") : s && !s.opened ? `<a class="button plain" href="#/rules">Read the rules</a>` : ""}</div>`}</section>`;
}
function card(l: Launch) {
  return `<article class="coin-card"><div class="coin-heading">${impSVG(l.creator)}<div><h3>${esc(l.name)}</h3><p class="symbol">${esc(l.ticker)} · #${l.id}</p></div></div>${phase(l.status)}<dl class="card-stats">${stat(l.status <= 1 ? "Entries" : "Seats", String(l.status <= 1 ? l.entries : l.seats))}${stat("Pot", eth(l.pot) + " ETH")}${stat(l.status === 1 ? "Signup ends" : l.status === 2 ? "Game ends" : "Phase", l.status === 1 ? countdown(l.signupEnd) : l.status === 2 ? countdown(l.endTime) : PHASES[l.status])}${l.status === 5 ? stat("Price", l.price ? l.price.toPrecision(4) + " ETH" : "Unavailable") : stat("Maximum play", "50:00")}</dl>${curve(l)}${l.status === 5 ? `<p class="small-text muted">Market cap <span class="mono">${l.marketCap?.toLocaleString("en-US", { maximumFractionDigits: 4 }) ?? "Unavailable"} ETH</span></p>` : ""}<a class="button plain" href="#/game/${l.id}">${l.status === 5 ? "Trade coin" : "Open game"} ↗</a></article>`;
}
function signup(g: Game) {
  return `<section class="panel"><h2>${g.status === 0 ? "Take the first entry" : "Enter the raffle"}</h2><p>Pay 0.001 ETH to enter. It funds PvP burns and is never refunded, even if you miss a seat.</p>${action(g.myEntry ? "Already entered" : "Enter for 0.001 ETH", "enter", !g.myEntry)}<dl class="metrics">${stat("Signup closes", g.signupEnd ? countdown(g.signupEnd) : "10 min after first entry")}${stat("Entries", String(g.entries))}${stat("My entry", wallet.address ? (g.myEntry ? "#" + g.myEntry : "Not entered") : "Connect to see")}${stat("Seat odds", `${odds(g.entries).toFixed(g.entries > 200 ? 2 : 0)}%`)}</dl><p class="help">Everyone plays at 200 entries or fewer. Above 200, each entry has a 200 / entries chance. One entry per wallet; one person can use many wallets.</p></section>`;
}
function drawing(g: Game) {
  const ready =
    !g.draw.commit || g.draw.seeded || snapshot!.l2Block > g.draw.commit + 3;
  return `<section class="panel"><h2>Draw the seats</h2><p>Anyone can advance the draw. Draw promptly to preserve the committed seed’s fairness.</p>${action(ready ? "Draw seats" : "Waiting for seed blocks", "draw", ready)}<dl class="metrics">${stat("Draw progress", `${g.draw.seated} / ${g.draw.target}`)}${stat("Entries", String(g.draw.entries))}${stat("My entry", g.myEntry ? "#" + g.myEntry : wallet.address ? "Not entered" : "Connect to see")}${stat("My seat", g.mySeat ? "#" + g.mySeat : "Pending draw")}</dl><progress max="${Math.max(1, g.draw.target)}" value="${g.draw.seated}" aria-label="Seats drawn"></progress><p class="help">Each press draws up to 32 seats after the seed is ready. Allow about 8 transactions for 200 seats, including the seed commitment. Each one needs wallet approval.</p></section>`;
}
function play(g: Game) {
  const me = g.imps.find((i) => i.seat === g.mySeat),
    cooldown = me?.lastRoll ? me.lastRoll + 60 : 0,
    death = me ? (me.lastRoll || g.playStart) + 600 : 0;
  const pending = !!me?.pendingRoll;
  const canReveal = snapshot!.l2Block > g.pendingCommit + 3;
  const canRoll = !!me?.alive && now() >= cooldown && !pending;
  let label = "Roll for 0.002 ETH";
  if (me && !me.alive) label = "Your Imp has fallen";
  else if (!me && wallet.address) label = "No seat in this game";
  else if (cooldown > now()) label = "Cooldown · " + remaining(cooldown, now());
  return `<section class="panel"><div class="my-imp">${me ? impSVG(me.owner, 64) : impSVG(config.PvPPad, 64)}<div><h2>${me ? "Imp #" + me.seat : "Watch the game"}</h2><p class="muted small-text">${me ? `Height <span class="mono">${me.height > 0 ? "+" : ""}${me.height}</span> · ${me.alive ? "Alive" : "Ghost"}` : "Connect to find your seat."}</p></div><div class="die ${Date.now() < dieTumbleUntil ? "tumbling" : ""}" id="die">${dieSVG}<output aria-label="Last die result">${dieValue}</output></div></div>${pending ? `<p class="roll-label">rolling...</p>${action(canReveal ? "Reveal roll" : "Waiting for 3 L2 blocks", "reveal", canReveal)}<p class="help">Reveal after the three future L2 blocks have completed. L2 block ${snapshot!.l2Block.toLocaleString()}, commit ${g.pendingCommit.toLocaleString()}.</p>` : action(label, "roll", !wallet.address || canRoll)}<dl class="metrics">${stat("Roll token quote", tokens(g.quote) + " " + esc(g.ticker))}${stat("My tokens", wallet.address ? tokens(g.myTokens) : "Connect to see")}${stat("Cooldown", me ? countdown(cooldown) : "No seat")}${stat("Death timer", me ? countdown(death) : "No seat")}${stat("50-minute limit", countdown(g.hardEnd))}${stat("Current game end", countdown(g.endTime))}</dl><p class="help">Roll at least once every 10 minutes to stay alive. Either bell ends play. Tokens remain locked until graduation.</p></section>`;
}
function finish(g: Game) {
  const payouts = chain.events.filter(
    (e) =>
      same(e.address, g.game) &&
      e.name === "Paid" &&
      same(String(e.args.to), wallet.address),
  );
  const total = payouts.reduce((s, e) => s + BigInt(e.args.amount), 0n);
  return `<section class="panel"><h2>${g.status === 3 ? "Settle the game" : g.status === 4 ? "Ready to graduate" : "Game results"}</h2><p>${g.status === 3 ? "Finalize ranks living Imps and pays the pot. The caller earns 0.5%, capped at 0.005 ETH and the roll-earned pot." : g.status === 4 ? "Graduate moves the curve reserves into locked Uniswap v4 liquidity." : "Payouts were sent directly. If a transfer failed, claim it here."}</p>${g.status === 3 ? (g.pendingCount ? `${action("Resolve pending rolls", "reveal")}<p class="help">${g.pendingCount} pending rolls must settle before finalization. Newly committed rolls need 3 completed L2 blocks.</p>` : action("Finalize game", "finalize")) : g.status === 4 ? action("Graduate coin", "graduate") : ""}<dl class="metrics">${stat("My paid + parked payout", wallet.address ? eth(total) + " ETH" : "Connect to see")}${stat("Claimable", wallet.address ? eth(g.claimable) + " ETH" : "Connect to see")}</dl>${action("Claim payout", "claim-game", g.claimable > 0n, false)}${historyNote()}</section>`;
}
function failed(g: Game) {
  return `<section class="panel"><h2>This game failed</h2><p>No ETH reached the curve before the game ended. Its remaining tokens were burned. Entries are not refundable.</p>${g.id === snapshot?.genesisId ? action("Restart PvP", "restart") : ""}<p class="help">${g.id === snapshot?.genesisId ? "Anyone can restart genesis. This creates a new PvP launch in the registry." : "This launch cannot be restarted. A new launch can be created after PvP graduates."}</p></section>`;
}
function tradePanel(g: Game) {
  const isQuote =
    trade.game === g.id && trade.quote > 0n && Date.now() - trade.at < 30000;
  return `<section class="panel" id="trade-panel"><h2>Trade ${esc(g.ticker)}</h2><div class="tabs"><button class="button small" data-action="trade-buy" aria-pressed="${trade.buy}">Buy</button><button class="button small" data-action="trade-sell" aria-pressed="${!trade.buy}">Sell</button></div><form id="trade-form"><div class="field"><label for="trade-amount">${trade.buy ? "ETH to spend" : esc(g.ticker) + " to sell"}</label><input id="trade-amount" name="amount" inputmode="decimal" autocomplete="off" value="${attr(trade.amount)}" placeholder="0.00" aria-describedby="trade-error"></div><div class="field"><label for="slippage">Slippage tolerance (%)</label><input id="slippage" inputmode="decimal" name="slippage" value="${attr(trade.slippage)}" aria-describedby="slippage-hint"><span class="hint" id="slippage-hint">0.01% to 5%. Minimum output is enforced onchain.</span></div><p id="trade-error" class="field-error" role="status">${esc(trade.error)}</p><button type="submit" class="button ${isQuote ? "" : "primary"} full" ${trade.loading || !fresh() ? "disabled" : ""}>${trade.loading ? "Getting quote…" : "Get quote"}</button></form>${isQuote ? `<dl class="metrics">${stat("Quoted output", (trade.buy ? tokens(trade.quote) : eth(trade.quote, 8)) + " " + (trade.buy ? esc(g.ticker) : "ETH"))}${stat("Minimum received", (trade.buy ? tokens(trade.min) : eth(trade.min, 8)) + " " + (trade.buy ? esc(g.ticker) : "ETH"))}</dl>${action(trade.buy ? "Buy " + esc(g.ticker) : "Approve & sell " + esc(g.ticker), "swap")}<p class="help">Quote expires in ${Math.max(0, Math.ceil((30000 - (Date.now() - trade.at)) / 1000))} seconds. ${trade.buy ? "" : "Selling may need two limited approvals: token → Permit2, then Permit2 → router. Each is a separate transaction."}</p>` : ""}<p class="help">Uniswap v4 · 1% pool fee. Quotes can change before confirmation. No price guarantee beyond your minimum output.</p></section>`;
}
function leaderboard(g: Game) {
  const projection = projectPayouts(g);
  const projected = g.status === 2 || g.status === 3;
  const paid = new Map<string, bigint>();
  for (const e of chain.events)
    if (same(e.address, g.game) && e.name === "Paid")
      paid.set(
        String(e.args.to).toLowerCase(),
        (paid.get(String(e.args.to).toLowerCase()) || 0n) +
          BigInt(e.args.amount),
      );
  const live = projection.rows;
  const dead = g.imps.filter((i) => !i.alive);
  return `<section class="panel"><h2>${projected ? "Leaderboard" : "Results"}</h2><p class="small-text muted">Ranked by absolute height. ${projected ? "Projected payouts use the current pot and eligibility; they can change." : "Paid totals include any caller fees and parked transfers."}</p>${g.imps.length ? `<div class="table-wrap"><table><thead><tr><th scope="col">Rank</th><th scope="col">Imp</th><th scope="col">Height</th><th scope="col">${projected ? "Projected ETH" : "Paid ETH"}</th></tr></thead><tbody>${[...live.map((x, i) => ({ imp: x.imp, amount: x.amount, rank: i + 1 })), ...dead.map((imp) => ({ imp, amount: 0n, rank: 0 }))].map(({ imp, amount, rank }) => `<tr class="${same(imp.owner, wallet.address) ? "mine-row" : ""} ${!imp.alive ? "dead-row" : ""}"><td>${rank || "Ghost"}</td><td><span class="imp-cell">${impSVG(imp.owner, 24)}${addressLink(imp.owner, "#" + imp.seat + (same(imp.owner, wallet.address) ? " · You" : ""))}</span></td><td class="mono">${imp.height > 0 ? "+" : ""}${imp.height}</td><td class="mono">${eth(projected ? amount : paid.get(imp.owner.toLowerCase()) || 0n)}</td></tr>`).join("")}</tbody></table></div>` : '<p class="muted">The leaderboard appears when seats are drawn.</p>'}<p class="help">The top half of living Imps, rounded up, split the rank pot with triangular weights. A valid bell ringer also earns 20% of the distributable pot. Ties favor the earlier height, earlier roll, then lower seat.</p></section>`;
}
function feed(g: Game) {
  const events = chain.events
    .filter(
      (e) =>
        same(e.address, g.game) &&
        [
          "Entered",
          "Seated",
          "Rolled",
          "Resolved",
          "Bell",
          "Finalized",
          "Graduated",
          "Failed",
          "Paid",
        ].includes(e.name),
    )
    .slice(-15)
    .reverse();
  return `<section class="panel"><h2>Live feed</h2>${
    events.length
      ? `<ul class="feed">${events
          .map((e) => {
            let text = e.name;
            const a = e.args;
            if (e.name === "Entered")
              text = `${short(a.owner)} entered · entry #${a.entry}`;
            if (e.name === "Seated")
              text = `Entry #${a.entry} drew seat #${a.imp}`;
            if (e.name === "Rolled")
              text = `Seat #${Number(a.imp) + 1} is rolling`;
            if (e.name === "Resolved")
              text = `Seat #${Number(a.imp) + 1} moved ${Number(a.delta) > 0 ? "+" : ""}${a.delta} to ${a.height}${a.expired ? " · expired roll" : ""}`;
            if (e.name === "Bell")
              text = `Seat #${Number(a.imp) + 1} rang the bell`;
            if (e.name === "Paid")
              text = `${short(a.to)} received ${eth(a.amount)} ETH${a.pushed ? "" : " · claimable"}`;
            return `<li><span>${esc(text)}</span><a href="${config.explorer}/tx/${e.hash}" target="_blank" rel="noopener noreferrer" aria-label="View ${e.name} transaction">↗</a></li>`;
          })
          .join("")}</ul>`
      : '<p class="muted small-text">No game events loaded yet.</p>'
  }${historyNote()}</section>`;
}
function game() {
  if (!snapshot)
    return (
      header("Game", "Every seat and move comes from the registered game.") +
      noData()
    );
  const g = snapshot.game;
  if (!g || g.id !== gameId)
    return (
      header("Game unavailable", "This launch is not in the PvPPad registry.") +
      `<a class="button" href="#/">Back to the pad</a>`
    );
  return `${liveNotice()}<a class="back" href="#/">← Back to the pad</a><div class="page-head"><div><h1>${esc(g.name)}</h1><p>${esc(g.ticker)} · Launch #${g.id}</p></div>${phase(g.status)}</div><div class="game-layout"><div class="game-action">${g.status <= 1 ? signup(g) : g.status === 7 ? drawing(g) : g.status === 2 ? play(g) : g.status === 6 ? failed(g) : g.status === 5 ? tradePanel(g) : finish(g)}<section class="panel"><h2>The stakes</h2><dl class="metrics">${stat("Prize pot", eth(g.pot) + " ETH")}${stat("Entries / seats", `${g.entries} / ${g.seats}`)}${stat("Curve raised", eth(g.raised) + " ETH")}${stat("My seat", g.mySeat ? "#" + g.mySeat : !wallet.address ? "Connect to see" : g.draw.complete ? "Not selected" : "Not drawn")}</dl>${curve(g)}${g.status === 5 ? `<dl class="metrics">${stat("Price", g.price ? g.price.toPrecision(5) + " ETH" : "Unavailable")}${stat("Market cap", g.marketCap !== undefined ? g.marketCap.toLocaleString("en-US", { maximumFractionDigits: 3 }) + " ETH" : "Unavailable")}</dl>` : ""}<details><summary>Contract addresses</summary>${contracts(g)}</details></section>${g.status === 5 ? finish(g) : ""}${feed(g)}</div><section class="board-panel"><div class="board-head"><h2>The rhombus</h2><span class="muted small-text">${g.imps.filter((i) => i.alive).length} living · ${g.imps.filter((i) => !i.alive).length} ghosts</span></div><canvas id="board" role="img" aria-label="Game board: summit plus 50 to abyss minus 50. All seats and exact heights are in the leaderboard below."></canvas><div class="board-legend"><span>White outline: your Imp</span><span>Faded: fallen</span></div><p class="help">Imps sharing a floor stack for visibility. The table gives every exact height.</p></section><div class="game-results">${leaderboard(g)}</div></div>`;
}
function launchPage() {
  const enabled = !!snapshot?.genesisGraduated;
  return `${header("Launch a coin", "A new coin starts with a new game.")}<div class="split"><section><form id="launch-form" novalidate>${[
    ["name", "Coin name", "32"],
    ["ticker", "Ticker", "10"],
    ["image", "Image URL (optional)", "200"],
  ]
    .map(
      ([key, label, max]) =>
        `<div class="field"><label for="launch-${key}">${label}</label><input id="launch-${key}" name="${key}" value="${attr(draft[key as keyof typeof draft])}" maxlength="${max}" ${key === "image" ? 'type="url" inputmode="url"' : 'type="text"'} autocomplete="off" aria-invalid="${!!draftErrors[key]}" aria-describedby="${key}-hint ${key}-error"><span class="hint" id="${key}-hint">${key === "image" ? "HTTPS only. " : ""}Up to ${max} UTF-8 bytes.</span><span id="${key}-error" class="field-error">${esc(draftErrors[key] || "")}</span></div>`,
    )
    .join(
      "",
    )}<button class="button primary full" type="submit" ${!enabled || busy ? "disabled" : ""}>${!enabled ? "Unlocks after PvP graduates" : wallet.address ? "Launch coin" : "Connect to launch"}</button><p class="help">No launch fee; network gas applies. Tokens are created by PvPPad, with supply held by the new game.</p></form>${!snapshot ? noData() : !enabled ? `<div class="notice"><p>PvP must graduate first. Follow genesis on the pad.</p><a href="#/">View PvP genesis</a></div>` : ""}</section><aside class="preview"><h2>Card preview</h2><div class="preview-imp" id="preview-art">${draft.image && safeImage(draft.image) ? `<img src="${attr(draft.image)}" alt="Coin image preview" referrerpolicy="no-referrer">` : impSVG(wallet.address || config.PvPPad, 128)}</div><div class="coin-heading"><div><h3 id="preview-name">${esc(draft.name || "Your coin name")}</h3><p class="symbol" id="preview-ticker">${esc(draft.ticker || "Ticker")}</p></div></div>${phase(0)}<p class="help">The first paid entry starts 10 minutes of signup. Then the raffle seats up to 200 Imps.</p></aside></div>`;
}
function kingPage() {
  const s = snapshot;
  const paid = chain.events.filter(
    (e) => e.name === "KingPaid" && same(e.address, config.PadLiquidity),
  );
  const total = paid.reduce((t, e) => t + BigInt(e.args.amount), 0n);
  return `${header("King of the pad", "Hold the crown. Earn the pools’ collected fees.")}${!s ? noData() : ""}<div class="split"><section class="panel"><svg class="crown-art" viewBox="0 0 100 90" aria-hidden="true"><path fill="currentColor" d="M10 20h10v10h10v10h10V20h5V10h10v10h5v20h10V30h10V20h10v50H10zm0 56h80v10H10z"/></svg><h2>${s && !same(s.king, ZeroAddress) ? addressLink(s.king) : "The crown is unclaimed"}</h2><dl class="metrics">${stat("Current bid", s ? eth(s.bid) + " ETH" : "—")}${stat("Time held", s?.crownedAt ? `<time data-elapsed="${s.crownedAt}">${remaining(Math.floor(now() - s.crownedAt), 0)}</time>` : "—")}${stat("Next minimum bid", s ? eth(s.nextBid) + " ETH" : "—")}${stat("Challenge opens", s ? countdown(s.challengeAt) : "—")}</dl><form id="crown-form"><div class="field"><label for="crown-bid">Your bid (ETH)</label><input id="crown-bid" name="bid" inputmode="decimal" autocomplete="off" value="${s ? formatEther(s.nextBid) : ""}" data-persist placeholder="0.01"><span class="hint">At least ${s ? eth(s.nextBid) : "0.01"} ETH. Previous bids are refunded when dethroned.</span></div><button class="button primary full" type="submit" ${!s?.genesisGraduated || now() < (s?.challengeAt || 0) || busy ? "disabled" : ""}>${!s?.genesisGraduated ? "Unlocks after PvP graduates" : wallet.address ? "Take crown" : "Connect to take crown"}</button><p id="crown-error" class="field-error" role="status"></p></form><p class="help">First bid: 0.01 ETH. Each challenge is at least 10% higher, after one hour. Extra bid: 50% to eligible games, 25% to burns, 25% to the developer.</p></section><div class="stack"><section class="panel"><h2>Fees to kings</h2><p class="big-amount">${eth(total)} <span class="small-text">ETH</span></p><p class="help">Total paid or parked, from KingPaid events.</p>${historyNote()}${action("Collect fees", "distribute", !!s?.poolCount)}<p class="help">Collects from up to 8 pools and pays the current king. Anyone can call it.</p></section><section class="panel"><h2>Parked payments</h2><dl class="metrics">${stat("Crown contract", s && wallet.address ? eth(s.kingClaim) + " ETH" : "Connect to see")}${stat("Liquidity contract", s && wallet.address ? eth(s.liquidityClaim) + " ETH" : "Connect to see")}</dl><div class="actions">${action("Claim crown payment", "claim-king", !!s && s.kingClaim > 0n, false)}${action("Claim liquidity fees", "claim-liquidity", !!s && s.liquidityClaim > 0n, false)}</div></section><section class="panel"><h2>Recent king payments</h2>${
    paid.length
      ? `<ul class="feed">${paid
          .slice(-8)
          .reverse()
          .map(
            (e) =>
              `<li><span>${addressLink(e.args.king)} · ${eth(e.args.amount)} ETH ${e.args.pushed ? "paid" : "parked"}</span><a href="${config.explorer}/tx/${e.hash}" target="_blank" rel="noopener noreferrer" aria-label="View king payment">↗</a></li>`,
          )
          .join("")}</ul>`
      : '<p class="muted">No king payments loaded.</p>'
  }</section></div></div>`;
}
function burnPage() {
  const s = snapshot;
  const burned = chain.events
    .filter((e) => e.name === "Burned" && same(e.address, config.PadLiquidity))
    .reduce((a, e) => a + BigInt(e.args.tokensBurned), 0n);
  const due =
    !!s &&
    s.burnBucket > 0n &&
    s.genesisGraduated &&
    now() >= s.lastBurnAt + 600;
  return `${header("The burn bucket", "Entries and game fees fund recurring PvP buys and burns.")}${!s ? noData() : ""}<div class="split"><section class="panel"><h2>Ready for the next burn</h2><p class="big-amount">${s ? eth(s.burnBucket) : "—"} <span class="small-text">ETH</span></p><dl class="metrics">${stat("Next chunk", s ? eth(s.burnBucket > parseEther("0.02") ? parseEther("0.02") : s.burnBucket) + " ETH" : "—")}${stat("Next burn due", s ? countdown(s.lastBurnAt + 600) : "—")}</dl>${action("Burn a chunk", "burn", due)}<p class="help">Anyone can burn once every 10 minutes after PvP has a pool. Each call spends up to 0.02 ETH; a price limit may leave some ETH for later.</p></section><section class="panel"><h2>Burns so far</h2><dl class="metrics">${stat("PvP burned", tokens(burned))}${stat("ETH spent", s ? eth(s.totalBurnedEth) + " ETH" : "—")}</dl>${historyNote()}<p class="help">Token totals come from Burned events. Entry funds wait here until PvP graduates.</p></section></div>`;
}
function keeperPage() {
  const g = snapshot?.game;
  const rows = [
    [
      "Poke",
      "Advance drawing, resolve rolls and attempt the next game step.",
      "poke",
      !!g,
    ],
    [
      "Draw seats",
      "Run the next batch of up to 32 raffle trials.",
      "draw",
      g?.status === 7,
    ],
    [
      "Finalize",
      "Rank living Imps and pay the pot; pending rolls must resolve first.",
      "finalize",
      g?.status === 3 && g.pendingCount === 0,
    ],
    [
      "Graduate",
      "Move a finalized game’s reserves into its locked v4 pool.",
      "graduate",
      g?.status === 4,
    ],
    [
      "Distribute",
      "Collect fees from up to 8 pools for the current king.",
      "distribute",
      !!snapshot?.poolCount,
    ],
    [
      "Burn chunk",
      "Buy and burn up to 0.02 ETH of PvP when the 10-minute interval is due.",
      "burn",
      !!snapshot?.genesisGraduated &&
        snapshot.burnBucket > 0n &&
        now() >= snapshot.lastBurnAt + 600,
    ],
  ] as const;
  return `${header("Keep the pad moving", "Permissionless maintenance. You pay network gas.")}${!snapshot ? noData() : ""}<section class="panel"><div class="field"><label for="keeper-game">Game to maintain</label><select id="keeper-game"><option value="0">Current PvP genesis</option>${snapshot?.launches.map((l) => `<option value="${l.id}" ${gameId === l.id ? "selected" : ""}>#${l.id} · ${esc(l.name)} · ${PHASES[l.status]}</option>`).join("") || ""}</select></div>${g ? `<p class="small-text muted">Selected #${g.id} · ${esc(g.name)} · ${PHASES[g.status]}</p>` : ""}${rows.map(([title, description, fn, enabled]) => `<div class="keeper-row"><div><h3>${title}</h3><p>${description}</p></div>${action(title, fn, !!enabled, false)}</div>`).join("")}${canOpen() ? `<div class="keeper-row"><div><h3>Open the pad</h3><p>Mine and verify the hook salt, then create genesis.</p></div><a class="button" href="#/owner">Open panel</a></div>` : ""}</section>`;
}
function canOpen() {
  return (
    !!snapshot &&
    !snapshot.opened &&
    (same(wallet?.address || "", snapshot.owner) || now() >= snapshot.deadline)
  );
}
function ownerPage() {
  if (!snapshot)
    return (
      header("Open the pad", "The first opening creates PvP genesis.") +
      noData()
    );
  if (snapshot.opened)
    return (
      header(
        "The pad is open",
        "Genesis already exists. The opening control is permanently closed.",
      ) + `<a class="button" href="#/">View the pad</a>`
    );
  if (!canOpen())
    return (
      header(
        "Opening access",
        "Only the owner can open the pad before its public deadline.",
      ) +
      `<section class="panel"><p>Public opening: ${new Date(snapshot.deadline * 1000).toLocaleString()}.</p><p>Owner: ${addressLink(snapshot.owner)}</p>${action("Check owner access", "connect")}</section>`
    );
  return `${header(same(wallet.address, snapshot.owner) ? "Owner · open the pad" : "Public opening", "Mine a valid hook address, verify it, then open once.")}<section class="panel"><dl class="metrics">${stat("Owner", addressLink(snapshot.owner))}${stat("Public deadline", new Date(snapshot.deadline * 1000).toLocaleString())}</dl><p class="small-text muted">The salt search runs locally in a Web Worker. It uses PadLiquidity’s init-code hash and requires exactly the beforeInitialize flag.</p><div class="actions">${button(mineBusy ? "Mining salt…" : salt ? "Mine another salt" : "Mine hook salt", "mine", mineBusy || !fresh(), !salt)}${mineBusy ? button("Stop mining", "stop-mine") : ""}</div><p class="help" id="mine-status">${esc(mineStatus)}</p>${salt ? `<dl class="metrics">${stat("Salt", `<span class="mined">${salt}</span>`)}${stat("Verified hook", `<span class="mined">${hookAddress}</span>`)}</dl>${action("Open pad", "open-pad", !!salt)}` : ""}<p class="help">The worker must find address &amp; 0x3FFF = 0x2000. The site confirms the result with hookAddressFor(salt) before enabling the opening transaction.</p></section>`;
}
function rulesPage() {
  return `${header("Rules of the pad", "Know the costs before you enter.")}<div class="rules"><section><h2>One game, one coin</h2><p>Every coin listed here comes from the PvPPad registry, never a name search. A name or ticker is not an identity: look-alike template clones exist. Check the linked token and game addresses.</p></section><section><h2>Enter, draw, play</h2><ul><li><strong>Entry: 0.001 ETH.</strong> One entry per wallet. The payment is nonrefundable and goes to the PvP burn bucket. The first entry starts 10 minutes of signup.</li><li><strong>Up to 200 seats.</strong> At 200 entries or fewer, everyone plays. Above that, each entry has a 200 / total entries chance. Multiple wallets can belong to the same person.</li><li><strong>Permissionless draw.</strong> A commitment uses three future Robinhood L2 block hashes. Draw up to 32 seats per transaction. Draw promptly: after the hash window expires an unseeded draw must recommit, which can weaken fairness if callers time their participation.</li><li><strong>50 minutes of play.</strong> An Imp starts at floor 0. Rolls move it by −4, −3, −2, −1, +1, +2, +3 or +4. Reach +50 or −50 to ring a bell and end play. The game also ends when every Imp is inactive for 10 minutes, or at the 50-minute limit.</li><li><strong>Roll: 0.002 ETH.</strong> A 60-second cooldown applies. Roll within 10 minutes of seating or your last roll to remain alive. A pending roll still needs revealing; it is not a guarantee of survival.</li><li><strong>Reveal after three completed L2 blocks.</strong> Anyone can resolve pending rolls. If the commitment expires beyond the hash window, the Imp moves up to four floors toward zero and cannot ring a bell on that result.</li></ul></section><section><h2>Where the ETH goes</h2><table><thead><tr><th>Payment</th><th>Allocation</th></tr></thead><tbody><tr><td>Entry</td><td>100% to the burn bucket</td></tr><tr><td>Roll</td><td>90% curve, 8% pot, 2% burn</td></tr><tr><td>PvP genesis roll</td><td>90% curve, 10% pot</td></tr><tr><td>Pool swap</td><td>1% pool fee</td></tr><tr><td>Crown extra</td><td>50% games, 25% burn, 25% developer</td></tr></tbody></table><p class="help">After the curve allocation is exhausted, its unused roll portion joins the pot. Network gas is additional to every transaction.</p></section><section><h2>The pot and the bell</h2><p>The top half of living Imps, rounded up, share the rank pot by absolute height. If three are paid, weights are 3:2:1. Ties favor the height reached earlier, then the earlier roll, then the lower seat. A valid bell ringer receives 20% of the distributable pot plus any rank payout.</p><p class="help">The finalizer receives 0.5% of the gross pot, capped at 0.005 ETH and funded from roll earnings. Added funds from kings and carry only pay out with at least five living Imps, capped at the smaller of 3× roll-earned pot and 15% of curve ETH. Unreleased funds and rounding dust return to carry. If none survive, the remaining pot returns to carry. Direct transfers that fail become claimable.</p></section><section><h2>Graduation and trading</h2><p>Finalization settles the game. Graduation puts curve ETH and remaining tokens into locked, full-range Uniswap v4 liquidity and unlocks transfers. The curve target is 4 ETH, but a game can graduate below it. A finalized game with no curve ETH fails and burns its remaining tokens. Anyone can restart failed PvP genesis.</p><p class="help">The fixed token supply is one billion. Price and market cap use pool spot state, quoted in ETH; market cap uses total supply and is not realizable exit liquidity. Trade quotes come from the Quoter. Slippage limits protect minimum output, not token value. Sells use amount-limited token and Permit2 approvals; an unused approval may remain until revoked or expired.</p></section><section><h2>King and burns</h2><p>The crown opens after PvP graduates. The first bid is at least 0.01 ETH. A king holds for one hour; the next bid must be at least 110% of the last bid. The previous bid is refunded, or parked for claiming. The extra is split as above. The current king receives collected LP fees, including fees from selling pool token proceeds. Anyone may collect up to eight pools per call.</p><p class="help">King funding targets eligible games among the last ten entered launches; otherwise it goes to carry. Burns buy and destroy PvP with at most 0.02 ETH every ten minutes, subject to a price limit. Burn totals in this site are reconstructed from events.</p></section><section><h2>Risks and access</h2><p>These contracts are experimental and unaudited. You can lose everything you put in. Chain sequencers, block availability, transaction ordering, delayed keepers, congestion, wallet behavior and public RPC outages can affect gameplay and outcomes. Randomness uses future block hashes, not an external randomness oracle. No seat, payout, liquidity value or fair market price is guaranteed.</p><p class="help">All reads are public. Wallets authorize transactions; the site holds no keys. Local wallet preference may be stored in your browser. External wallet apps and optional launch images make their own network requests. Before the opening deadline only the pad owner can open; afterwards anyone can. Check your local laws. This is not financial advice.</p></section><section><h2>Verified deployment</h2><div class="contract-links">${addressLink(config.PvPPad, "PvPPad")}${addressLink(config.PadLiquidity, "PadLiquidity")}${addressLink(config.KingOfThePad, "KingOfThePad")}</div><p class="help">Robinhood Chain 4663. History begins at block ${config.deploymentBlock.toLocaleString()}. Board layout inspired by <a href="https://github.com/Lavel0rz/Spireth" target="_blank" rel="noopener noreferrer">The Spireth</a> (MIT); original pixel Imps and tiles.</p></section></div>`;
}
function render() {
  if (!config) return;
  const main = $("#main");
  const active = document.activeElement as HTMLElement | null;
  const wasMain = !!active && main.contains(active);
  const focusId = wasMain ? active?.id : undefined;
  const focusedAction = active?.getAttribute("data-action");
  const input =
    active instanceof HTMLInputElement
      ? { start: active.selectionStart, end: active.selectionEnd }
      : undefined;
  const persisted = new Map(
    Array.from(main.querySelectorAll<HTMLInputElement>("[data-persist]")).map(
      (e) => [e.id, e.value],
    ),
  );
  const html =
    route === "pad"
      ? home()
      : route === "game"
        ? game()
        : route === "launch"
          ? launchPage()
          : route === "king"
            ? kingPage()
            : route === "burn"
              ? burnPage()
              : route === "keeper"
                ? keeperPage()
                : route === "owner"
                  ? ownerPage()
                  : rulesPage();
  main.innerHTML = html;
  main.setAttribute("aria-busy", String(!!busy || !!workflowAccount));
  if (busy || workflowAccount)
    main
      .querySelectorAll<
        HTMLInputElement | HTMLButtonElement | HTMLSelectElement
      >("form input,form select,form button,#trade-panel .tabs button")
      .forEach((e) => (e.disabled = true));
  for (const [id, v] of persisted) {
    const e = document.getElementById(id) as HTMLInputElement | null;
    if (e) e.value = v;
  }
  if (focusId && main.querySelector("#" + CSS.escape(focusId))) {
    const e = document.getElementById(focusId)!;
    e.focus({ preventScroll: true });
    if (input && e instanceof HTMLInputElement && e.type === "text")
      e.setSelectionRange(input.start, input.end);
  } else if (focusedAction && wasMain) {
    main
      .querySelector<HTMLElement>(
        `[data-action="${CSS.escape(focusedAction)}"]`,
      )
      ?.focus({ preventScroll: true });
  }
  const canvas = $<HTMLCanvasElement>("#board");
  if (canvas) {
    const key = String(snapshot?.game?.id || 0);
    if (board && boardKey === key) {
      canvas.replaceWith(board.canvas);
    } else {
      board?.destroy();
      board = new Board(canvas);
      boardSignature = "";
    }
    boardKey = key;
    const imps = snapshot?.game?.imps || [];
    const signature = wallet.address + JSON.stringify(imps);
    if (signature !== boardSignature) {
      board.update(imps, wallet.address);
      boardSignature = signature;
    }
  } else {
    board?.destroy();
    board = undefined;
    boardSignature = "";
  }
  document.querySelectorAll("[data-route]").forEach((e) => {
    e.toggleAttribute(
      "aria-current",
      e.getAttribute("data-route") === (route === "game" ? "pad" : route),
    );
    if (e.hasAttribute("aria-current")) e.setAttribute("aria-current", "page");
  });
  $("#connect").textContent = wallet.label;
  $("#network-notice").innerHTML =
    wallet.address && !wallet.correct
      ? `<div class="notice"><strong>Your wallet is on another network.</strong>${button("Add Robinhood Chain", "switch", false, true)}</div>`
      : "";
  renderStatus();
  document.querySelectorAll("img").forEach((img) => {
    img.addEventListener(
      "error",
      () => {
        img.replaceWith(
          Object.assign(document.createElement("span"), {
            textContent: "Image unavailable",
            className: "muted small-text",
          }),
        );
      },
      { once: true },
    );
  });
}
function renderStatus() {
  if (!config) return;
  $("#connection-status").classList.toggle(
    "error",
    !!rpcError || (!fresh() && !loading),
  );
  $("#sync-label").textContent = snapshot
    ? `${rpcError ? "Read failed · " : ""}Updated ${new Date(snapshot.updated).toLocaleTimeString()} · block ${snapshot.block.toLocaleString()}`
    : rpcError
      ? "RPC unavailable · retry connection"
      : loading
        ? "Reading Robinhood Chain…"
        : "Waiting for chain data";
}
function showWallet() {
  renderWallet();
  $<HTMLDialogElement>("#wallet-dialog").showModal();
}
const coinbaseIcon =
  '<svg viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="6" fill="#2C5FF6"/><path fill="white" fill-rule="evenodd" d="M14 24a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm-3-13h6v6h-6Z"/></svg>';
const browserIcon =
  '<svg viewBox="0 0 28 28" aria-hidden="true"><rect x="3" y="5" width="22" height="19" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 11h22M7 8h1m3 0h1" stroke="currentColor" stroke-width="2"/></svg>';
function renderWallet() {
  if (!wallet) return;
  const mobile =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && !wallet.injected;
  const urls = [
    [
      "metamask",
      "MetaMask",
      `https://link.metamask.io/dapp/${location.href.replace(/^https?:\/\//, "")}`,
    ],
    [
      "coinbase",
      "Coinbase Wallet",
      `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(location.href)}`,
    ],
    [
      "rabby",
      "Rabby",
      `https://go.rabby.io/mobile/?_cmd=open-dapp&dapp=${encodeURIComponent(location.href)}`,
    ],
    [
      "phantom",
      "Phantom",
      `https://phantom.app/ul/browse/${encodeURIComponent(location.href)}?ref=${encodeURIComponent(location.origin)}`,
    ],
  ];
  let rows = wallet.address
    ? `<p class="address">${wallet.address}</p>${button("Disconnect", "disconnect")}`
    : "";
  if (!wallet.address) {
    if (mobile)
      rows += urls
        .map(
          ([id, name, url]) =>
            `<a class="wallet-row" href="${attr(url)}"><img src="./assets/wallet-${id}.svg" alt="" width="28" height="28"><span>Open in ${name}</span></a>`,
        )
        .join("");
    for (const [uuid, d] of wallet.discoveries) {
      const icon = d.info.icon?.startsWith("data:image/")
        ? `<img src="${attr(d.info.icon)}" alt="" width="28" height="28">`
        : browserIcon;
      rows += `<button class="wallet-row" data-wallet="${attr(uuid)}" ${wallet.pending ? "disabled" : ""}>${icon}<span>${esc(d.info.name)}${wallet.pending === d.info.rdns ? " · opening…" : ""}</span></button>`;
    }
    if (!wallet.discoveries.size && wallet.injected)
      rows += `<button class="wallet-row" data-wallet="browser" ${wallet.pending ? "disabled" : ""}>${browserIcon}Browser wallet</button>`;
    rows += `<button class="wallet-row" data-wallet="coinbase" ${wallet.pending ? "disabled" : ""}>${coinbaseIcon}<span>Coinbase Smart Wallet${wallet.pending === "coinbase" ? " · opening…" : ""}</span></button>`;
    if (!wallet.injected && !mobile)
      rows +=
        '<p class="small-text muted">No browser wallet detected. Use Smart Wallet, or open this page inside your wallet app.</p>';
  }
  $("#wallet-options").innerHTML = rows;
  $("#wallet-note").textContent = wallet.note;
}
function toast(id: string, text: string, hash?: string, error = false) {
  toasts.set(id, { text, hash, error });
  renderToasts();
}
function renderToasts() {
  $("#toasts").innerHTML =
    (toasts.size
      ? '<div class="toast-controls"><span>Transactions</span><button class="text-button" data-dismiss-all>Dismiss all notifications</button></div>'
      : "") +
    [...toasts]
      .reverse()
      .map(
        ([id, t]) =>
          `<div class="toast"><p class="${t.error ? "down" : ""}">${esc(t.text)}</p><button class="icon-button" data-dismiss="${attr(id)}" aria-label="Dismiss notification">×</button>${t.hash ? `<a href="${config.explorer}/tx/${t.hash}" target="_blank" rel="noopener noreferrer">View transaction ↗</a>` : ""}</div>`,
      )
      .join("");
}
function review(label: string, description: string, fn: () => Promise<void>) {
  if (workflowAccount || busy) {
    toast("busy", "Finish the pending transaction first.");
    return;
  }
  if (!wallet.address) {
    showWallet();
    return;
  }
  if (!wallet.correct) {
    void wallet
      .switchChain()
      .catch((e) => toast("network", errorText(e), undefined, true));
    return;
  }
  const expected = wallet.address;
  transactionFocus =
    (document.activeElement as HTMLElement)?.getAttribute("data-action") || "";
  pendingConfirm = async () => {
    if (!same(expected, wallet.address))
      throw new Error("Wallet changed. Review the transaction again.");
    if (!fresh())
      throw new Error("Chain data is stale. Refresh before sending.");
    workflowAccount = expected;
    render();
    try {
      await fn();
    } finally {
      workflowAccount = "";
      render();
    }
  };
  $("#tx-title").textContent = label;
  $("#tx-review").innerHTML =
    `<p>${description}</p><dl class="metrics">${stat("Network", "Robinhood Chain · 4663")}${stat("From", short(expected))}</dl><p class="help">Network gas is additional. Review the destination and amount in your wallet.</p><br>`;
  $<HTMLDialogElement>("#tx-dialog").showModal();
}
async function send(
  name: string,
  contract: Contract,
  method: string,
  args: any[] = [],
  value = 0n,
) {
  if (busy) throw new Error("Wait for the current transaction to finish.");
  busy = name;
  render();
  let hash = "";
  const id = "tx-" + Date.now();
  try {
    if (workflowAccount && !same(workflowAccount, wallet.address))
      throw new Error("Wallet changed. Start a new transaction review.");
    await chain.verify();
    const signer = await wallet.signer();
    const c = contract.connect(signer) as Contract;
    const options = value ? { value } : {};
    await c[method].staticCall(...args, options);
    toast(id, `${name}: confirm in your wallet.`);
    const tx = await c[method](...args, options);
    hash = tx.hash;
    toast(id, `${name}: submitted. Waiting for confirmation.`, hash);
    const receipt = await tx.wait(1, 180000);
    if (!receipt || receipt.status !== 1)
      throw new Error("Transaction reverted.");
    toast(id, `${name}: confirmed.`, hash);
    return receipt;
  } catch (e) {
    const err = e as any;
    if (
      err?.code === "TRANSACTION_REPLACED" &&
      !err.cancelled &&
      err.receipt?.status === 1
    ) {
      hash = err.replacement?.hash || hash;
      toast(id, `${name}: replacement confirmed.`, hash);
      return err.receipt;
    }
    toast(id, `${name}: ${errorText(e)}`, hash || undefined, true);
    throw e;
  } finally {
    busy = "";
    await refresh();
  }
}
async function gameContract() {
  if (!snapshot?.game) throw new Error("Choose a registered game first.");
  const g = snapshot.game;
  await chain.verifyLaunch(g.id);
  return chain.contract(g.game, "PadGame");
}
function gameAction(
  method: string,
  label: string,
  description: string,
  args: any[] = [],
  value = 0n,
) {
  const selected = snapshot?.game?.id;
  review(label, description, async () => {
    if (snapshot?.game?.id !== selected)
      throw new Error("The selected game changed. Review again.");
    await send(label, await gameContract(), method, args, value);
  });
}
async function refresh() {
  if (reading || !chain) return;
  clearTimeout(pollTimer);
  reading = true;
  const account = wallet.address,
    selected = gameId;
  try {
    const next = await chain.read(account, selected);
    if (account !== wallet.address || selected !== gameId) return;
    const before = snapshot?.game;
    const after = next.game;
    const previousImp = before?.imps.find((i) => i.seat === before.mySeat);
    const nextImp = after?.imps.find((i) => i.seat === after.mySeat);
    if (
      before &&
      after &&
      before.id === after.id &&
      previousImp?.pendingRoll &&
      previousImp.pendingRoll !== nextImp?.pendingRoll
    ) {
      // Resolve the die from a view immediately, even while historical logs catch up.
      try {
        const rollId = previousImp.pendingRoll - 1;
        const resolved = await chain
          .contract(after.game, "PadGame")
          .getRoll(rollId, { blockTag: next.block });
        if (resolved.resolved) {
          dieValue =
            Number(resolved.delta) > 0
              ? "+" + resolved.delta
              : String(resolved.delta);
          dieTumbleUntil = Date.now() + 900;
          animatedRolls.add(`${after.game.toLowerCase()}:${rollId}`);
        }
      } catch {
        /* The event scanner can still supply this result. */
      }
    }
    if (account !== wallet.address || selected !== gameId) return;
    snapshot = next;
    rpcError = "";
    loading = false;
    render();
    void chain.scan(next.launches, next.block, () => {
      detectRoll();
      if (["game", "king", "burn"].includes(route)) render();
    });
  } catch (e) {
    rpcError = errorText(e);
    loading = false;
    render();
  } finally {
    reading = false;
    pollTimer = window.setTimeout(refresh, config.pollInterval);
  }
}
function detectRoll() {
  if (!snapshot?.game) return;
  for (const e of chain.events) {
    if (
      e.name !== "Resolved" ||
      !same(e.address, snapshot.game.game) ||
      seenResolved.has(e.key)
    )
      continue;
    seenResolved.add(e.key);
    if (Number(e.args.imp) + 1 === snapshot.game.mySeat) {
      const rollKey = `${e.address.toLowerCase()}:${e.args.roll}`;
      if (animatedRolls.has(rollKey)) continue;
      animatedRolls.add(rollKey);
      dieValue =
        Number(e.args.delta) > 0 ? "+" + e.args.delta : String(e.args.delta);
      if (e.block >= snapshot.block - 5) dieTumbleUntil = Date.now() + 900;
    }
  }
}
function navigate() {
  const path = location.hash.replace(/^#\/?/, "").split("/");
  route = [
    "launch",
    "king",
    "burn",
    "keeper",
    "owner",
    "rules",
    "game",
  ].includes(path[0])
    ? path[0]
    : "pad";
  gameId = route === "game" ? Number(path[1]) : route === "keeper" ? gameId : 0;
  if (route === "game" && (!Number.isSafeInteger(gameId) || gameId < 1))
    gameId = -1;
  if (route === "pad") gameId = 0;
  trade.quote = 0n;
  document.title =
    route === "pad"
      ? "PvP Pad · Roll. Rise. Risk it."
      : `${route[0].toUpperCase() + route.slice(1)} · PvP Pad`;
  render();
  window.scrollTo({ top: 0 });
  void refresh();
}
async function quoteTrade() {
  if (!snapshot?.game || snapshot.game.status !== 5)
    throw new Error("Choose a graduated coin.");
  const g = snapshot.game;
  const amount = parseEther(trade.amount);
  if (amount <= 0n || amount >= 1n << 128n)
    throw new Error("Enter a positive supported amount.");
  const bps = slippageBps(trade.slippage);
  minOutput(1n, bps);
  trade.loading = true;
  trade.quote = 0n;
  trade.error = "";
  render();
  const revision = {
    amount: trade.amount,
    slippage: trade.slippage,
    buy: trade.buy,
    game: g.id,
  };
  try {
    const key = Array.from(await chain.liquidity.poolKey(g.token));
    const hook = await chain.pad.hook();
    if (!validPool(key, g.token, hook))
      throw new Error("Pool key does not match the verified pad.");
    const quoter = new Contract(config.Quoter, QUOTER_ABI, chain.provider);
    const [out] = await quoter.quoteExactInputSingle.staticCall({
      poolKey: key,
      zeroForOne: trade.buy,
      exactAmount: amount,
      hookData: "0x",
    });
    if (out <= 0n) throw new Error("No output available for this amount.");
    if (
      revision.amount !== trade.amount ||
      revision.slippage !== trade.slippage ||
      revision.buy !== trade.buy ||
      revision.game !== snapshot?.game?.id
    )
      return;
    trade.quote = out;
    trade.min = minOutput(out, bps);
    if (trade.min <= 0n)
      throw new Error("Amount is too small for a protected quote.");
    trade.at = Date.now();
    trade.game = g.id;
    trade.key = Array.from(key);
    trade.input = amount;
  } catch (e) {
    trade.error = errorText(e);
  } finally {
    trade.loading = false;
    render();
  }
}
function executeTrade() {
  const g = snapshot?.game;
  if (!g) return;
  const q = { ...trade, key: [...trade.key] };
  if (q.game !== g.id || Date.now() - q.at >= 30000 || !q.quote) {
    trade.error = "Quote expired. Get a fresh quote.";
    render();
    return;
  }
  review(
    q.buy ? "Buy " + esc(g.ticker) : "Sell " + esc(g.ticker),
    `Spend ${esc(q.amount)} ${q.buy ? "ETH" : esc(g.ticker)}. Receive at least ${formatEther(q.min)} ${q.buy ? esc(g.ticker) : "ETH"}. ${q.buy ? "" : "Two exact-amount approvals may be requested before the swap; approve each in your wallet."}`,
    async () => {
      await chain.verifyLaunch(g.id);
      const token = chain.contract(g.token, "PadToken");
      if (!q.buy) {
        if ((await token.balanceOf(wallet.address)) < q.input)
          throw new Error("Token balance is too low.");
        if ((await token.allowance(wallet.address, config.Permit2)) < q.input)
          await send("Approve token to Permit2", token, "approve", [
            config.Permit2,
            q.input,
          ]);
        const permit = new Contract(config.Permit2, PERMIT_ABI, chain.provider);
        const allowance = await permit.allowance(
          wallet.address,
          g.token,
          config.UniversalRouter,
        );
        if (
          allowance.amount < q.input ||
          Number(allowance.expiration) < now() + 300
        )
          await send("Approve router in Permit2", permit, "approve", [
            g.token,
            config.UniversalRouter,
            q.input,
            Math.floor(now()) + 1800,
          ]);
      }
      // Approvals can take time: refresh the quote before submitting; preserve the reviewed minimum.
      const quoter = new Contract(config.Quoter, QUOTER_ABI, chain.provider);
      const [freshOut] = await quoter.quoteExactInputSingle.staticCall({
        poolKey: q.key,
        zeroForOne: q.buy,
        exactAmount: q.input,
        hookData: "0x",
      });
      if (freshOut < q.min)
        throw new Error(
          "Price moved below your reviewed minimum. Get a fresh quote.",
        );
      const encoded = swapEncoding(
        q.key,
        q.buy,
        q.input,
        q.min,
        config.extendedSwapParams,
      );
      const router = new Contract(
        config.UniversalRouter,
        ROUTER_ABI,
        chain.provider,
      );
      await send(
        q.buy ? "Buy coin" : "Sell coin",
        router,
        "execute",
        [encoded.commands, encoded.inputs, Math.floor(now()) + 300],
        encoded.value,
      );
      trade.quote = 0n;
      trade.amount = "";
      render();
    },
  );
}
async function mine() {
  if (!canOpen() || !fresh()) return;
  mineBusy = true;
  salt = "";
  hookAddress = "";
  mineStatus = "Reading the hook init-code hash…";
  render();
  try {
    const hash = await chain.liquidity.hookInitCodeHash();
    if (!mineBusy) return;
    saltWorker?.terminate();
    saltWorker = new Worker(new URL("./salt-worker.js", document.baseURI), {
      type: "module",
    });
    saltWorker.onmessage = async (e) => {
      if (e.data.error) {
        mineStatus = e.data.error;
        mineBusy = false;
        render();
        return;
      }
      mineStatus = `Tried ${Number(e.data.attempts).toLocaleString()} salts.`;
      if (e.data.salt) {
        saltWorker?.terminate();
        try {
          const actual = await chain.liquidity.hookAddressFor(e.data.salt);
          if (
            !same(actual, e.data.address) ||
            (BigInt(actual) & 0x3fffn) !== 0x2000n
          )
            throw new Error("The chain rejected the mined hook address.");
          salt = e.data.salt;
          hookAddress = actual;
          mineStatus = `Valid salt found after ${Number(e.data.attempts).toLocaleString()} tries. Confirmed by hookAddressFor.`;
        } catch (err) {
          mineStatus = errorText(err);
        }
        mineBusy = false;
      }
      render();
    };
    saltWorker.onerror = () => {
      mineBusy = false;
      mineStatus = "Salt worker failed. Retry mining.";
      render();
    };
    saltWorker.postMessage({
      deployer: config.PadLiquidity,
      initCodeHash: hash,
    });
  } catch (e) {
    mineBusy = false;
    mineStatus = errorText(e);
    render();
  }
}
const actions: Record<string, () => void | Promise<void>> = {
  connect: showWallet,
  switch: async () => wallet.switchChain(),
  disconnect: async () => {
    await wallet.disconnect();
    $<HTMLDialogElement>("#wallet-dialog").close();
  },
  refresh,
  enter: () =>
    gameAction(
      "enter",
      "Enter raffle",
      "Pay exactly 0.001 ETH. The entry is nonrefundable and funds PvP burns. A seat is not guaranteed above 200 entries.",
      [],
      ENTRY,
    ),
  draw: () =>
    gameAction(
      "draw",
      "Draw seats",
      "Advance up to 32 raffle trials. This transaction costs gas.",
      [32],
    ),
  roll: () =>
    gameAction(
      "roll",
      "Roll your Imp",
      "Pay exactly 0.002 ETH. Receive the curve token allocation and commit a roll. Reveal after 3 completed L2 blocks.",
      [],
      ROLL,
    ),
  reveal: () =>
    gameAction(
      "resolvePending",
      "Reveal pending rolls",
      "Resolve up to 8 pending rolls in queue order. Your roll may need another call if a backlog exists.",
      [8],
    ),
  finalize: () =>
    gameAction(
      "finalize",
      "Finalize game",
      "Rank living Imps and pay the pot. Your caller fee is 0.5%, capped at 0.005 ETH and roll earnings.",
    ),
  graduate: () =>
    gameAction(
      "graduate",
      "Graduate coin",
      "Move curve ETH and remaining tokens into locked Uniswap v4 liquidity. A game with no curve ETH fails.",
    ),
  poke: () =>
    gameAction(
      "poke",
      "Poke game",
      "Advance permissionless game maintenance and bounded pad upkeep. Network gas applies.",
    ),
  "claim-game": () =>
    gameAction(
      "claim",
      "Claim payout",
      "Withdraw your parked game payout to the connected wallet.",
    ),
  restart: () =>
    review(
      "Restart PvP",
      "Create a new PvP genesis after the current genesis failed.",
      async () => {
        await send("Restart PvP", chain.pad, "restartGenesis");
        location.hash = "#/";
      },
    ),
  distribute: () =>
    review(
      "Collect fees",
      "Collect fees from at most 8 pools and pay the current king.",
      async () => {
        await send("Collect fees", chain.liquidity, "distribute", [8]);
      },
    ),
  burn: () =>
    review(
      "Burn a chunk",
      "Spend up to 0.02 ETH from the burn bucket to buy and destroy PvP, subject to the contract’s price limit.",
      async () => {
        await send("Burn a chunk", chain.liquidity, "burnChunk");
      },
    ),
  "claim-king": () =>
    review(
      "Claim crown payment",
      "Withdraw the crown contract’s parked payment to your wallet.",
      async () => {
        await send("Claim crown payment", chain.king, "claim");
      },
    ),
  "claim-liquidity": () =>
    review(
      "Claim liquidity fees",
      "Withdraw PadLiquidity’s parked fees to your wallet.",
      async () => {
        await send("Claim liquidity fees", chain.liquidity, "claim");
      },
    ),
  "trade-buy": () => {
    trade.buy = true;
    trade.quote = 0n;
    trade.error = "";
    render();
  },
  "trade-sell": () => {
    trade.buy = false;
    trade.quote = 0n;
    trade.error = "";
    render();
  },
  swap: executeTrade,
  mine,
  "stop-mine": () => {
    saltWorker?.terminate();
    mineBusy = false;
    mineStatus = "Mining stopped. Start again when ready.";
    render();
  },
  "open-pad": () => {
    const selected = salt;
    review(
      "Open PvP Pad",
      "Open the pad permanently and create the PvP genesis token and game using the verified hook salt.",
      async () => {
        if (!canOpen() || !selected)
          throw new Error("Opening access is no longer available.");
        const actual = await chain.liquidity.hookAddressFor(selected);
        if (
          !same(actual, hookAddress) ||
          (BigInt(actual) & 0x3fffn) !== 0x2000n
        )
          throw new Error("Hook verification failed.");
        await send("Open pad", chain.pad, "openPad", [selected]);
        location.hash = "#/";
      },
    );
  },
  "clear-filter": () => {
    filter = "all";
    render();
  },
};
document.addEventListener("click", async (e) => {
  const target = (e.target as Element).closest<HTMLElement>("button,a");
  if (!target) return;
  if (target.classList.contains("skip")) {
    e.preventDefault();
    $("#main").focus();
    $("#main").scrollIntoView({ block: "start" });
    return;
  }
  try {
    if (target.dataset.close) {
      $<HTMLDialogElement>("#" + target.dataset.close).close();
      return;
    }
    if (target.hasAttribute("data-dismiss-all")) {
      toasts.clear();
      renderToasts();
      return;
    }
    if (target.dataset.dismiss) {
      toasts.delete(target.dataset.dismiss);
      renderToasts();
      return;
    }
    if (target.dataset.wallet) {
      const id = target.dataset.wallet;
      if (id === "coinbase") await wallet.coinbase();
      else if (id === "browser" && wallet.injected)
        await wallet.connect(wallet.injected, "browser");
      else {
        const d = wallet.discoveries.get(id);
        if (d) await wallet.connect(d.provider, d.info.rdns);
      }
      return;
    }
    if (target.dataset.action === "filter") {
      filter = target.dataset.filter || "all";
      render();
      return;
    }
    if (target.dataset.action) {
      e.preventDefault();
      await actions[target.dataset.action]?.();
    }
  } catch (err) {
    toast("action-error", errorText(err), undefined, true);
  }
});
$("#connect").addEventListener("click", () => {
  if (wallet?.address && !wallet.correct)
    void wallet
      .switchChain()
      .catch((e) => toast("network", errorText(e), undefined, true));
  else if (wallet) showWallet();
});
$("#refresh").addEventListener("click", () => void refresh());
$("#tx-confirm").addEventListener("click", async () => {
  const fn = pendingConfirm;
  pendingConfirm = undefined;
  $<HTMLDialogElement>("#tx-dialog").close();
  try {
    await fn?.();
  } catch (e) {
    toast("action-error", errorText(e), undefined, true);
  }
});
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("close", () => {
    const target =
      dialog.id === "wallet-dialog"
        ? $("#connect")
        : transactionFocus
          ? document.querySelector<HTMLElement>(
              `[data-action="${CSS.escape(transactionFocus)}"]`,
            )
          : null;
    if (target) target.focus({ preventScroll: true });
  });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        dialog.close();
    }
  });
}
document.addEventListener("input", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.id.startsWith("launch-")) {
    draft[input.name as keyof typeof draft] = input.value;
    delete draftErrors[input.name];
    input.setAttribute("aria-invalid", "false");
    $("#" + input.name + "-error").textContent = "";
    $("#preview-name").textContent = draft.name || "Your coin name";
    $("#preview-ticker").textContent = draft.ticker || "Ticker";
    if (input.name === "image")
      $("#preview-art").innerHTML = safeImage(draft.image)
        ? `<img src="${attr(draft.image)}" alt="Coin image preview" referrerpolicy="no-referrer">`
        : impSVG(wallet.address || config.PvPPad, 128);
  }
  if (input.id === "trade-amount") {
    trade.amount = input.value;
    trade.quote = 0n;
  }
  if (input.id === "slippage") {
    trade.slippage = input.value;
    trade.quote = 0n;
  }
  if (["trade-amount", "slippage"].includes(input.id)) {
    const swap = $<HTMLButtonElement>('[data-action="swap"]');
    if (swap) swap.disabled = true;
  }
});
document.addEventListener("change", (e) => {
  const input = e.target as HTMLSelectElement;
  if (input.id === "keeper-game") {
    gameId = Number(input.value);
    void refresh();
  }
});
document.addEventListener("submit", async (e) => {
  const form = e.target as HTMLFormElement;
  if (!["launch-form", "trade-form", "crown-form"].includes(form.id)) return;
  e.preventDefault();
  try {
    if (form.id === "launch-form") {
      draftErrors = launchErrors(draft.name, draft.ticker, draft.image);
      if (Object.keys(draftErrors).length) {
        render();
        $("#launch-" + Object.keys(draftErrors)[0]).focus();
        return;
      }
      if (!snapshot?.genesisGraduated)
        throw new Error("PvP must graduate first.");
      const params = { ...draft };
      review(
        "Launch " + esc(params.ticker),
        `Create “${esc(params.name)}” (${esc(params.ticker)}) with a new game. Network gas applies.`,
        async () => {
          if (!(await chain.pad.genesisGraduated()))
            throw new Error("PvP has not graduated.");
          const receipt = await send("Launch coin", chain.pad, "launch", [
            params.name,
            params.ticker,
            params.image,
          ]);
          const event = receipt.logs
            .map((log: any) => {
              try {
                return chain.pad.interface.parseLog(log);
              } catch {
                return null;
              }
            })
            .find((log: any) => log?.name === "Launched");
          draft = { name: "", ticker: "", image: "" };
          if (route === "launch")
            location.hash = event ? `#/game/${event.args.id}` : "#/";
        },
      );
    } else if (form.id === "trade-form") await quoteTrade();
    else {
      const amount = parseEther($<HTMLInputElement>("#crown-bid").value);
      if (!snapshot || amount < snapshot.nextBid)
        throw new Error("Bid must meet the displayed minimum.");
      review(
        "Take the crown",
        `Bid ${eth(amount)} ETH. The previous king receives their bid back. The extra is allocated to games, burns and the developer.`,
        async () => {
          await send("Take crown", chain.king, "takeCrown", [], amount);
        },
      );
    }
  } catch (err) {
    if (form.id === "trade-form") {
      trade.error = errorText(err);
      render();
    } else if (form.id === "crown-form")
      $("#crown-error").textContent = errorText(err);
    else toast("form", errorText(err), undefined, true);
  }
});
window.addEventListener("hashchange", navigate);
async function start() {
  try {
    const responses = await Promise.all(
      ["config.json", "abi.json", "verification.json"].map(async (f) => {
        const r = await fetch(new URL("./" + f, document.baseURI));
        if (!r.ok) throw new Error(`Unable to load ${f}`);
        return r.json();
      }),
    );
    config = responses[0] as Config;
    chain = new Chain(
      config,
      responses[1] as ABIs,
      responses[2] as Verification,
    );
    wallet = new Wallet(config);
    wallet.onChange = () => {
      if (lastWallet !== wallet.address) {
        lastWallet = wallet.address;
        if (snapshot?.game) {
          snapshot.game.myEntry = 0;
          snapshot.game.mySeat = 0;
          snapshot.game.myTokens = 0n;
          snapshot.game.claimable = 0n;
        }
        if (snapshot) {
          snapshot.kingClaim = 0n;
          snapshot.liquidityClaim = 0n;
        }
        void refresh();
      }
      renderWallet();
      render();
    };
    navigate();
    window.setInterval(() => {
      document
        .querySelectorAll<HTMLElement>("[data-end]")
        .forEach(
          (e) => (e.textContent = remaining(Number(e.dataset.end), now())),
        );
      document
        .querySelectorAll<HTMLElement>("[data-elapsed]")
        .forEach(
          (e) =>
            (e.textContent = remaining(
              Math.floor(now() - Number(e.dataset.elapsed)),
              0,
            )),
        );
      renderStatus();
      if (snapshot && !fresh())
        document
          .querySelectorAll<HTMLButtonElement>("[data-action]")
          .forEach((b) => {
            if (
              ![
                "connect",
                "switch",
                "refresh",
                "filter",
                "clear-filter",
                "disconnect",
              ].includes(b.dataset.action || "")
            )
              b.disabled = true;
          });
    }, 1000);
  } catch (e) {
    $("#main").innerHTML =
      `<section class="empty"><h1>Unable to load the site</h1><p>${esc(errorText(e))}</p><button class="button primary" onclick="location.reload()">Reload</button></section>`;
    $("#sync-label").textContent = "Local asset failed to load.";
  }
}
void start();
