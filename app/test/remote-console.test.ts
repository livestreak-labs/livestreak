import { describe, expect, it } from 'vitest'
import { bridgeActionScope, type CallActionEnvelope, type FunctionDescriptor } from '@livestreak/schema'
import { coerceArgs, coerceField } from '../src/utils/auto-form-schema'
import { LocalMockTransport } from '../src/utils/remote-transport'
import { demoMockSeed } from '../src/utils/remote-mock-seed'
import { buildTree } from '../src/components/organisms/function-tree'

describe('auto-form coercion', () => {
  it('coerces scalars and reports required errors', () => {
    expect(coerceField({ type: 'number', required: true }, '42')).toEqual({ value: 42 })
    expect(coerceField({ type: 'integer' }, '3.5').error).toBeDefined()
    expect(coerceField({ type: 'string', required: true }, '   ').error).toBe('Required')
    expect(coerceField({ type: 'enum', required: true, values: ['a', 'b'] }, 'c').error).toBeDefined()
    expect(coerceField({ type: 'boolean' }, 'on')).toEqual({ value: true })
  })

  it('merges prefilled target ids and hides them from validation', () => {
    const schema: FunctionDescriptor['inputSchema'] = {
      type: 'object',
      properties: [
        { name: 'amountUSDC', help: '', value: { type: 'number', required: true } },
        { name: 'vaultId', help: '', value: { type: 'string', required: true } },
      ],
    }
    const res = coerceArgs(schema, { amountUSDC: '100' }, { vaultId: 'vault-01' })
    expect(res.ok).toBe(true)
    expect(res.values).toEqual({ vaultId: 'vault-01', amountUSDC: 100 })
  })
})

describe('LocalMockTransport (relayed call end-to-end)', () => {
  it('rejects a bad password', async () => {
    const t = new LocalMockTransport(demoMockSeed)
    await expect(t.redeem('demo', 'wrong')).rejects.toThrow()
  })

  it('only advertises in-scope functions, relays a call with package target, and patches the board', async () => {
    const t = new LocalMockTransport(demoMockSeed)
    let functions: readonly FunctionDescriptor[] = []
    let board: Record<string, unknown> = {}
    t.onFunctions((f) => (functions = f))
    t.onPatch((b) => (board = b))

    const session = await t.redeem('demo', 'streak')
    expect(session.grant.scopes).toContain(bridgeActionScope)
    await t.connect(session)

    const names = functions.map((f) => f.name)
    expect(names).toContain('fundVault')
    expect(names).not.toContain('pauseMarket')
    expect(functions.every((f) => f.id && f.package)).toBe(true)

    const optionsBoard = board.options as Record<string, unknown>
    const before = (optionsBoard['vault-01'] as { tvlUSDC: number }).tvlUSDC
    const envelope: CallActionEnvelope = {
      scope: bridgeActionScope,
      action: 'fundVault',
      args: { vaultId: 'vault-01', side: 'yes', amountUSDC: 500 },
    }
    const res = await t.send(envelope, 'options')
    expect(res.ok).toBe(true)
    const afterBoard = board.options as Record<string, unknown>
    expect((afterBoard['vault-01'] as { tvlUSDC: number }).tvlUSDC).toBe(before + 500)
  })

  it('refuses an out-of-scope action over the wire', async () => {
    const t = new LocalMockTransport(demoMockSeed)
    const session = await t.redeem('demo', 'streak')
    await t.connect(session)
    const res = await t.send({ scope: bridgeActionScope, action: 'pauseMarket', args: {} }, 'options')
    expect(res.ok).toBe(false)
  })

  it('stores per-package board slices', async () => {
    const t = new LocalMockTransport(demoMockSeed)
    let board: Record<string, unknown> = {}
    t.onPatch((b) => (board = b))
    const session = await t.redeem('demo', 'streak')
    await t.connect(session)
    expect(board.options).toBeDefined()
    expect(board.observe).toBeUndefined()
  })
})

describe('function tree visibility', () => {
  it('omits visible===false nodes from the rendered tree', () => {
    const optionsFns = demoMockSeed.functions.filter((f) => f.package === 'options')
    const { roots, childrenOf } = buildTree(optionsFns)
    const collectIds = (nodes: readonly FunctionDescriptor[]): string[] => {
      const out: string[] = []
      for (const n of nodes) {
        out.push(n.id)
        const kids = childrenOf.get(n.id) ?? []
        out.push(...collectIds(kids))
      }
      return out
    }
    const ids = collectIds(roots)
    expect(ids).not.toContain('options.action.hiddenProbe')
    expect(ids).toContain('options.action.fundVault')
  })
})
