/**
 * Episode logger: one robot incident from "stuck" to "paid", as an ordered list of decisions.
 * Each entry carries the request ID that proves it (sim event, tx hash, World verification,
 * 0G Compute request ID, settle tx). Mirrored to agents/logs/episodes/<id>.jsonl as it happens.
 *
 * Two uploads to 0G Storage, because the settle tx must reference the evidence root, and the
 * "paid" entry can only exist after that tx:
 *   sealEvidence()  → uploads stuck_detected … fix_verified → root passed to PickleEscrow.settle
 *   finalize()      → uploads the full episode incl. "paid" and a pointer to the evidence root
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Wallet } from 'ethers';
import { downloadBytes, uploadBytes, type UploadResult } from './storage.js';

export const EPISODE_KINDS = ['stuck_detected', 'bounty_posted', 'human_verified', 'fix_verified', 'paid'] as const;
export type EpisodeKind = (typeof EPISODE_KINDS)[number];

export interface EpisodeEntry {
  seq: number;
  ts: string;
  kind: EpisodeKind;
  /** The ID that proves this step: sim event, tx hash, World verification, 0G Compute request, … */
  requestId: string;
  data: Record<string, unknown>;
}

export interface EpisodeDoc {
  schema: 'pickle.episode/v1';
  episodeId: string;
  robot: string;
  bountyId?: string;
  /** Set on the final upload: root of the evidence that settle() recorded. */
  evidenceRoot?: string;
  entries: EpisodeEntry[];
}

const LOG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'logs', 'episodes');
const jsonSafe = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));

export class Episode {
  readonly episodeId: string;
  readonly entries: EpisodeEntry[] = [];
  bountyId?: string;
  evidence?: UploadResult & { bytes: number; raw: Uint8Array };
  final?: UploadResult;

  constructor(
    readonly robot: string,
    private storage: { wallet: Wallet; walletName?: string; floorWei?: bigint },
    episodeId?: string,
  ) {
    this.episodeId = episodeId ?? `${robot}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  }

  get localPath(): string {
    return join(LOG_DIR, `${this.episodeId}.jsonl`);
  }

  record(kind: EpisodeKind, requestId: string, data: Record<string, unknown> = {}): EpisodeEntry {
    const expected = EPISODE_KINDS[this.entries.length];
    if (kind !== expected) throw new Error(`episode ${this.episodeId}: got "${kind}", expected "${expected}" next`);
    if (!requestId) throw new Error(`episode ${this.episodeId}: "${kind}" needs a requestId`);
    const entry: EpisodeEntry = { seq: this.entries.length, ts: new Date().toISOString(), kind, requestId, data: jsonSafe(data) };
    this.entries.push(entry);
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(this.localPath, JSON.stringify(entry) + '\n');
    return entry;
  }

  doc(extra: Partial<EpisodeDoc> = {}): EpisodeDoc {
    return {
      schema: 'pickle.episode/v1',
      episodeId: this.episodeId,
      robot: this.robot,
      ...(this.bountyId ? { bountyId: this.bountyId } : {}),
      ...extra,
      entries: [...this.entries],
    };
  }

  static encode(doc: EpisodeDoc): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(doc, null, 2));
  }

  /** Upload the evidence (through fix_verified). Returns the root to pass to settle(). */
  async sealEvidence(): Promise<string> {
    if (this.entries.at(-1)?.kind !== 'fix_verified') throw new Error('sealEvidence: last entry must be fix_verified');
    const raw = Episode.encode(this.doc());
    const up = await uploadBytes(raw, this.storage.wallet, {
      action: `episode ${this.episodeId} evidence`,
      walletName: this.storage.walletName,
      floorWei: this.storage.floorWei,
    });
    this.evidence = { ...up, raw };
    return up.rootHash;
  }

  /** After settle: record "paid" and upload the full episode. */
  async finalize(settleTxHash: string, data: Record<string, unknown> = {}): Promise<UploadResult> {
    if (!this.evidence) throw new Error('finalize: sealEvidence() first');
    this.record('paid', settleTxHash, data);
    const up = await uploadBytes(Episode.encode(this.doc({ evidenceRoot: this.evidence.rootHash })), this.storage.wallet, {
      action: `episode ${this.episodeId} final`,
      walletName: this.storage.walletName,
      floorWei: this.storage.floorWei,
    });
    this.final = up;
    return up;
  }

  /** Download an episode by root and parse it. */
  static async fetch(rootHash: string): Promise<{ doc: EpisodeDoc; raw: Uint8Array }> {
    const raw = await downloadBytes(rootHash);
    return { doc: JSON.parse(new TextDecoder().decode(raw)), raw };
  }
}
