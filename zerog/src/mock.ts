import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  ZeroGUnreachable,
  type Decision,
  type DecisionEngine,
  type DecisionRequest,
  type EpisodeLogger,
  type EpisodeReceipt,
  type EpisodeRecord,
} from '@pickle/shared';

export interface MockEngineOptions {
  /** Simulate a 0G outage — agents core must safe-stop, never fake a decision. */
  unreachable?: boolean;
  latencyMs?: number;
}

/** Stands in for ZeroGDecisionEngine. Picks the first option with a canned reason. */
export class MockDecisionEngine implements DecisionEngine {
  constructor(private opts: MockEngineOptions = {}) {}

  async decide(req: DecisionRequest): Promise<Decision> {
    const started = Date.now();
    await new Promise((r) => setTimeout(r, this.opts.latencyMs ?? 120));
    if (this.opts.unreachable) throw new ZeroGUnreachable('mock outage');
    if (req.options.length === 0) throw new Error('DecisionRequest.options is empty');
    return {
      choice: req.options[0],
      reason: `mock: picked "${req.options[0]}" for ${req.robotId} (${req.question.slice(0, 40)}…)`,
      requestId: `mock-0g-${Date.now().toString(36)}`,
      model: 'mock/decision-v0',
      latencyMs: Date.now() - started,
    };
  }
}

/**
 * Stands in for ZeroGEpisodeLogger: appends JSONL to a local file and derives
 * a fake "rootHash" from the record so downstream code shapes stay honest.
 */
export class MockEpisodeLogger implements EpisodeLogger {
  constructor(private filePath = 'logs/episodes.jsonl') {}

  async append(record: EpisodeRecord): Promise<EpisodeReceipt> {
    const line = JSON.stringify(record);
    mkdirSync(dirname(this.filePath), { recursive: true });
    appendFileSync(this.filePath, line + '\n');
    const hash = createHash('sha256').update(line).digest('hex');
    return { rootHash: `0xmock${hash.slice(0, 58)}`, txHash: `0xmocktx${hash.slice(0, 56)}` };
  }
}
