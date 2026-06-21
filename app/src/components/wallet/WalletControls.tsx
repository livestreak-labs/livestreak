import { ChainSelector } from '#/components/wallet/ChainSelector'
import { ConnectButton } from '#/components/wallet/ConnectButton'

export function WalletControls() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <ChainSelector />
      <ConnectButton />
    </div>
  )
}
