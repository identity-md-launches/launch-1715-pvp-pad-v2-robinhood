import { createCoinbaseWalletSDK } from "@coinbase/wallet-sdk";
export function createProvider(chainId: number) {
  return createCoinbaseWalletSDK({
    appName: "PvP Pad",
    appLogoUrl: new URL("./assets/favicon.svg", location.href).href,
    appChainIds: [chainId],
    preference: { options: "smartWalletOnly" },
  }).getProvider();
}
