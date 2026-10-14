// Explicitly synthetic contract/RPC fixture. Never loaded by the production export.
import { readFile } from "node:fs/promises";
import { requireTool } from "../scripts/tools.mjs";
const {
  Interface,
  keccak256,
  toUtf8Bytes,
  toBeHex,
  parseEther,
  ZeroAddress,
  AbiCoder,
} = requireTool("ethers");
const config = JSON.parse(
  await readFile(new URL("../config.json", import.meta.url)),
);
const abis = JSON.parse(
  await readFile(new URL("../abi.json", import.meta.url)),
);
const verification = JSON.parse(
  await readFile(new URL("../verification.json", import.meta.url)),
);
export const ACCOUNT = "0x1111111111111111111111111111111111111111";
export const GAME = "0x2222222222222222222222222222222222222222";
export const TOKEN = "0x3333333333333333333333333333333333333333";
export const HOOK = "0x4444444444444444444444444444444444446000";
const key = [ZeroAddress, TOKEN, 10000, 200, HOOK];
const bytes32 = (x) => keccak256(toUtf8Bytes(String(x)));
const coder = AbiCoder.defaultAbiCoder();
const ext = {
  StateView: new Interface([
    "function getSlot0(bytes32 poolId) view returns(uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  ]),
  Quoter: new Interface([
    "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns(uint256 amountOut,uint256 gasEstimate)",
  ]),
  UniversalRouter: new Interface([
    "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
  ]),
  Permit2: new Interface([
    "function allowance(address owner,address token,address spender) view returns(uint160 amount,uint48 expiration,uint48 nonce)",
    "function approve(address token,address spender,uint160 amount,uint48 expiration)",
  ]),
};
export async function fixture() {
  const state = {
    phase: 1,
    opened: true,
    deadlineOffset: 3600,
    entries: 3,
    seats: 0,
    entered: false,
    block: config.deploymentBlock + 100,
    now: Math.floor(Date.now() / 1000),
    pending: false,
    commit: 0,
    rolled: false,
    resolved: false,
    entryOwner: ACCOUNT,
    chainId: 4663,
    genesisGraduated: false,
    owner: ACCOUNT,
    claim: parseEther("0.001"),
    count: 1,
    codeMismatch: false,
    rpcFailure: false,
    approveToken: false,
    approvePermit: false,
    txs: [],
    logs: [],
    reject: false,
    logRequests: [],
    mineSalt: "",
    drawn: 0,
  };
  const contracts = new Map(
    Object.entries(verification.contracts).map(([name, v]) => [
      v.address.toLowerCase(),
      name,
    ]),
  );
  contracts.set(GAME.toLowerCase(), "PadGame");
  contracts.set(TOKEN.toLowerCase(), "PadToken");
  for (const name of Object.keys(ext))
    contracts.set(config[name].toLowerCase(), name);
  const codes = {};
  for (const [name, v] of Object.entries(verification.contracts)) {
    const a = JSON.parse(
      await readFile(
        new URL(`../../out/${name}.sol/${name}.json`, import.meta.url),
      ),
    );
    codes[v.address.toLowerCase()] = a.deployedBytecode.object;
  }
  codes[GAME] =
    `0x363d3d373d3d3d363d73${verification.contracts.PadGame.address.slice(2)}5af43d82803e903d91602b57fd5bf3`;
  codes[TOKEN] =
    `0x363d3d373d3d3d363d73${verification.contracts.PadToken.address.slice(2)}5af43d82803e903d91602b57fd5bf3`;
  const interfaces = Object.fromEntries(
    Object.entries(abis).map(([k, v]) => [k, new Interface(v)]),
  );
  Object.assign(interfaces, ext);
  const imps = () =>
    Array.from(
      { length: state.phase === 7 ? state.drawn : state.phase <= 1 ? 0 : 5 },
      (_, i) => [
        i === 0 ? ACCOUNT : "0x" + (i + 5).toString(16).padStart(40, "0"),
        i === 0 ? (state.resolved ? 15 : 12) : [-18, 8, -4, 0][(i - 1) % 4],
        state.now - (i === 4 ? 601 : 70),
        100 + i,
        1,
        i === 0 && state.pending ? 1 : 0,
        1,
      ],
    );
  function values(name, method, args) {
    args = Array.from(args);
    const mine = String(args[0] || "").toLowerCase() === ACCOUNT.toLowerCase();
    if (name === "PvPPad") {
      const v = {
        opened: state.opened,
        owner: state.owner,
        openDeadline: state.now + state.deadlineOffset,
        genesisId: state.opened ? 1 : 0,
        genesisGraduated: state.genesisGraduated || state.phase === 5,
        launchCount: state.opened ? state.count : 0,
        liquidity: config.PadLiquidity,
        king: config.KingOfThePad,
        hook: HOOK,
        gameOf: GAME,
        tokenOf: TOKEN,
        getLaunch: [
          TOKEN,
          GAME,
          ACCOUNT,
          state.now - 100,
          "PvP genesis",
          "PVP",
          "",
        ],
      };
      return [v[method]];
    }
    if (name === "PadLiquidity") {
      const v = {
        poolManager: config.PoolManager,
        burnBucket: parseEther("0.05"),
        lastBurnAt: state.now - 1000,
        totalBurnedEth: parseEther("0.12"),
        poolCount: state.phase === 5 ? 1 : 0,
        claimable: mine ? state.claim : 0n,
        poolKey: key,
        hookInitCodeHash: bytes32("fixture hook init code"),
      };
      if (method === "hookAddressFor") {
        const { getCreate2Address } = requireTool("ethers");
        return [
          getCreate2Address(config.PadLiquidity, args[0], v.hookInitCodeHash),
        ];
      }
      return [v[method]];
    }
    if (name === "KingOfThePad") {
      const v = {
        king: ACCOUNT,
        bid: parseEther("0.02"),
        crownedAt: state.now - 4000,
        nextMinBid: parseEther("0.022"),
        challengeOpensAt: state.now - 400,
        claimable: mine ? state.claim : 0n,
      };
      return [v[method]];
    }
    if (name === "PadToken") {
      const v = {
        balanceOf: parseEther("5000"),
        totalSupply: parseEther("1000000000"),
        allowance: state.approveToken ? parseEther("1000") : 0n,
      };
      return [v[method]];
    }
    if (name === "PadGame") {
      const seats = imps();
      const v = {
        status: state.phase,
        entryCount: state.entries,
        impCount: seats.length,
        signupEnd: state.phase === 0 ? 0 : state.now + 300,
        hardEnd: state.now + 2400,
        endTime:
          state.phase >= 3 && state.phase !== 7
            ? state.now - 1
            : state.now + 530,
        pot: state.phase >= 4 && state.phase !== 7 ? 0n : parseEther("0.04"),
        ethRaised: parseEther("1.234"),
        playStart: state.now - 300,
        fundedPot: 0n,
        bellRinger: ZeroAddress,
        bellRang: false,
        pendingCount: state.pending ? 1 : 0,
        rollPot: parseEther("0.04"),
        fundedReleaseCap: parseEther("0.12"),
        entryOf: mine && state.entered ? 1 : 0,
        impOf: mine && state.phase >= 2 && state.phase !== 7 ? 1 : 0,
        claimable: mine ? state.claim : 0n,
        drawProgress: [
          state.entries,
          seats.length,
          Math.min(state.entries, 200),
          state.phase === 7 ? state.block - 8 : 0,
          true,
          state.phase >= 2 && state.phase !== 7,
        ],
        getImp: seats[Number(args[0])],
        isAlive: Number(args[0]) !== 4,
        getRoll: [
          0,
          1,
          state.commit,
          state.resolved,
          false,
          state.resolved ? 3 : 0,
        ],
        quote: [parseEther("123456.78"), parseEther("0.0018")],
      };
      return ["drawProgress", "quote"].includes(method)
        ? v[method]
        : [v[method]];
    }
    if (name === "StateView") return [BigInt(2 ** 96) * 10000n, 0, 0, 10000];
    if (name === "Quoter")
      return [
        args[0].zeroForOne ? parseEther("100") : parseEther("0.001"),
        120000n,
      ];
    if (name === "Permit2")
      return [
        state.approvePermit ? parseEther("1000") : 0n,
        state.now + 1800,
        0n,
      ];
    throw new Error("Unknown call " + name + "." + method);
  }
  function event(name, event, args, address, hash) {
    const iface = interfaces[name];
    const encoded = iface.encodeEventLog(iface.getEvent(event), args);
    const log = {
      address,
      topics: encoded.topics,
      data: encoded.data,
      blockNumber: toBeHex(state.block),
      blockHash: bytes32(state.block),
      transactionHash: hash,
      transactionIndex: "0x0",
      logIndex: toBeHex(state.logs.length),
      removed: false,
    };
    state.logs.push(log);
    return log;
  }
  const receipts = new Map();
  const transactions = new Map();
  function transaction(tx) {
    const name = contracts.get(tx.to.toLowerCase());
    const iface = interfaces[name];
    const decoded = iface.parseTransaction({ data: tx.data, value: tx.value });
    state.block++;
    const hash = bytes32("tx" + state.block);
    const method = decoded.name;
    state.txs.push({
      name,
      method,
      args: decoded.args,
      value: tx.value,
      to: tx.to,
      data: tx.data,
    });
    const logs = [];
    if (method === "enter") {
      state.entered = true;
      state.entries++;
      logs.push(event("PadGame", "Entered", [ACCOUNT, 1, false], GAME, hash));
    }
    if (method === "roll") {
      state.pending = true;
      state.commit = state.block;
      state.rolled = true;
      logs.push(
        event(
          "PadGame",
          "Rolled",
          [ACCOUNT, 0, 0, state.block, parseEther("123456")],
          GAME,
          hash,
        ),
      );
    }
    if (method === "resolvePending") {
      state.pending = false;
      state.resolved = true;
      logs.push(event("PadGame", "Resolved", [0, 0, 3, 15, false], GAME, hash));
    }
    if (method === "draw") {
      state.drawn = Math.min(state.entries, state.drawn + 32);
      if (state.drawn >= state.entries) state.phase = 2;
    }
    if (method === "finalize") state.phase = 4;
    if (method === "graduate") state.phase = 5;
    if (method === "claim") state.claim = 0n;
    if (method === "approve" && name === "PadToken") state.approveToken = true;
    if (method === "approve" && name === "Permit2") state.approvePermit = true;
    if (method === "launch") {
      state.count++;
      logs.push(
        event(
          "PvPPad",
          "Launched",
          [state.count, TOKEN, GAME, ACCOUNT, decoded.args[0], decoded.args[1]],
          config.PvPPad,
          hash,
        ),
      );
    }
    if (method === "openPad") state.opened = true;
    if (method === "restartGenesis") state.phase = 0;
    const common = {
      transactionHash: hash,
      blockHash: bytes32(state.block),
      blockNumber: toBeHex(state.block),
      transactionIndex: "0x0",
      from: ACCOUNT,
      to: tx.to,
      gasUsed: "0x186a0",
      cumulativeGasUsed: "0x186a0",
      effectiveGasPrice: "0x3b9aca00",
      status: "0x1",
      type: "0x2",
      logsBloom: "0x" + "0".repeat(512),
      logs,
    };
    receipts.set(hash, common);
    transactions.set(hash, {
      hash,
      blockHash: common.blockHash,
      blockNumber: common.blockNumber,
      transactionIndex: "0x0",
      from: ACCOUNT,
      to: tx.to,
      gas: "0x7a120",
      gasPrice: "0x3b9aca00",
      maxFeePerGas: "0x77359400",
      maxPriorityFeePerGas: "0x3b9aca00",
      input: tx.data,
      value: tx.value || "0x0",
      nonce: "0x0",
      chainId: "0x1237",
      type: "0x2",
      accessList: [],
      r: bytes32(1),
      s: bytes32(2),
      v: "0x0",
    });
    return hash;
  }
  async function rpc(r) {
    try {
      if (state.rpcFailure) throw new Error("Synthetic RPC failure");
      const p = r.params || [];
      let result;
      switch (r.method) {
        case "eth_chainId":
          result = toBeHex(state.chainId);
          break;
        case "net_version":
          result = String(state.chainId);
          break;
        case "eth_blockNumber":
          result = toBeHex(state.block);
          break;
        case "eth_getCode":
          result = state.codeMismatch
            ? "0x6000"
            : codes[p[0].toLowerCase()] || "0x60006000";
          break;
        case "eth_getBlockByNumber":
          result = {
            number: toBeHex(state.block),
            hash: bytes32(state.block),
            parentHash: bytes32(state.block - 1),
            timestamp: toBeHex(state.now),
            nonce: "0x0000000000000000",
            difficulty: "0x0",
            gasLimit: "0x1c9c380",
            gasUsed: "0x0",
            miner: ZeroAddress,
            extraData: "0x",
            transactions: [],
            baseFeePerGas: "0x3b9aca00",
          };
          break;
        case "eth_call": {
          const tx = p[0];
          if (
            tx.to.toLowerCase() === "0x0000000000000000000000000000000000000064"
          ) {
            result = coder.encode(["uint256"], [state.block]);
            break;
          }
          const name = contracts.get(tx.to.toLowerCase());
          const iface = interfaces[name];
          if (!iface) throw new Error("Unknown contract " + tx.to);
          const decoded = iface.parseTransaction({ data: tx.data });
          if (
            ["view", "pure"].includes(decoded.fragment.stateMutability) ||
            name === "Quoter"
          ) {
            const v = values(name, decoded.name, decoded.args);
            if (v.some((x) => x === undefined))
              throw new Error("Missing fixture " + name + "." + decoded.name);
            result = iface.encodeFunctionResult(decoded.fragment, v);
          } else
            result = ["launch", "restartGenesis"].includes(decoded.name)
              ? coder.encode(["uint256"], [state.count + 1])
              : decoded.name === "approve" && name === "PadToken"
                ? coder.encode(["bool"], [true])
                : "0x";
          break;
        }
        case "eth_getLogs":
          state.logRequests.push(p[0]);
          result = state.logs.filter(
            (l) =>
              Number(l.blockNumber) >= Number(p[0].fromBlock) &&
              Number(l.blockNumber) <= Number(p[0].toBlock) &&
              (!p[0].address ||
                []
                  .concat(p[0].address)
                  .some((a) => a.toLowerCase() === l.address.toLowerCase())),
          );
          break;
        case "eth_estimateGas":
          result = "0x7a120";
          break;
        case "eth_gasPrice":
        case "eth_maxPriorityFeePerGas":
          result = "0x3b9aca00";
          break;
        case "eth_getTransactionCount":
          result = "0x0";
          break;
        case "eth_getBalance":
          result = toBeHex(parseEther("10"));
          break;
        case "eth_sendTransaction":
          if (state.reject)
            return {
              id: r.id,
              jsonrpc: "2.0",
              error: { code: 4001, message: "User rejected" },
            };
          result = transaction(p[0]);
          break;
        case "eth_getTransactionReceipt":
          result = receipts.get(p[0]) || null;
          break;
        case "eth_getTransactionByHash":
          result = transactions.get(p[0]) || null;
          break;
        default:
          throw new Error("Unhandled RPC " + r.method);
      }
      return { jsonrpc: "2.0", id: r.id, result };
    } catch (e) {
      return {
        jsonrpc: "2.0",
        id: r.id,
        error: { code: -32000, message: e.message },
      };
    }
  }
  return { state, rpc, config, interfaces };
}
export async function injectWallet(page, chainId = 4663) {
  await page.addInitScript(
    ({ account, chainId }) => {
      const listeners = {};
      let chain = chainId;
      let connected = false;
      let seq = 0;
      const provider = {
        request: async ({ method, params }) => {
          if (method === "eth_requestAccounts") {
            connected = true;
            return [account];
          }
          if (method === "eth_accounts") return connected ? [account] : [];
          if (method === "eth_chainId") return "0x" + chain.toString(16);
          if (method === "wallet_switchEthereumChain") {
            if (chain !== 4663) {
              const e = new Error("Unknown chain");
              e.code = 4902;
              throw e;
            }
            return null;
          }
          if (method === "wallet_addEthereumChain") {
            chain = Number(params[0].chainId);
            for (const cb of listeners.chainChanged || [])
              cb(params[0].chainId);
            return null;
          }
          const result = await fetch(
            "https://rpc.mainnet.chain.robinhood.com",
            {
              method: "POST",
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: ++seq,
                method,
                params: params || [],
              }),
              headers: { "Content-Type": "application/json" },
            },
          ).then((r) => r.json());
          if (result.error) {
            const e = new Error(result.error.message);
            e.code = result.error.code;
            throw e;
          }
          return result.result;
        },
        on: (name, cb) => {
          listeners[name] = [...(listeners[name] || []), cb];
        },
        removeListener: (name, cb) => {
          listeners[name] = (listeners[name] || []).filter((v) => v !== cb);
        },
      };
      window.ethereum = provider;
      window.addEventListener("eip6963:requestProvider", () =>
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: {
              info: {
                uuid: "fixture",
                rdns: "test.fixture",
                name: "Fixture Wallet",
                icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
              },
              provider,
            },
          }),
        ),
      );
    },
    { account: ACCOUNT, chainId },
  );
}
