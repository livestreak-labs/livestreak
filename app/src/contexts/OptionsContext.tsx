import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { sha256, toBytes, hexToBytes, bytesToHex, type Address } from 'viem'
import { Schema } from 'effect'
import { EvmWalletInitConfig, type WalletInit } from '@livestreak/schema'
import {
  asTokenId,
  asVaultId,
  asMarketId,
  bridgeActionScope,
  createOptionsBridge,
  createOptionsRuntime,
  resolveOptionsAccountAddress,
  type BridgeCaller,
  type OptionsBoard,
  type OptionsBridge,
  type OptionsChainConfig,
  type OptionsRuntime,
  type TxId,
  type UserAddress,
} from '@livestreak/options'

import { HOST_BASE_URL, LOCAL_CHAIN_ID } from '#/config/host'
import {
  buildOptionsContractAddresses,
  LOCALHOST_AA_CONTRACTS,
  LOCALHOST_RPC_URL,
} from '#/config/deployments'
import { defaultOptionsMarketId, isOptionsModeEnabled } from '#/config/optionsMode'
import {
  findTokenIdForVault,
  fundDepositForRate,
  usdPerMinToChainRate,
} from '#/adapters/optionsBoard'

const STEALTH_DOMAIN = 'livestreak-stealth-v1'
const SESSION_SECRET_KEY = 'livestreak_stealth_secret'
const APP_CALLER = { id: 'app', trusted: true } satisfies BridgeCaller

interface AaChainDescriptor {
  chainId: number
  name: string
  entryPoint: string
  safeModule?: string
  bundlerPath: string
  rpcUrl?: string
}

interface AaCapabilityDescriptor {
  version: '0.1.0'
  paymasterPath: string
  chains: AaChainDescriptor[]
}

interface OptionsContextValue {
  enabled: boolean
  ready: boolean
  isConnected: boolean
  isLoading: boolean
  error: string | null
  address: Address | null
  usdcBalance: number
  board: OptionsBoard | null
  bridge: OptionsBridge | null
  connect: (password: string) => Promise<void>
  disconnect: () => void
  setActiveMarketId: (marketId: string | undefined) => void
  fundStream: (vaultId: string, side: 'yes' | 'no', rateUsdPerMin: number) => Promise<TxId>
}

const OptionsContext = createContext<OptionsContextValue | null>(null)

function buildWalletInit(descriptor: AaCapabilityDescriptor): WalletInit {
  const chain = descriptor.chains.find(c => c.chainId === LOCAL_CHAIN_ID)
  if (!chain) {
    throw new Error(`Host AA descriptor has no chain ${LOCAL_CHAIN_ID}`)
  }

  const aa = LOCALHOST_AA_CONTRACTS
  const chainKey = String(LOCAL_CHAIN_ID)
  const rpcUrl = chain.rpcUrl ?? LOCALHOST_RPC_URL

  const evmConfig = Schema.decodeUnknownSync(EvmWalletInitConfig)({
    chainId: LOCAL_CHAIN_ID,
    provider: rpcUrl,
    bundlerUrl: `${HOST_BASE_URL}${chain.bundlerPath}`,
    paymasterUrl: `${HOST_BASE_URL}${descriptor.paymasterPath}/local`,
    isSponsored: true,
    useNativeCoins: false,
    entryPointAddress: chain.entryPoint,
    safe4337ModuleAddress: chain.safeModule ?? aa.safe4337Module,
    safeModulesSetupAddress: aa.safeModuleSetup,
    safeModulesVersion: '0.3.0',
    contractNetworks: {
      [chainKey]: {
        safeSingletonAddress: aa.safeSingleton,
        safeProxyFactoryAddress: aa.safeProxyFactory,
        multiSendAddress: aa.multiSend,
        multiSendCallOnlyAddress: aa.multiSendCallOnly,
        fallbackHandlerAddress: aa.fallbackHandler,
        signMessageLibAddress: aa.signMessageLib,
        createCallAddress: aa.createCall,
        simulateTxAccessorAddress: aa.simulateTxAccessor,
      },
    },
  })

  return { chain: 'evm', seedSource: 'raw', config: evmConfig }
}

