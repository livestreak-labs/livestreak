import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction } from '@mysten/sui/transactions'

import {
  ConfigurationError,
  WalletAccountSui,
  WalletManagerSui,
  createLocalGasStation,
  executeSponsoredTransaction,
  signSenderForSponsoredTransaction,
  verifySponsoredSignatures,
} from '@livestreak/wallet'

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const GOLDEN_SUI_ADDRESS =
  '0x5e93a736d04fbb25737aa40bee40171ef79f65fae833749e3c089fe7cc2161f1'

const SPONSOR_SEED = new Uint8Array(32).fill(9)
const sponsorKeypair = Ed25519Keypair.fromSecretKey(SPONSOR_SEED)
const GAS_PRICE = 1000n
const GAS_BUDGET = 5_000_000n

const GAS_COINS = [
  {
    objectId: '0x9999999999999999999999999999999999999999999999999999999999999999',
    version: '1',
    digest: '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi',
  },
]

function createOfflineClient(executeSpy = []) {
  return {
    getReferenceGasPrice: async () => GAS_PRICE,
    executeTransactionBlock: async (args) => {
      executeSpy.push(args)
      return {
        digest: 'offline-digest',
        effects: {
          gasUsed: { computationCost: '1000', storageCost: '0', storageRebate: '0' },
        },
      }
    },
  }
}

async function buildFixtureTransaction(client, senderAddress) {
  const tx = new Transaction()
  tx.transferObjects([tx.gas], senderAddress)
  const kindBytes = await tx.build({ client, onlyTransactionKind: true })
  return { tx, kindBytes }
}

describe('Sui sponsored transaction vectors', () => {
  it('manager getAccount(0) path matches golden address', async () => {
    const manager = new WalletManagerSui(TEST_MNEMONIC, {})
    const account = await manager.getAccount(0)
    assert.equal(account.path, "m/44'/784'/0'/0'/0'")
    assert.equal(await account.getAddress(), GOLDEN_SUI_ADDRESS)
  })

  it('attack 1 — divergent-bytes: both signatures verify against the same txBytes', async () => {
    const client = createOfflineClient()
    const account = await WalletAccountSui.at(TEST_MNEMONIC, "0'/0'/0'", { provider: client })
    const senderAddress = await account.getAddress()
    const { kindBytes } = await buildFixtureTransaction(client, senderAddress)

    const gasStation = createLocalGasStation({
      sponsorKeypair,
      gasCoins: GAS_COINS,
      gasBudget: GAS_BUDGET,
      gasPrice: GAS_PRICE,
      client,
    })

    const { txBytes, sponsorSignature, sponsorAddress } = await gasStation.sponsor({
      txKindBytes: kindBytes,
      sender: senderAddress,
    })
    const senderSignature = await signSenderForSponsoredTransaction(account, txBytes)

    await verifySponsoredSignatures(
      txBytes,
      senderSignature,
      sponsorSignature,
      senderAddress,
      sponsorAddress,
    )
  })

  it('attack 2 — GasData-swap: tampered txBytes fails sender verification', async () => {
    const client = createOfflineClient()
    const account = await WalletAccountSui.at(TEST_MNEMONIC, "0'/0'/0'", { provider: client })
    const senderAddress = await account.getAddress()
    const { kindBytes } = await buildFixtureTransaction(client, senderAddress)

    const gasStation = createLocalGasStation({
      sponsorKeypair,
      gasCoins: GAS_COINS,
      gasBudget: GAS_BUDGET,
      gasPrice: GAS_PRICE,
      client,
    })

    const { txBytes, sponsorSignature, sponsorAddress } = await gasStation.sponsor({
      txKindBytes: kindBytes,
      sender: senderAddress,
    })
    const senderSignature = await signSenderForSponsoredTransaction(account, txBytes)

    const tampered = new Uint8Array(txBytes)
    tampered[tampered.length - 1] ^= 0xff

    await assert.rejects(() =>
      verifySponsoredSignatures(
        tampered,
        senderSignature,
        sponsorSignature,
        senderAddress,
        sponsorAddress,
      ),
      /Sender signature verification failed/,
    )
  })

  it('attack 3 — equivocation: missing sponsorAddress throws ConfigurationError', async () => {
    const client = createOfflineClient()
    const account = await WalletAccountSui.at(TEST_MNEMONIC, "0'/0'/0'", { provider: client })
    const senderAddress = await account.getAddress()

    const gasStation = {
      sponsor: async () => ({
        txBytes: new Uint8Array([1, 2, 3]),
        sponsorSignature: 'AA==',
        sponsorAddress: '',
      }),
    }

    await assert.rejects(
      () =>
        executeSponsoredTransaction({
          account,
          transaction: { to: senderAddress, value: 1n },
          gasStation,
          client,
        }),
      (error) => error instanceof ConfigurationError,
    )
  })

  it('attack 4 — censorship: sender executes direct to fullnode; gas station only signs', async () => {
    const executeSpy = []
    const client = createOfflineClient(executeSpy)
    const sponsorCalls = []

    const account = await WalletAccountSui.at(TEST_MNEMONIC, "0'/0'/0'", { provider: client })
    const senderAddress = await account.getAddress()

    const gasStation = createLocalGasStation({
      sponsorKeypair,
      gasCoins: GAS_COINS,
      gasBudget: GAS_BUDGET,
      gasPrice: GAS_PRICE,
      client: {
        getReferenceGasPrice: client.getReferenceGasPrice,
      },
    })

    const signingGasStation = {
      sponsor: async (input) => {
        sponsorCalls.push(input)
        return gasStation.sponsor(input)
      },
    }

    await executeSponsoredTransaction({
      account,
      transaction: { to: senderAddress, value: 1n },
      gasStation: signingGasStation,
      client,
    })

    assert.equal(sponsorCalls.length, 1)
    assert.equal(executeSpy.length, 1)
    assert.equal(executeSpy[0].signature.length, 2)
  })

  it('transparent sendTransaction routes to sponsored path when gasStation is injected', async () => {
    const executeSpy = []
    const client = createOfflineClient(executeSpy)

    const account = await WalletAccountSui.at(TEST_MNEMONIC, "0'/0'/0'", {
      provider: client,
      gasStation: createLocalGasStation({
        sponsorKeypair,
        gasCoins: GAS_COINS,
        gasBudget: GAS_BUDGET,
        gasPrice: GAS_PRICE,
        client,
      }),
    })

    await account.sendTransaction({ to: await account.getAddress(), value: 1n })
    assert.equal(executeSpy.length, 1)
  })

  it('rejects isSponsored without an injected gasStation', async () => {
    const account = await WalletAccountSui.at(TEST_MNEMONIC, "0'/0'/0'", {
      provider: createOfflineClient(),
      isSponsored: true,
    })

    await assert.rejects(
      () => account.sendTransaction({ to: GOLDEN_SUI_ADDRESS, value: 1n }),
      (error) => error instanceof ConfigurationError,
    )
  })
})
