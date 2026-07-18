import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey
} from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { readOptionalEnv } from "../../config/env.js";
import {
  isLocalnetSolanaRpc,
  readSolanaDeployment,
  type SolanaDeployment
} from "../../config/solana-deployment.js";
import { resolveSolanaRpcUrl } from "../../infrastructure/wallet/solana.js";

// --- exports ---

// Dev top-up UX for the app's Solana arm: a fresh bettor's derived address holds zero USDC and zero
// SOL, so it cannot bet (or even self-pay to create its own token account). This route mints mock
// USDC (mint authority = the localnet deployer keypair) and airdrops a little SOL. It is HARD-gated
// on the solana leg being localnet — the mock mint and free airdrop only exist there — so it can
// never mint on devnet/mainnet. This mirrors the EVM app's anvil-key top-up, which has no Solana
// equivalent today.
export const SOLANA_FAUCET_PATH = "/aa/solana/faucet";

// 1,000,000 mock USDC (6 decimals). Generous for a dev bettor; overridable per request.
const DEFAULT_USDC_AMOUNT = 1_000_000_000_000n;
const DEFAULT_SOL_LAMPORTS = 2 * LAMPORTS_PER_SOL;

export interface SolanaFaucetService {
  /** True only when the solana leg is localnet AND a deploy snapshot is readable. */
  readonly available: boolean;
  faucet(body: unknown): Promise<{ readonly status: number; readonly body: unknown }>;
}

export interface CreateSolanaFaucetOptions {
  /** Defaults to the solana leg's configured RPC. */
  readonly rpcUrl?: string | null;
  /** Defaults to the committed localnet deploy snapshot. */
  readonly deployment?: SolanaDeployment | null;
  /** Overrides the deployer (mint-authority) keypair path; defaults to the solana CLI id.json. */
  readonly deployerKeypairPath?: string;
}

export const createSolanaFaucet = (
  options: CreateSolanaFaucetOptions = {}
): SolanaFaucetService => {
  const rpcUrl = options.rpcUrl === undefined ? resolveSolanaRpcUrl() : options.rpcUrl;
  const deployment = options.deployment === undefined ? readSolanaDeployment() : options.deployment;
  const keypairPath =
    options.deployerKeypairPath ??
    readOptionalEnv("LIVESTREAK_SOLANA_DEPLOYER_KEYPAIR") ??
    join(homedir(), ".config", "solana", "id.json");

  const available = rpcUrl !== null && isLocalnetSolanaRpc(rpcUrl) && deployment !== null;

  return {
    available,

    async faucet(body) {
      if (!available || rpcUrl === null || deployment === null) {
        return {
          status: 404,
          body: { error: { message: "Solana faucet is only available on a localnet leg" } }
        };
      }

      const parsed = parseFaucetRequest(body);
      if (parsed === null) {
        return {
          status: 400,
          body: { error: { message: "address must be a base58 solana address" } }
        };
      }

      const authority = loadKeypair(keypairPath);
      if (authority === null) {
        return {
          status: 503,
          body: {
            error: {
              message: `mint authority keypair not found at ${keypairPath} — set LIVESTREAK_SOLANA_DEPLOYER_KEYPAIR`
            }
          }
        };
      }
      // The mock USDC mint authority is the deployer (deploy/main.ts). If the on-disk keypair is not
      // that deployer, minting would fail on-chain anyway — refuse early with a clear message.
      if (authority.publicKey.toBase58() !== deployment.deployer) {
        return {
          status: 503,
          body: {
            error: {
              message: `keypair ${authority.publicKey.toBase58()} is not the mint authority (deployer ${deployment.deployer})`
            }
          }
        };
      }

      try {
        const connection = new Connection(rpcUrl, "confirmed");
        const recipient = parsed.address;
        const usdcMint = new PublicKey(deployment.usdcMint);

        // Belt-and-suspenders: airdrop SOL FIRST (free on localnet) so the recipient can hold its own
        // ATA rent and self-pay if sponsorship is ever off — the getOrCreateAssociatedTokenAccount
        // below is funded by the authority regardless, but a bettor with zero SOL cannot otherwise act.
        let solSignature: string | null = null;
        if (parsed.sol) {
          const sig = await connection.requestAirdrop(recipient, DEFAULT_SOL_LAMPORTS);
          const latest = await connection.getLatestBlockhash();
          await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
          solSignature = sig;
        }

        const ata = await getOrCreateAssociatedTokenAccount(
          connection,
          authority,
          usdcMint,
          recipient
        );
        const usdcSignature = await mintTo(
          connection,
          authority,
          usdcMint,
          ata.address,
          authority,
          parsed.usdcAmount
        );

        return {
          status: 200,
          body: {
            address: recipient.toBase58(),
            usdcMint: deployment.usdcMint,
            usdcAmount: parsed.usdcAmount.toString(),
            usdcSignature,
            solLamports: parsed.sol ? DEFAULT_SOL_LAMPORTS : 0,
            solSignature
          }
        };
      } catch (error) {
        console.error("[aa:solana-faucet]: mint failed:", error);
        return { status: 500, body: { error: { message: "Solana faucet mint failed" } } };
      }
    }
  };
};

// --- helpers ---

interface ParsedFaucetRequest {
  readonly address: PublicKey;
  readonly usdcAmount: bigint;
  readonly sol: boolean;
}

const parseFaucetRequest = (body: unknown): ParsedFaucetRequest | null => {
  if (body === null || typeof body !== "object") {
    return null;
  }
  const request = body as { address?: unknown; usdcAmount?: unknown; sol?: unknown };
  if (typeof request.address !== "string" || request.address.length === 0) {
    return null;
  }

  let address: PublicKey;
  try {
    address = new PublicKey(request.address);
  } catch {
    return null;
  }

  const usdcAmount = readAmount(request.usdcAmount);
  if (usdcAmount === null) {
    return null;
  }

  return {
    address,
    usdcAmount,
    sol: request.sol === undefined ? true : request.sol === true
  };
};

const readAmount = (value: unknown): bigint | null => {
  if (value === undefined) {
    return DEFAULT_USDC_AMOUNT;
  }
  try {
    const amount =
      typeof value === "number" ? BigInt(Math.trunc(value)) : BigInt(String(value));
    return amount > 0n ? amount : null;
  } catch {
    return null;
  }
};

const loadKeypair = (path: string): Keypair | null => {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
  } catch {
    return null;
  }
};
