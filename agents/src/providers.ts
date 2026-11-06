import type {
  ApprovalCheckpoint,
  DecisionEngine,
  EpisodeLogger,
  HumanVerifier,
} from '@pickle/shared';
import {
  AgentPassCheckpoint,
  IdKitVerifier,
  MockApprovalCheckpoint,
  MockHumanVerifier,
} from '@pickle/world';
import {
  MockDecisionEngine,
  MockEpisodeLogger,
  ZeroGDecisionEngine,
  ZeroGEpisodeLogger,
} from '@pickle/zerog';

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
      ? new IdKitVerifier({
          appId: required('WORLD_APP_ID'),
          rpId: required('WORLD_RP_ID'),
          signingKeyHex: required('WORLD_RP_SIGNING_KEY'),
          environment: env('WORLD_ENV', 'staging') as 'production' | 'staging',
        })
      : new MockHumanVerifier({
          failWith: (env('WORLD_FAIL_WITH') || undefined) as never,
        }),
    checkpoint: worldLive
      ? new AgentPassCheckpoint({
          clientId: required('WORLD_IDP_CLIENT_ID'),
          clientSecret: required('WORLD_IDP_CLIENT_SECRET'),
          issuer: env('WORLD_IDP_ISSUER', 'https://auth.world.org'),
        })
      : new MockApprovalCheckpoint({
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
    episodes: zerogLive
      ? new ZeroGEpisodeLogger({
          rpcUrl: env('ZEROG_RPC_URL', 'https://evmrpc-testnet.0g.ai'),
          privateKey: required('ZEROG_PRIVATE_KEY'),
          indexerUrl: env('ZEROG_INDEXER_URL', 'https://indexer-storage-testnet-turbo.0g.ai'),
        })
      : new MockEpisodeLogger(),
  };
}
