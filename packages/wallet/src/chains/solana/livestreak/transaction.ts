// Compose built instructions into a transaction message that WalletAccountSolana(.Gasless)
// .sendTransaction consumes directly: the account detects `.instructions`, fills in the
// recent-blockhash lifetime, and sets the fee-payer signer. Pass feePayer to pin it (the
// account asserts it matches the wallet); omit it to let the account attach its own.
import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayer,
  type Address,
  type Instruction,
} from '@solana/kit'

export function buildLivestreakTransaction(instructions: Instruction[], feePayer?: Address) {
  return pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => (feePayer ? setTransactionMessageFeePayer(feePayer, tx) : tx),
    (tx) => appendTransactionMessageInstructions(instructions, tx),
  )
}
