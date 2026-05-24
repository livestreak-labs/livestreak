export const defaultChains = [
  { name: "localhost", rpc: "http://127.0.0.1:8545" },
  {
    name: "arc-testnet",
    rpc: "https://rpc.testnet.arc.network",
    chainId: 5042002,
    currency: "USDC",
    explorer: "https://testnet.arcscan.app",
  },
] as const satisfies readonly { name: string; rpc: string; chainId?: number; currency?: string; explorer?: string }[];
