import { BrowserProvider, getAddress } from "ethers";
import type { Config, EIPProvider, WalletInfo } from "./types";
import { errorText, short } from "./math";
export class Wallet {
  address = "";
  chainId = 0;
  provider?: EIPProvider;
  browser?: BrowserProvider;
  discoveries = new Map<string, { info: WalletInfo; provider: EIPProvider }>();
  pending = "";
  note = "";
  onChange = () => {};
  private accountsListener = (accounts: string[]) => {
    this.address = accounts[0] ? getAddress(accounts[0]) : "";
    this.onChange();
  };
  private chainListener = (chain: string) => {
    this.chainId = Number(chain);
    if (this.provider) this.browser = new BrowserProvider(this.provider, "any");
    this.onChange();
  };
  private disconnectListener = () => {
    this.detach();
    this.address = "";
    this.onChange();
  };
  constructor(public config: Config) {
    window.addEventListener("eip6963:announceProvider", ((
      event: CustomEvent,
    ) => {
      const d = event.detail;
      if (!d?.info?.uuid || !d?.provider?.request) return;
      this.discoveries.set(d.info.uuid, d);
      this.onChange();
      if (this.saved() === d.info.rdns && !this.provider)
        void this.connect(d.provider, d.info.rdns, true);
    }) as EventListener);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(() => {
      if (this.saved() === "browser" && this.injected && !this.provider)
        void this.connect(this.injected, "browser", true);
      if (this.saved() === "coinbase" && !this.provider)
        void this.coinbase(true);
    }, 500);
  }
  get injected() {
    return (window as unknown as { ethereum?: EIPProvider }).ethereum;
  }
  get correct() {
    return this.chainId === this.config.chainId;
  }
  get label() {
    return this.address
      ? this.correct
        ? short(this.address)
        : "Add Robinhood Chain"
      : "Connect";
  }
  saved() {
    try {
      return localStorage.getItem("pvp-wallet");
    } catch {
      return null;
    }
  }
  private detach() {
    if (this.provider) {
      this.provider.removeListener?.("accountsChanged", this.accountsListener);
      this.provider.removeListener?.("chainChanged", this.chainListener);
      this.provider.removeListener?.("disconnect", this.disconnectListener);
    }
    this.provider = undefined;
    this.browser = undefined;
  }
  async connect(provider: EIPProvider, key: string, silent = false) {
    if (this.pending) return;
    this.pending = key;
    this.note = "";
    this.onChange();
    try {
      const accounts = await provider.request({
        method: silent ? "eth_accounts" : "eth_requestAccounts",
      });
      if (!accounts.length) return;
      const chain = await provider.request({ method: "eth_chainId" });
      this.detach();
      this.provider = provider;
      this.browser = new BrowserProvider(provider, "any");
      this.address = getAddress(accounts[0]);
      this.chainId = Number(chain);
      provider.on?.("accountsChanged", this.accountsListener);
      provider.on?.("chainChanged", this.chainListener);
      provider.on?.("disconnect", this.disconnectListener);
      try {
        localStorage.setItem("pvp-wallet", key);
      } catch {}
      document.querySelector<HTMLDialogElement>("#wallet-dialog")?.close();
    } catch (e) {
      if (!silent) this.note = errorText(e);
    } finally {
      this.pending = "";
      this.onChange();
    }
  }
  async coinbase(silent = false) {
    try {
      const mod = await import(
        /* @vite-ignore */ new URL("./vendor/coinbase.js", document.baseURI)
          .href
      );
      await this.connect(
        mod.createProvider(this.config.chainId),
        "coinbase",
        silent,
      );
    } catch (e) {
      this.note = errorText(e);
      this.onChange();
    }
  }
  async switchChain() {
    if (!this.provider) return;
    try {
      await this.provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x1237" }],
      });
    } catch (e: any) {
      if (e.code === 4902 || e?.data?.originalError?.code === 4902)
        await this.provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: "0x1237",
              chainName: "Robinhood Chain",
              nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
              rpcUrls: [this.config.rpc, this.config.fallbackRpc],
              blockExplorerUrls: [this.config.explorer],
            },
          ],
        });
      else throw e;
    }
    this.chainId = Number(
      await this.provider.request({ method: "eth_chainId" }),
    );
    this.onChange();
  }
  async disconnect() {
    const p = this.provider;
    this.detach();
    this.address = "";
    this.chainId = 0;
    try {
      localStorage.removeItem("pvp-wallet");
    } catch {}
    try {
      await p?.disconnect?.();
    } catch {}
    this.onChange();
  }
  async signer() {
    if (!this.provider || !this.address)
      throw new Error("Connect a wallet first.");
    if (
      Number(await this.provider.request({ method: "eth_chainId" })) !==
      this.config.chainId
    )
      throw new Error("Add Robinhood Chain before sending.");
    return new BrowserProvider(this.provider, "any").getSigner(this.address);
  }
}
