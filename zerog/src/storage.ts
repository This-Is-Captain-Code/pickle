import type { EpisodeLogger, EpisodeReceipt, EpisodeRecord } from '@pickle/shared';

export interface ZeroGStorageConfig {
  /** Galileo EVM RPC, e.g. https://evmrpc-testnet.0g.ai */
  rpcUrl: string;
  /** Funded Galileo wallet (storage uploads cost gas). */
  privateKey: string;
  /** Turbo indexer: https://indexer-storage-testnet-turbo.0g.ai */
  indexerUrl: string;
}

/**
 * Live 0G Storage episode logger — OWNED BY THE WORLD/0G DEV. See
 * zerog/README.md. Sketch with @0gfoundation/0g-storage-ts-sdk:
 *
 *   const indexer = new Indexer(indexerUrl);
 *   const data = new MemData(new TextEncoder().encode(JSON.stringify(record)));
 *   const [tx, err] = await indexer.upload(data, rpcUrl, signer);
 *   return { rootHash: tx.rootHash, txHash: tx.txHash };
 *
 * Also mirror every record to local JSONL (reuse MockEpisodeLogger) so the
 * demo narration can show the raw log next to the on-chain root.
 */
export class ZeroGEpisodeLogger implements EpisodeLogger {
  constructor(private config: ZeroGStorageConfig) {}

  async append(_record: EpisodeRecord): Promise<EpisodeReceipt> {
    throw new Error('ZeroGEpisodeLogger not implemented yet — run with ZEROG_MODE=mock');
  }
}
