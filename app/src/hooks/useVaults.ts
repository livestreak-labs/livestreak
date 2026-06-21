import { useState, useEffect } from 'react'
import { mockVaults, type Vault } from '#/data/mock'
import { isOptionsModeEnabled } from '#/config/optionsMode'
import { useOptionsContext } from '#/contexts/OptionsContext'
import { panelToVaults } from '#/adapters/optionsBoard'

export function useVaults(streamId?: string) {
  const optionsEnabled = isOptionsModeEnabled()
  const { board, isConnected } = useOptionsContext()
  const [vaults, setVaults] = useState<Vault[]>(mockVaults)

  useEffect(() => {
    if (optionsEnabled) return

    const interval = setInterval(() => {
      setVaults(prev => prev.map(v => {
        if (v.status !== 'open' && v.status !== 'hot') return v
        const drift = (Math.random() - 0.48) * 0.04
        return {
          ...v,
          noTotal: Math.max(10, v.noTotal + Math.random() * 4),
          yesTotal: Math.max(10, v.yesTotal + Math.random() * 2.5),
          multiplier: Math.max(1.05, +(v.multiplier + drift).toFixed(3)),
        }
      }))
    }, 2200)
    return () => clearInterval(interval)
  }, [optionsEnabled])

  if (optionsEnabled && isConnected && board) {
    return panelToVaults(board.panel, streamId)
  }

  if (optionsEnabled) {
    return []
  }

  return vaults
}