export function OptionsProvider({ children }: { children: ReactNode }) {
  const enabled = isOptionsModeEnabled()
  const [ready, setReady] = useState(!enabled)
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [address, setAddress] = useState<Address | null>(null)
  const [board, setBoard] = useState<OptionsBoard | null>(null)
  const [usdcBalance, setUsdcBalance] = useState(0)

  const walletInitRef = useRef<WalletInit | null>(null)
  const chainConfigRef = useRef<OptionsChainConfig | null>(null)
  const runtimeRef = useRef<OptionsRuntime | null>(null)
  const bridgeRef = useRef<OptionsBridge | null>(null)
  const pollingStopRef = useRef<(() => void) | null>(null)
  const boardUnsubRef = useRef<(() => void) | null>(null)
  const activeMarketIdRef = useRef<string | undefined>(defaultOptionsMarketId())

  const teardownRuntime = useCallback(() => {
    boardUnsubRef.current?.()
    boardUnsubRef.current = null
    pollingStopRef.current?.()
    pollingStopRef.current = null
    runtimeRef.current = null
    bridgeRef.current = null
    setBoard(null)
  }, [])

  const applyBoard = useCallback((next: OptionsBoard) => {
    setBoard(next)
    const usdc = next.panel.user.usdcBalanceUSDC
    if (usdc !== undefined) {
      setUsdcBalance(Number(BigInt(usdc)) / 1_000_000)
    }
  }, [])

  const refreshConnected = useCallback(async (user: UserAddress, marketId?: string) => {
    const runtime = runtimeRef.current
    const bridge = bridgeRef.current
    if (!runtime || !bridge) return

    await runtime.refreshUser(user, marketId ? asMarketId(marketId) : undefined)
    applyBoard(await bridge.readBoard(APP_CALLER))
  }, [applyBoard])

  const bootRuntime = useCallback(async (secret: Uint8Array, user: UserAddress) => {
    const walletInit = walletInitRef.current
    if (!walletInit) throw new Error('Options wallet config not loaded')

    teardownRuntime()

    const marketId = activeMarketIdRef.current
    const chainConfig: OptionsChainConfig = {
      walletInit,
      seed: secret,
      addresses: buildOptionsContractAddresses(),
      readRpcUrl: LOCALHOST_RPC_URL,
      includeProtocolSummary: true,
    }
    chainConfigRef.current = chainConfig

    const runtime = createOptionsRuntime({
      config: {
        runtimeId: 'app',
        user,
        refreshIntervalMs: 3_000,
        ...(marketId
          ? { marketIds: [asMarketId(marketId)], defaultMarketId: asMarketId(marketId) }
          : {}),
      },
      chainConfig,
    })
    const bridge = createOptionsBridge({ runtime })

    runtimeRef.current = runtime
    bridgeRef.current = bridge

    boardUnsubRef.current = bridge.subscribeBoard(APP_CALLER, applyBoard)
    pollingStopRef.current = runtime.startPolling().stop

    await refreshConnected(user, marketId)
  }, [applyBoard, refreshConnected, teardownRuntime])

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return

    let cancelled = false

    void (async () => {
      try {
        const res = await fetch(`${HOST_BASE_URL}/aa/descriptor`)
        if (!res.ok) throw new Error(`AA descriptor HTTP ${res.status}`)
        const descriptor = (await res.json()) as AaCapabilityDescriptor
        walletInitRef.current = buildWalletInit(descriptor)
        if (!cancelled) setReady(true)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setReady(true)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled || !ready || typeof window === 'undefined') return
    const cached = sessionStorage.getItem(SESSION_SECRET_KEY)
    if (!cached) return

    setIsLoading(true)
    void (async () => {
      try {
        const secret = hexToBytes(cached as `0x${string}`)
        const walletInit = walletInitRef.current
        if (!walletInit) return

        const chainConfig: OptionsChainConfig = {
          walletInit,
          seed: secret,
          addresses: buildOptionsContractAddresses(),
          readRpcUrl: LOCALHOST_RPC_URL,
        }
        const user = await resolveOptionsAccountAddress(chainConfig)
        setAddress(user as Address)
        setIsConnected(true)
        await bootRuntime(secret, user)
      } catch (err) {
        sessionStorage.removeItem(SESSION_SECRET_KEY)
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setIsLoading(false)
      }
    })()

    return () => teardownRuntime()
  }, [enabled, ready, bootRuntime, teardownRuntime])

  const connect = useCallback(async (password: string) => {
    if (!enabled) return
    if (!password.trim()) {
      setError('Password required')
      return
    }
    if (!walletInitRef.current) {
      setError('Options config not ready — is host running?')
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const secret = toBytes(sha256(toBytes(STEALTH_DOMAIN + password)))
      sessionStorage.setItem(SESSION_SECRET_KEY, bytesToHex(secret))

      const chainConfig: OptionsChainConfig = {
        walletInit: walletInitRef.current,
        seed: secret,
        addresses: buildOptionsContractAddresses(),
        readRpcUrl: LOCALHOST_RPC_URL,
      }
      const user = await resolveOptionsAccountAddress(chainConfig)
      setAddress(user as Address)
      setIsConnected(true)
      await bootRuntime(secret, user)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setIsConnected(false)
      setAddress(null)
      teardownRuntime()
    } finally {
      setIsLoading(false)
    }
  }, [enabled, bootRuntime, teardownRuntime])

  const disconnect = useCallback(() => {
    sessionStorage.removeItem(SESSION_SECRET_KEY)
    teardownRuntime()
    chainConfigRef.current = null
    setAddress(null)
    setIsConnected(false)
    setUsdcBalance(0)
    setError(null)
  }, [teardownRuntime])

  const setActiveMarketId = useCallback((marketId: string | undefined) => {
    activeMarketIdRef.current = marketId
    const user = address as UserAddress | null
    if (isConnected && user) {
      void refreshConnected(user, marketId)
    }
  }, [address, isConnected, refreshConnected])

  const fundStream = useCallback(async (
    vaultId: string,
    side: 'yes' | 'no',
    rateUsdPerMin: number,
  ): Promise<TxId> => {
    const bridge = bridgeRef.current
    const currentBoard = board
    if (!bridge || !currentBoard) {
      throw new Error('Options bridge not ready')
    }

    const tokenId = findTokenIdForVault(currentBoard.panel, vaultId)
    if (!tokenId) {
      throw new Error('No NFT for this market — mint before funding')
    }

    const chainRate = usdPerMinToChainRate(rateUsdPerMin)
    const txId = await bridge.callAction(APP_CALLER, {
      scope: bridgeActionScope,
      action: 'fund',
      args: {
        tokenId: asTokenId(BigInt(tokenId)),
        vaultId: asVaultId(vaultId),
        side,
        rate: chainRate,
        deposit: fundDepositForRate(chainRate),
      },
    })

    const user = address as UserAddress | null
    if (user) {
      await refreshConnected(user, activeMarketIdRef.current)
    }

    return txId
  }, [address, board, refreshConnected])

  const value = useMemo<OptionsContextValue>(() => ({
    enabled,
    ready,
    isConnected,
    isLoading,
    error,
    address,
    usdcBalance,
    board,
    bridge: bridgeRef.current,
    connect,
    disconnect,
    setActiveMarketId,
    fundStream,
  }), [
    enabled, ready, isConnected, isLoading, error, address, usdcBalance, board,
    connect, disconnect, setActiveMarketId, fundStream,
  ])

  return (
    <OptionsContext.Provider value={value}>
      {children}
    </OptionsContext.Provider>
  )
}

export function useOptionsContext(): OptionsContextValue {
  const ctx = useContext(OptionsContext)
  if (!ctx) throw new Error('useOptionsContext must be used within <OptionsProvider>')
  return ctx
}
