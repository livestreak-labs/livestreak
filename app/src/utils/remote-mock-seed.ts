// A self-contained mock bridge seed driving LocalMockTransport in dev/tests. It mimics
// what the options bridge would advertise as `FunctionDescriptor`s (grouped by target),
// each with a real `inputSchema` so the auto-form renders genuine fields. One function
// is deliberately OUT of the granted scope to prove the in-scope-only rule.

import {
  bridgeActionScope,
  type CallActionEnvelope,
  type FunctionDescriptor,
} from '@livestreak/schema'
import type { MockBridgeSeed, RemoteBoard } from './remote-transport'

const fns: readonly FunctionDescriptor[] = [
  {
    id: 'options.vault.vault-01',
    package: 'options',
    nodeKind: 'group',
    name: 'vault-01',
    label: 'Vault 01',
    scope: bridgeActionScope,
    target: { kind: 'vault', vaultId: 'vault-01' },
    disabled: false,
    visible: true,
    order: 0,
  },
  {
    id: 'options.action.fundVault',
    parentId: 'options.vault.vault-01',
    package: 'options',
    nodeKind: 'action',
    name: 'fundVault',
    label: 'Fund Vault',
    scope: bridgeActionScope,
    target: { kind: 'vault', vaultId: 'vault-01', side: 'yes' },
    disabled: false,
    visible: true,
    order: 0,
    inputSchema: {
      type: 'object',
      properties: [
        {
          name: 'amountUSDC',
          help: 'USDC to add to the vault',
          value: { type: 'number', description: 'Amount (USDC)', required: true },
        },
        {
          name: 'memo',
          help: 'Optional note recorded with the deposit',
          value: { type: 'string', description: 'Memo' },
        },
      ],
    },
  },
  {
    id: 'options.action.setLanes',
    package: 'options',
    nodeKind: 'action',
    name: 'setLanes',
    label: 'Set Lanes',
    scope: bridgeActionScope,
    target: { kind: 'nft', tokenId: 'nft-7' },
    disabled: false,
    visible: true,
    order: 1,
    inputSchema: {
      type: 'object',
      properties: [
        {
          name: 'lane',
          help: 'Which payout lane to route through',
          value: { type: 'enum', description: 'Lane', required: true, values: ['fast', 'standard', 'slow'] },
        },
        {
          name: 'autoCompound',
          help: 'Re-stake yield automatically',
          value: { type: 'boolean', description: 'Auto-compound', default: true },
        },
      ],
    },
  },
  {
    id: 'options.action.stakeLvst',
    package: 'options',
    nodeKind: 'action',
    name: 'stakeLvst',
    label: 'Stake $LVST',
    scope: bridgeActionScope,
    target: { kind: 'lvst' },
    disabled: false,
    visible: true,
    order: 2,
    inputSchema: {
      type: 'object',
      properties: [
        {
          name: 'amount',
          help: 'Whole $LVST to stake',
          value: { type: 'integer', description: 'Amount ($LVST)', required: true },
        },
      ],
    },
  },
  {
    id: 'options.action.hiddenProbe',
    package: 'options',
    nodeKind: 'action',
    name: 'hiddenProbe',
    label: 'Hidden Probe',
    scope: bridgeActionScope,
    disabled: false,
    visible: false,
    order: 99,
  },
  {
    id: 'options.action.pauseMarket',
    package: 'options',
    nodeKind: 'action',
    name: 'pauseMarket',
    label: 'Pause Market',
    // Deliberately a DIFFERENT scope than the demo grant carries → must NOT render.
    scope: 'bridge:admin:market',
    target: { kind: 'market', marketId: 'market-01' },
    disabled: false,
    visible: true,
    inputSchema: {
      type: 'object',
      properties: [
        {
          name: 'reason',
          help: 'Why the market is being paused',
          value: { type: 'string', description: 'Reason', required: true },
        },
      ],
    },
  },
]

const initialBoard: RemoteBoard = {
  options: {
    'vault-01': { tvlUSDC: 12500, side: 'yes' },
    'nft-7': { lane: 'standard', autoCompound: true },
    lvst: { staked: 0 },
    calls: [] as string[],
  },
}

const apply = (board: RemoteBoard, envelope: CallActionEnvelope, target?: string): RemoteBoard => {
  const pkg = target ?? 'options'
  const pkgSlice = { ...((board[pkg] as Record<string, unknown>) ?? {}) }
  const args = (envelope.args ?? {}) as Record<string, unknown>
  if (envelope.action === 'fundVault') {
    const vault = (pkgSlice['vault-01'] as Record<string, unknown>) ?? {}
    const add = Number(args.amountUSDC) || 0
    pkgSlice['vault-01'] = { ...vault, tvlUSDC: (Number(vault.tvlUSDC) || 0) + add }
  } else if (envelope.action === 'setLanes') {
    pkgSlice['nft-7'] = { lane: args.lane, autoCompound: Boolean(args.autoCompound) }
  } else if (envelope.action === 'stakeLvst') {
    const lvst = (pkgSlice.lvst as Record<string, unknown>) ?? {}
    pkgSlice.lvst = { staked: (Number(lvst.staked) || 0) + (Number(args.amount) || 0) }
  }
  pkgSlice.calls = [...((pkgSlice.calls as string[]) ?? []), envelope.action]
  return { ...board, [pkg]: pkgSlice }
}

export const demoMockSeed: MockBridgeSeed = {
  sessionId: 'demo',
  password: 'streak',
  // Grant authorises action-scope functions only — NOT bridge:admin:market.
  grantScopes: [bridgeActionScope],
  functions: fns,
  board: initialBoard,
  apply,
}
