import type { InterfaceAbi } from "ethers";
export interface Config {
  chainId: number;
  rpc: string;
  fallbackRpc: string;
  explorer: string;
  deploymentBlock: number;
  pollInterval: number;
  logChunk: number;
  PvPPad: string;
  PadLiquidity: string;
  KingOfThePad: string;
  PoolManager: string;
  UniversalRouter: string;
  Quoter: string;
  StateView: string;
  Permit2: string;
  extendedSwapParams: boolean;
}
export type ABIs = Record<string, InterfaceAbi>;
export interface Imp {
  seat: number;
  owner: string;
  height: number;
  lastRoll: number;
  heightReachedAt: number;
  nonce: number;
  pendingRoll: number;
  heightRoll: number;
  alive: boolean;
}
export interface Launch {
  id: number;
  token: string;
  game: string;
  creator: string;
  createdAt: number;
  name: string;
  ticker: string;
  imageURL: string;
  status: number;
  entries: number;
  seats: number;
  signupEnd: number;
  hardEnd: number;
  endTime: number;
  pot: bigint;
  raised: bigint;
  price?: number;
  marketCap?: number;
  marketError?: string;
}
export interface Game extends Launch {
  imps: Imp[];
  playStart: number;
  draw: {
    entries: number;
    seated: number;
    target: number;
    commit: number;
    seeded: boolean;
    complete: boolean;
  };
  myEntry: number;
  mySeat: number;
  myTokens: bigint;
  claimable: bigint;
  quote: bigint;
  funded: bigint;
  bellRinger: string;
  bellRang: boolean;
  pendingCount: number;
  pendingCommit: number;
  rollPot: bigint;
  releaseCap: bigint;
}
export interface ChainEvent {
  key: string;
  address: string;
  name: string;
  args: Record<string, any>;
  block: number;
  index: number;
  hash: string;
}
export interface Snapshot {
  block: number;
  l2Block: number;
  timestamp: number;
  updated: number;
  opened: boolean;
  owner: string;
  deadline: number;
  genesisId: number;
  genesisGraduated: boolean;
  launches: Launch[];
  game?: Game;
  king: string;
  bid: bigint;
  crownedAt: number;
  nextBid: bigint;
  challengeAt: number;
  kingClaim: bigint;
  liquidityClaim: bigint;
  burnBucket: bigint;
  lastBurnAt: number;
  totalBurnedEth: bigint;
  poolCount: number;
}
export interface Verification {
  sourceCommit: string;
  contracts: Record<
    string,
    {
      address: string;
      abiHash: string;
      codeHash: string;
      masks: { start: number; length: number }[];
    }
  >;
}
export interface EIPProvider {
  request(args: { method: string; params?: any[] | object }): Promise<any>;
  on?(event: string, listener: (...args: any[]) => void): void;
  removeListener?(event: string, listener: (...args: any[]) => void): void;
  disconnect?(): Promise<void>;
}
export interface WalletInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}
