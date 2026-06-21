import type { OptionsPanel, OptionsVaultPanel } from '@livestreak/options'

import type { FlowState, Position, Vault } from '#/data/mock'

const USDC_SCALE = 1_000_000
const LVST_SCALE = 1_000_000_000_000_000_000

function usdcStringToNumber(value: string): number {
  return Number(BigInt(value)) / USDC_SCALE
}

function lvstStringToNumber(value: string): number {
  return Number(BigInt(value)) / LVST_SCALE
}

/** Map on-chain `hot` to `open` — hot UI is not wired from options yet. */
function mapVaultStatus(status: OptionsVaultPanel['status']): Vault['status'] {
  if (status === 'hot') return 'open'
  return status
}

function vaultMultiplier(vault: OptionsVaultPanel, side?: 'yes' | 'no'): number {
  if (side === 'no') return vault.odds.noMultiplier
  if (side === 'yes') return vault.odds.yesMultiplier
  return Math.max(vault.odds.yesMultiplier, vault.odds.noMultiplier)
}

function chainRateToUsdPerMin(rate: string): number {
  return (Number(BigInt(rate)) * 60) / USDC_SCALE
}

function marketsForStream(panel: OptionsPanel, streamId?: string) {
  if (!streamId) return panel.markets
  const filtered = panel.markets.filter(m => m.streamId === streamId)
  return filtered.length > 0 ? filtered : panel.markets
}

export function panelToVaults(panel: OptionsPanel, streamId?: string): Vault[] {
  const vaults: Vault[] = []

  for (const market of marketsForStream(panel, streamId)) {
    for (const vault of market.vaults) {
      const lane = panel.nfts
        .flatMap(n => n.lanes.map(l => ({ ...l, tokenId: n.tokenId })))
        .find(l => l.vaultId === vault.vaultId)

      const side = lane?.side
      const streamed = lane ? chainRateToUsdPerMin(lane.rate) : undefined

      vaults.push({
        id: vault.vaultId,
        option: vault.question,
        type: vault.type as Vault['type'],
        creator: vault.creator,
        noTotal: usdcStringToNumber(vault.pools.noUSDC),
        yesTotal: usdcStringToNumber(vault.pools.yesUSDC),
        status: mapVaultStatus(vault.status),
        hotUntil: null,
        createdAt: vault.timing.createdAtMs,
        expiresAt: vault.timing.expiresAtMs,
        outcome: vault.outcome,
        multiplier: vaultMultiplier(vault, side),
        ...(lane && side
          ? {
              userPosition: {
                side,
                streamed: streamed ?? 0,
                shares: usdcStringToNumber(lane.sharesAccrued),
                currentValue: lane.claimableUSDC
                  ? usdcStringToNumber(lane.claimableUSDC)
                  : 0,
              },
            }
          : {}),
        ...(vault.status === 'resolved' && lane?.won !== undefined
          ? {
              userWon: lane.won,
              payout: lane.claimableUSDC ? usdcStringToNumber(lane.claimableUSDC) : 0,
            }
          : {}),
      })
    }
  }

  return vaults
}

export function panelToFlow(panel: OptionsPanel): FlowState {
  const lvst = panel.lvst
  const balance = lvstStringToNumber(lvst.balanceLVST)
  const staked = lvstStringToNumber(lvst.stakedLVST)
  return {
    balance,
    staked,
    pendingDividends: usdcStringToNumber(lvst.pendingDividendsUSDC),
    totalEarned: lvst.totalEarnedLVST
      ? lvstStringToNumber(lvst.totalEarnedLVST)
      : balance + staked,
    apy: 14.2,
  }
}

export function panelToPositions(panel: OptionsPanel, streamId?: string): Position[] {
  const positions: Position[] = []
  const vaultById = new Map<string, OptionsVaultPanel>()

  for (const market of marketsForStream(panel, streamId)) {
    for (const vault of market.vaults) {
      vaultById.set(vault.vaultId, vault)
    }
  }

  for (const nft of panel.nfts) {
    for (const lane of nft.lanes) {
      const vault = vaultById.get(lane.vaultId)
      if (!vault) continue
      const streamRate = chainRateToUsdPerMin(lane.rate)
      positions.push({
        vaultId: lane.vaultId,
        option: vault.question,
        side: lane.side,
        streamed: streamRate,
        streamRate,
        shares: usdcStringToNumber(lane.sharesAccrued),
        currentValue: lane.claimableUSDC ? usdcStringToNumber(lane.claimableUSDC) : 0,
        pnl: 0,
        resolved: vault.status === 'resolved',
        ...(lane.won !== undefined ? { won: lane.won } : {}),
        ...(lane.claimableUSDC ? { payout: usdcStringToNumber(lane.claimableUSDC) } : {}),
        minute: Math.max(0, Math.floor((Date.now() - vault.timing.createdAtMs) / 60_000)),
      })
    }
  }

  return positions
}

/** Default fund window shown in the streaming UI (minutes). */
export const DEFAULT_FUND_DURATION_MIN = 60

/** UI $/min → on-chain USDC atomic units per second (6 decimals). */
export function usdPerMinToChainRate(rateUsdPerMin: number): bigint {
  return BigInt(Math.max(1, Math.round((rateUsdPerMin * USDC_SCALE) / 60)))
}

/** deposit = chainRate (USDC/sec atomic) × durationSeconds */
export function fundDepositForDuration(chainRate: bigint, durationMinutes: number): bigint {
  const durationSeconds = BigInt(Math.max(1, Math.round(durationMinutes * 60)))
  return chainRate * durationSeconds
}

/** Total USDC commitment for display ($). */
export function fundCommitmentUsd(rateUsdPerMin: number, durationMinutes: number): number {
  return rateUsdPerMin * durationMinutes
}

export function findTokenIdForVault(panel: OptionsPanel, vaultId: string): string | undefined {
  for (const nft of panel.nfts) {
    if (nft.lanes.some(l => l.vaultId === vaultId)) return nft.tokenId
  }
  const market = panel.markets.find(m => m.vaults.some(v => v.vaultId === vaultId))
  if (!market) return undefined
  return panel.nfts.find(n => n.marketId === market.marketId)?.tokenId
}
