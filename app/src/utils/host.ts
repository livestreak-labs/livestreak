import type {
  AgentsData,
  HomepageData as HostHomepageData,
  HostCatalog,
  HostStreamDetail,
} from '@livestreak/host'
import type { Agent } from '#/types/demo'
import type { HomepageData } from '#/types/homepage'
import type { AppFixture } from '#/types/host-edge'

const CATALOG_PATH = '/catalog'

// Page-named discovery endpoints served by the host's DB read-model (agent-2). One fetch per
// page; these are the LIVE discovery source (the aggregate across ALL markets/chains), not the
// single-market options board.
const HOMEPAGE_PATH = '/homepage'
const AGENTS_PATH = '/agents'
const STREAM_PATH = '/stream'

export async function fetchHostCatalog(baseUrl: string): Promise<HostCatalog> {
  const res = await fetch(`${baseUrl}${CATALOG_PATH}`)
  if (!res.ok) {
    throw new Error(`Host catalog HTTP ${res.status}`)
  }
  return (await res.json()) as HostCatalog
}

/** GET /homepage -> the whole homepage payload (catalog rail + vault rails + protocol stats). */
export async function fetchHomepage(baseUrl: string): Promise<HostHomepageData> {
  const res = await fetch(`${baseUrl}${HOMEPAGE_PATH}`)
  if (!res.ok) {
    throw new Error(`Host homepage HTTP ${res.status}`)
  }
  return (await res.json()) as HostHomepageData
}

/** GET /agents -> the agents directory. */
export async function fetchAgents(baseUrl: string): Promise<AgentsData> {
  const res = await fetch(`${baseUrl}${AGENTS_PATH}`)
  if (!res.ok) {
    throw new Error(`Host agents HTTP ${res.status}`)
  }
  return (await res.json()) as AgentsData
}

export async function fetchHostStream(
  baseUrl: string,
  routeId: string,
): Promise<HostStreamDetail> {
  const res = await fetch(`${baseUrl}${STREAM_PATH}/${encodeURIComponent(routeId)}`)
  if (!res.ok) {
    throw new Error(`Host stream HTTP ${res.status}`)
  }
  return (await res.json()) as HostStreamDetail
}

/**
 * Project the host's discovery payload (raw `@livestreak/host` shapes) onto the app's homepage
 * CARD shapes. Shared by the LIVE host fetch (use-homepage-data) and the DEMO fixture
 * (parse-fixture) so both render identically — pure source swap. `resolvedVaults` /
 * `yesWinRatePct` are derived from the lifetime rail (the host stats payload omits them).
 */
export function hostHomepageToCards(d: HostHomepageData): HomepageData {
  const resolved = d.lifetimeVaults.length
  const yesWins = d.lifetimeVaults.filter(v => v.outcome === 'yes').length
  return {
    streams: d.streams.map(s => ({
      id: s.routeId,
      marketId: s.marketId,
      title: s.title,
      category: s.category,
      activeVaults: s.activeVaults ?? 0,
      totalPooled: s.totalPooled ?? 0,
      elapsed: s.elapsed ?? '',
      isLive: s.isLive,
    })),
    liveVaults: d.liveVaults.map(v => ({
      vaultId: v.id,
      streamId: v.streamId,
      streamTitle: v.streamTitle,
      option: v.option,
      multiplier: v.multiplier,
      totalPool: v.totalPool,
      status: v.status,
      expiresInSec: v.expiresIn,
    })),
    lifetimeVaults: d.lifetimeVaults.map(v => ({
      vaultId: v.id,
      option: v.option,
      streamTitle: v.streamTitle,
      outcome: v.outcome,
      totalPool: v.totalPool,
      resolvedAtMs: Date.now() - v.resolvedAgoMs,
    })),
    protocolStats: {
      totalVaults: d.protocolStats.totalVaults,
      totalVolume: d.protocolStats.totalVolume,
      activeStreams: d.protocolStats.activeStreams,
      resolvedVaults: resolved,
      yesWinRatePct: resolved > 0 ? Math.round((yesWins / resolved) * 100) : null,
    },
  }
}

/** Agents directory: live host fetch unwrapped to the row array. */
export async function fetchAgentRows(baseUrl: string): Promise<Agent[]> {
  const data = await fetchAgents(baseUrl)
  return [...data.agents]
}

/** Resolve catalog: demo fixture or live host. */
export async function resolveCatalog(
  baseUrl: string,
  demo: boolean,
  fixture: AppFixture,
): Promise<HostCatalog> {
  if (demo) return fixture.catalog
  return fetchHostCatalog(baseUrl)
}

/** Resolve stream header + watch URL: demo fixture or live host. */
export async function resolveStream(
  baseUrl: string,
  routeId: string,
  demo: boolean,
  fixture: AppFixture,
): Promise<HostStreamDetail> {
  if (demo) {
    const hit = fixture.streams[routeId] ?? fixture.catalog.streams.find(s => s.routeId === routeId)
    if (hit) {
      return 'watchUrl' in hit
        ? hit as HostStreamDetail
        : {
            routeId: hit.routeId,
            marketId: hit.marketId,
            title: hit.title,
            category: hit.category,
            isLive: hit.isLive,
            chain: hit.chain,
          }
    }
    const first = fixture.catalog.streams[0]
    if (!first) throw new Error('Demo fixture has no streams')
    return fixture.streams[first.routeId] ?? {
      routeId: first.routeId,
      marketId: first.marketId,
      title: first.title,
      category: first.category,
      isLive: first.isLive,
      chain: first.chain,
    }
  }
  return fetchHostStream(baseUrl, routeId)
}
