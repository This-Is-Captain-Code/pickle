/**
 * World ID 4.0 action registry: one action per bounty, created in the Developer Portal before the
 * claim QR is shown.
 *
 * Docs (see docs/sponsors.md §4b):
 *  - SKILL.md: "World ID 4.0 uniqueness proofs are one-time per action for each user. Use separate actions
 *    for separate one-time operations" and "create the action in the intended environment".
 *  - The only documented programmatic path is the Developer Portal MCP tool `create_world_id_action`
 *    (inputs: app_id, action, description, environment ∈ production|staging; "Create or update").
 *    Endpoint https://developer.world.org/api/mcp (streamable HTTP), auth `Authorization: Bearer api_…`
 *    with a team API key (portal → team → API keys).
 */

export const WORLD_MCP_URL = 'https://developer.world.org/api/mcp';

/** `claim-bounty-<id>` scoped to an escrow deployment so a redeploy can't collide with old actions. */
export function bountyAction(bountyId: string | bigint, escrowAddress?: string): string {
  const scope = escrowAddress ? `${escrowAddress.slice(2, 8).toLowerCase()}-` : '';
  return `pickle-${scope}claim-bounty-${bountyId}`;
}

export interface ActionRegistryConfig {
  appId: string;
  /** Developer Portal team API key (`api_…`). Server-only. */
  apiKey: string;
  environment: 'production' | 'staging';
  mcpUrl?: string;
}

/** Minimal JSON-RPC client for the portal's MCP endpoint (streamable HTTP; replies may be JSON or SSE). */
export class PortalMcp {
  private sessionId?: string;
  private nextId = 1;
  constructor(private url: string, private apiKey: string) {}

  private async rpc(method: string, params: unknown, notify = false): Promise<any> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${this.apiKey}`,
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    const body = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: this.nextId++, method, params };
    const res = await fetch(this.url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;
    const text = await res.text();
    if (!res.ok) throw new Error(`World portal MCP ${method}: HTTP ${res.status} ${text.slice(0, 200)}`);
    if (notify || !text.trim()) return undefined;
    // SSE: take the last `data:` line carrying a JSON-RPC message.
    const payload = text.trimStart().startsWith('{')
      ? text
      : text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter(Boolean).pop() ?? '';
    const msg = JSON.parse(payload);
    if (msg.error) throw new Error(`World portal MCP ${method}: ${msg.error.message ?? JSON.stringify(msg.error)}`);
    return msg.result;
  }

  async init(): Promise<void> {
    if (this.sessionId) return;
    await this.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pickle-agents', version: '0.0.1' } });
    await this.rpc('notifications/initialized', {}, true);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    await this.init();
    const r = await this.rpc('tools/call', { name, arguments: args });
    const text = (r?.content ?? []).map((c: { text?: string }) => c.text ?? '').join('\n');
    return { text, isError: Boolean(r?.isError) };
  }
}

export class ActionRegistry {
  private mcp: PortalMcp;
  private ensured = new Set<string>();

  constructor(private cfg: ActionRegistryConfig) {
    if (!cfg.apiKey) throw new Error('WORLD_PORTAL_API_KEY is required to create per-bounty World ID actions');
    this.mcp = new PortalMcp(cfg.mcpUrl ?? WORLD_MCP_URL, cfg.apiKey);
  }

  /** Create (or update) the action in the configured environment. Idempotent ("Create or update"). */
  async ensure(action: string, description: string): Promise<void> {
    if (this.ensured.has(action)) return;
    const r = await this.mcp.callTool('create_world_id_action', {
      app_id: this.cfg.appId,
      action,
      description,
      environment: this.cfg.environment,
    });
    if (r.isError) throw new Error(`create_world_id_action(${action}) failed: ${r.text.slice(0, 300)}`);
    this.ensured.add(action);
  }

  /**
   * RP registration as the portal sees it (MCP `get_app_config` → app.rp_registration[]).
   * `signer_address` is the address World checks RP signatures against.
   */
  async rpRegistration(rpId: string): Promise<{ status?: string; signerAddress?: string }> {
    const r = await this.mcp.callTool('get_app_config', { app_id: this.cfg.appId });
    if (r.isError) throw new Error(`get_app_config failed: ${r.text.slice(0, 300)}`);
    const reg = (JSON.parse(r.text)?.app?.rp_registration ?? []).find((x: { rp_id?: string }) => x.rp_id === rpId);
    return { status: reg?.status, signerAddress: reg?.signer_address };
  }
}
