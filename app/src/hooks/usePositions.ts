import { mockPositions, type Position } from '#/data/mock'
import { isOptionsModeEnabled } from '#/config/optionsMode'
import { useOptionsContext } from '#/contexts/OptionsContext'
import { panelToPositions } from '#/adapters/optionsBoard'

export function usePositions(streamId?: string): Position[] {
  const optionsEnabled = isOptionsModeEnabled()
  const { board, isConnected } = useOptionsContext()

  if (optionsEnabled && isConnected && board) {
    return panelToPositions(board.panel, streamId)
  }

  if (optionsEnabled) return []

  return mockPositions
}
