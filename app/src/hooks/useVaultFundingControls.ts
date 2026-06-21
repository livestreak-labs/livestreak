import { isOptionsModeEnabled } from '#/config/optionsMode'
import { useOptionsContext } from '#/contexts/OptionsContext'

export function useVaultFundingControls(vaultId: string) {
  const optionsEnabled = isOptionsModeEnabled()
  const options = useOptionsContext()
  const useOptions = optionsEnabled && options.isConnected

  const fundYes = useOptions ? options.findFundFunction(vaultId, 'yes') : undefined
  const fundNo = useOptions ? options.findFundFunction(vaultId, 'no') : undefined
  const stopFn = useOptions ? options.findStopFundingFunction(vaultId) : undefined
  const activeFundedSide = stopFn && !stopFn.disabled && stopFn.target?.side
    ? stopFn.target.side
    : undefined

  return {
    useOptions,
    fundYes,
    fundNo,
    stopFn,
    activeFundedSide,
    stopFunding: options.stopFunding,
  }
}
