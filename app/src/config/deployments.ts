import type { OptionsContractAddresses } from '@livestreak/options'

import localhost from '../../../packages/contracts/chains/evm/deployments/localhost.json'

type LocalhostScopes = {
  readonly protocol: {
    readonly contracts: {
      readonly marketRegistry: string
      readonly vault: string
      readonly stewardRegistry: string
      readonly treasury: string
      readonly lvstToken: string
    }
  }
  readonly wire: {
    readonly contracts: {
      readonly marketDriverProxy: string
    }
  }
  readonly streaming: {
    readonly contracts: {
      readonly dripsStreaming: string
    }
  }
  readonly aa: {
    readonly contracts: Record<string, string>
  }
}

const scopes = (localhost as { scopes: LocalhostScopes }).scopes

export const LOCALHOST_RPC_URL = (localhost as { rpc: string }).rpc

export const LOCALHOST_AA_CONTRACTS = scopes.aa.contracts

export function buildOptionsContractAddresses(): OptionsContractAddresses {
  return {
    marketRegistry: scopes.protocol.contracts.marketRegistry as `0x${string}`,
    vault: scopes.protocol.contracts.vault as `0x${string}`,
    marketDriver: scopes.wire.contracts.marketDriverProxy as `0x${string}`,
    stewardRegistry: scopes.protocol.contracts.stewardRegistry as `0x${string}`,
    treasury: scopes.protocol.contracts.treasury as `0x${string}`,
    lvstToken: scopes.protocol.contracts.lvstToken as `0x${string}`,
    dripsStreaming: scopes.streaming.contracts.dripsStreaming as `0x${string}`,
  }
}
