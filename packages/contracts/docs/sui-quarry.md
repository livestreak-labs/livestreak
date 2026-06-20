# Sui quarry — xylkstream Drips Move port → LiveStreak

Source quarry: `xylkstream-v1/contracts/sui/sources/` (read-only reference; not imported at build time).

Target: semantic parity with `chains/evm/solidity/` per `docs/architecture.md` + `docs/streamed-funding-explained.md`.

## Per-module verdicts

| Ref module | EVM analog | Verdict | Justification |
| --- | --- | --- | --- |
| `streams.move` | `Streams.sol` | **KEEP** | Cycle math + `g`-index / receivable accounting — substrate for all drivers |
| `movemate i128` | native `int128` | **KEEP** | Quarried to `sources/i128.move` (`livestreak::i128`) |
| `movemate i256` | native `int256` | **KEEP** | Quarried to `sources/i256.move` (`livestreak::i256`) |
| `drips.move` | `DripsStreaming.sol` | **KEEP** (trim) | Register / receivable / cycle only — drop splits/router/give |
| `driver_utils.move` | `SharedDriverUtils.sol` | **KEEP** | Driver plumbing shared by NFT + vault drivers |
| `driver_transfer_utils.move` | transfer helpers in drivers | **KEEP** | Coin pull patterns for fund/stop |
| `nft_driver.move` | `MarketDriver.sol` | **ADAPT** | Position = owned object; ≤10 lanes; native holder enum via object ownership |
| `splits.move` | (unused in EVM) | **DROP** | Removed from EVM drivers; no product use |
| `address_driver.move` | `AddressDriver` (removed) | **DROP** | EVM removed; NFT driver replaces |
| `yield_manager.move` | (none) | **DROP** | No EVM analog in LiveStreak protocol |

## Sui-native divergences (confirmed)

| EVM pattern | Sui approach |
| --- | --- |
| ERC-4337 / Paymaster | Sponsored transactions (no AA port) |
| `ERC721Enumerable` | Native owned-object enumeration |
| `onlyOwner` / `msg.sender` | Capabilities + `tx_context::sender` |
| `IERC20` USDC / LVST | `Coin<USDC>` / `Coin<LVST>` |
| `bytes32` stream pointer | `(StorageScheme, id)` on `MarketRegistry` — `id` as `vector<u8>` / string cap 64 on Sui |

## Stage status

| Stage | Status |
| --- | --- |
| 0 — Scaffold + math libs | **done** (commit pending) |
| 1 — Streaming substrate | pending |
| 2 — Drivers | pending |
| 3 — Product contracts | pending |
| 4 — Reads + kit | pending |
| 5 — Parity verification | pending |
