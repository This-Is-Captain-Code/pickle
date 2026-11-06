import type {
  ApprovalCheckpoint,
  DecisionEngine,
  EpisodeLogger,
  HumanVerifier,
} from '@pickle/shared';
import { IdKitVerifier, MockApprovalCheckpoint, MockHumanVerifier } from '@pickle/world';
import { MockDecisionEngine, MockEpisodeLogger, ZeroGDecisionEngine } from '@pickle/zerog';
import { walletFromEnv } from './chain.js';
import { Escrow, escrowDeployed } from './escrow.js';
import { StorageEpisodeLogger } from './storage.js';

export interface Providers {
  verifier: HumanVerifier;
  checkpoint: ApprovalCheckpoint;
  engine: DecisionEngine;
  episodes: EpisodeLogger;
}

function env(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required in live mode (see agents/.env.example)`);
  return v;
}

/** Live World ID 4.0 (IDKit) config. Signing key + portal API key are server-only. */
export function worldConfigFromEnv() {
  return {
    appId: required('WORLD_APP_ID'),
    rpId: required('WORLD_RP_ID'),
    signingKeyHex: env('WORLD_SIGNING_KEY') || required('WORLD_RP_SIGNING_KEY'),
    // Real World App scans only produce production proofs (docs SKILL.md); staging = simulator only.
    environment: env('WORLD_ENV', 'production') as 'production' | 'staging',
    portalApiKey: env('WORLD_PORTAL_API_KEY') || undefined,
    escrowAddress: escrowDeployed() ? new Escrow().address : undefined,
  };
}

/**
 * WORLD_MODE / ZEROG_MODE = 'mock' (default) | 'live'.
 * Demo knobs (mock only): WORLD_FAIL_WITH, WORLD_APPROVAL, ZEROG_UNREACHABLE=1.
 */
export function buildProviders(): Providers {
  const worldLive = env('WORLD_MODE', 'mock') === 'live';
  const zerogLive = env('ZEROG_MODE', 'mock') === 'live';
  const zerogMode = env('ZEROG_COMPUTE_MODE', 'direct') as 'router' | 'direct';

  return {
    verifier: worldLive
      ? new IdKitVerifier(worldConfigFromEnv())
      : new MockHumanVerifier({
          failWith: (env('WORLD_FAIL_WITH') || undefined) as never,
        }),
    // The World IdP payout-approval checkpoint was removed (World ID 4.0 + IDKit replaced it, 2026-11-06).
    // The payout approval step stays mocked (WORLD_APPROVAL knob) until a replacement is chosen.
    checkpoint: new MockApprovalCheckpoint({
      decision: (env('WORLD_APPROVAL') || undefined) as never,
    }),
    engine: zerogLive
      ? new ZeroGDecisionEngine({
          // direct = Galileo testnet broker SDK (text only today); router = mainnet Router (credits; also vision)
          mode: zerogMode,
          routerBaseUrl: env('ZEROG_ROUTER_URL', 'https://router-api.0g.ai/v1'),
          routerApiKey: env('ZEROG_ROUTER_KEY'),
          rpcUrl: env('ZEROG_RPC_URL', 'https://evmrpc-testnet.0g.ai'),
          // compute pays from its own COMPUTE_WALLET (never the deployer, which other processes send from)
          privateKey: env('COMPUTE_WALLET_PRIVATE_KEY'),
          providerAddress: env('ZEROG_PROVIDER_ADDRESS') || undefined,
          // router: model id; direct: optional override of the provider's on-chain model
          model: zerogMode === 'direct' ? env('ZEROG_DIRECT_MODEL') : env('ZEROG_MODEL', '0gm-1.0-35b-a3b'),
          // router: send verify_tee; direct: reject responses whose TEE signature fails
          verifyTee: zerogMode === 'direct' ? env('ZEROG_DIRECT_REQUIRE_TEE') === '1' : env('ZEROG_VERIFY_TEE', '1') === '1',
        })
      : new MockDecisionEngine({ unreachable: env('ZEROG_UNREACHABLE') === '1' }),
    // 0G Storage uploads are paid by the DEPLOYER (decision 2026-11-06), inside its sendTx queue.
    episodes: zerogLive
      ? new StorageEpisodeLogger(walletFromEnv('DEPLOYER_PRIVATE_KEY'))
      : new MockEpisodeLogger(),
  };
}
