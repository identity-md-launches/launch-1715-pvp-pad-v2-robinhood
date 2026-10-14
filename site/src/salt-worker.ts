import { getCreate2Address, hexlify, randomBytes, toBeHex } from "ethers";
// Worker owns the CPU loop; no key, signing capability or RPC access is needed.
self.onmessage = (
  event: MessageEvent<{ deployer: string; initCodeHash: string }>,
) => {
  try {
    const { deployer, initCodeHash } = event.data;
    let candidate = BigInt(hexlify(randomBytes(32)));
    let attempts = 0;
    while (true) {
      const salt = toBeHex(candidate, 32);
      const address = getCreate2Address(deployer, salt, initCodeHash);
      attempts++;
      if ((BigInt(address) & 0x3fffn) === 0x2000n) {
        self.postMessage({ salt, address, attempts });
        break;
      }
      candidate = (candidate + 1n) % (1n << 256n);
      if (attempts % 2000 === 0) self.postMessage({ attempts });
    }
  } catch (e) {
    self.postMessage({ error: String(e) });
  }
};
