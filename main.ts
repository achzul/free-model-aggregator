// free-model-aggregator-01 — one aggregator server over the brief's ten free-tier providers.
//
// The server reads the trial brief (the provider directory, the sealed quality table and the
// workload manifest), probes every provider's catalog route in its own wire, and registers the
// catalog it built with the env. For each client request — OpenAI Chat Completions or Anthropic
// Messages, JSON or server-sent events — it routes to the strongest free model that meets the
// request's requirements, speaks that provider's wire (OpenAI, Anthropic or Gemini), and returns
// the provider's answer in the client's wire.
//
// Routing is the score: quality is the rating of the model that answered against the best rating
// any free model meeting the requirements holds, so candidates are tried in rating order. A
// provider's per-trial budget and its scheduled refusals are not in the brief, so a refusal
// (402, 429 or 5xx) fails the request over — first to one retry on the same model (a scheduled
// refusal consumes its slot and the next call usually lands), then down the rating order — and
// every choice derives from the brief and the providers' answers alone: no clock, no randomness,
// so a replay makes the same calls and leaves the same state.
//
// `node main.ts --list` prints the catalog document and exits 0; the register body carries that
// same document. Run outside a trial it prints {"providers":[]}.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  authHeaders,
  buildCatalog,
  dialBase,
  isRecord,
  meets,
  probeProvider,
  ratingRow,
  readBrief,
  type Brief,
  type Catalog,
  type Json,
  type Probe,
  type ProviderEntry,
  type Requirement,
} from './lib/brief.ts';
import {
  anthropicError,
  FIXED_CREATED,
  FIXED_CREATED_AT,
  openAIError,
  parseAnthropicAnswer,
  parseAnthropicRequest,
  parseGeminiAnswer,
  parseOpenAIAnswer,
  parseOpenAIRequest,
  renderAnthropicAnswer,
  renderAnthropicRequest,
  renderAnthropicStream,
  renderGeminiRequest,
  renderOpenAIAnswer,
  renderOpenAIRequest,
  renderOpenAIStream,
  type CanonAnswer,
  type CanonRequest,
} from './lib/wires.ts';

const PROTOCOL_VERSION = 1;
const POLL_INTERVAL_MS = 100;
const PROBE_TIMEOUT_MS = 4000;
const CALL_TIMEOUT_MS = 12000;
/** The env's client allows 30 s a request; the whole attempt chain stays well inside it. */
const REQUEST_DEADLINE_MS = 26000;
const MAX_ATTEMPTS = 10;
const ATTEMPTS_PER_CANDIDATE = 2;
const MAX_BODY_BYTES = 32 * 1024 * 1024;

const ENV_URL = (process.env.MAKEFUN_ENV_URL ?? '').replace(/\/+$/, '');
const PROMPT_FILE = process.env.MAKEFUN_PROMPT_FILE ?? '';

const brief: Brief = readBrief(PROMPT_FILE);
let probes: Probe[] = [];
let catalog: Catalog = { providers: [] };
/** Client requests answered so far: the manifest is in arrival order, and ids derive from it. */
let requestSeq = 0;

function log(message: string): void {
  process.stderr.write(`aggregator-01: ${message}\n`);
}

async function load(): Promise<void> {
  if (brief.error !== null) log(brief.error);
  probes = await Promise.all(brief.providers.map((p) => probeProvider(ENV_URL, p, PROBE_TIMEOUT_MS)));
  catalog = buildCatalog(brief, probes);
}

/** The free model ids this entry serves, deduplicated, in catalog order: what GET /v1/models lists. */
function servedModelIds(): { id: string; provider: string }[] {
  const seen = new Set<string>();
  const out: { id: string; provider: string }[] = [];
  for (const provider of catalog.providers) {
    for (const model of provider.models) {
      if (!model.free || seen.has(model.id)) continue;
      seen.add(model.id);
      out.push({ id: model.id, provider: provider.id });
    }
  }
  return out;
}

interface Candidate {
  provider: ProviderEntry;
  model: string;
  rating: number;
}

/**
 * Every free model that may serve a request, best first: the quality table's rating orders them,
 * the brief's provider order and the model id break ties, so the order is a pure function of the
 * brief. A JSON-mode request never routes to an Anthropic-wire provider (its wire cannot carry
 * JSON mode, so the provider would echo that it was absent).
 */
function candidatesFor(requires: Requirement, jsonMode: boolean): Candidate[] {
  const out: Candidate[] = [];
  brief.providers.forEach((provider, providerIndex) => {
    const probe = probes[providerIndex];
    if (probe === undefined || !probe.ok) return;
    if (jsonMode && provider.wire === 'anthropic') return;
    for (const listed of probe.models) {
      const row = ratingRow(brief, provider.id, listed.id);
      const free = row !== null ? row.free : (listed.free ?? false);
      if (!free) continue;
      const caps = {
        tools: row?.tools ?? false,
        vision: row?.vision ?? false,
        json: row?.json ?? false,
        contextLength: row?.contextLength ?? listed.contextLength,
      };
      if (!meets(requires, caps)) continue;
      out.push({ provider, model: listed.id, rating: row?.ratingMilli ?? 0 });
    }
  });
  return out.sort((a, b) => b.rating - a.rating || a.provider.id.localeCompare(b.provider.id) || a.model.localeCompare(b.model));
}

/** The requirements of the request now arriving: the manifest's row by arrival order. */
function manifestRequires(seq: number): Requirement | null {
  const row = brief.workload[seq];
  return row === undefined ? null : row.requires;
}

/** Requirements read off a request body, when the manifest has no row for it. */
function bodyRequires(canon: CanonRequest): Requirement {
  return {
    ...(canon.tools.length > 0 ? { tools: true } : {}),
    ...(canon.turns.some((t) => t.images.length > 0) ? { vision: true } : {}),
    ...(canon.jsonMode ? { json: true } : {}),
  };
}

interface CallOutcome {
  answer: CanonAnswer | null;
  status: number;
}

/** One provider call, on the provider's own wire, always non-streaming (see wires.ts). */
async function callProvider(candidate: Candidate, canon: CanonRequest): Promise<CallOutcome> {
  const { provider, model } = candidate;
  const base = dialBase(ENV_URL, provider.base);
  const headers: Record<string, string> = { 'content-type': 'application/json', ...authHeaders(provider.auth, provider.key) };
  let url: string;
  let payload: Json;
  if (provider.wire === 'openai') {
    url = `${base}/v1/chat/completions`;
    payload = renderOpenAIRequest(canon, model);
  } else if (provider.wire === 'anthropic') {
    url = `${base}/v1/messages`;
    headers['anthropic-version'] = '2023-06-01';
    payload = renderAnthropicRequest(canon, model);
  } else {
    url = `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    payload = renderGeminiRequest(canon);
  }
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
  } catch {
    return { answer: null, status: 0 };
  }
  if (!res.ok) return { answer: null, status: res.status };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { answer: null, status: res.status };
  }
  const answer = provider.wire === 'openai' ? parseOpenAIAnswer(body) : provider.wire === 'anthropic' ? parseAnthropicAnswer(body) : parseGeminiAnswer(body);
  return { answer, status: res.status };
}

const retryable = (status: number): boolean => status === 0 || status === 402 || status === 429 || status >= 500;

/** Per-provider call history this trial: what the brief cannot say (budgets, refusal schedules). */
const providerHealth = new Map<string, { counted: number; consecutiveFailures: number }>();

function healthOf(providerId: string): { counted: number; consecutiveFailures: number } {
  let health = providerHealth.get(providerId);
  if (health === undefined) {
    health = { counted: 0, consecutiveFailures: 0 };
    providerHealth.set(providerId, health);
  }
  return health;
}

/**
 * Serve one canonical request: try the candidates in rating order, one retry each on a refusal,
 * until one answers. Returns the answer and the model that served it, or null when none did.
 *
 * A provider that has failed twice running after several counted calls is probably spent (its
 * budget is gone or its outage has begun): it keeps its place in the rating order — a scheduled
 * refusal cluster ends, and the next request's single attempt finds out — but it gets no retry
 * until it answers again, which keeps a dead provider from taxing every later request twice.
 */
async function serve(canon: CanonRequest, requires: Requirement): Promise<{ answer: CanonAnswer; model: string } | null> {
  const candidates = candidatesFor(requires, canon.jsonMode);
  const deadline = Date.now() + REQUEST_DEADLINE_MS;
  let attempts = 0;
  for (const candidate of candidates) {
    const health = healthOf(candidate.provider.id);
    const suspect = health.consecutiveFailures >= 2 && health.counted >= 4;
    const allowed = suspect ? 1 : ATTEMPTS_PER_CANDIDATE;
    for (let n = 0; n < allowed; n++) {
      if (attempts >= MAX_ATTEMPTS || Date.now() > deadline) return null;
      attempts += 1;
      health.counted += 1;
      const outcome = await callProvider(candidate, canon);
      if (outcome.answer !== null) {
        health.consecutiveFailures = 0;
        return { answer: outcome.answer, model: candidate.model };
      }
      health.consecutiveFailures += 1;
      if (!retryable(outcome.status)) break;
    }
  }
  return null;
}

async function readJson(req: IncomingMessage): Promise<Json | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(buffer);
  }
  if (chunks.length === 0) return null;
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function sendStream(res: ServerResponse, text: string): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  res.end(text);
}

function sendWireError(res: ServerResponse, wire: 'openai' | 'anthropic', status: number, message: string): void {
  if (wire === 'anthropic') sendJson(res, status, anthropicError('overloaded_error', message));
  else sendJson(res, status, openAIError(message, 'server_error', 'no_provider_available'));
}

/** GET /v1/models, in the shape of the auth header the client sent. */
function models(req: IncomingMessage, res: ServerResponse): void {
  const list = servedModelIds();
  if (typeof req.headers['x-api-key'] === 'string') {
    sendJson(res, 200, {
      data: list.map((m) => ({ type: 'model', id: m.id, display_name: m.id, created_at: FIXED_CREATED_AT })),
      has_more: false,
      first_id: list[0]?.id ?? null,
      last_id: list[list.length - 1]?.id ?? null,
    });
    return;
  }
  sendJson(res, 200, {
    object: 'list',
    data: list.map((m) => ({ id: m.id, object: 'model', created: FIXED_CREATED, owned_by: m.provider })),
  });
}

/** One client request, on either wire, answered end to end. */
async function complete(wire: 'openai' | 'anthropic', req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req);
  if (body === null) {
    if (wire === 'anthropic') sendJson(res, 400, anthropicError('invalid_request_error', 'the request body is not one JSON object'));
    else sendJson(res, 400, openAIError('the request body is not one JSON object', 'invalid_request_error', null));
    return;
  }
  const seq = requestSeq;
  requestSeq += 1;
  const canon = wire === 'openai' ? parseOpenAIRequest(body) : parseAnthropicRequest(body);
  const requires = manifestRequires(seq) ?? bodyRequires(canon);
  const served = await serve(canon, requires);
  if (served === null) {
    sendWireError(res, wire, 503, 'no free model on the directory could serve this request');
    return;
  }
  if (canon.stream) {
    sendStream(res, wire === 'openai' ? renderOpenAIStream(served.answer, served.model, seq) : renderAnthropicStream(served.answer, served.model, seq));
    return;
  }
  sendJson(res, 200, wire === 'openai' ? renderOpenAIAnswer(served.answer, served.model, seq) : renderAnthropicAnswer(served.answer, served.model, seq));
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://entry');
  if (req.method === 'GET' && url.pathname === '/v1/models') return models(req, res);
  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') return complete('openai', req, res);
  if (req.method === 'POST' && url.pathname === '/v1/messages') return complete('anthropic', req, res);
  if (url.pathname === '/v1/messages') sendJson(res, 404, anthropicError('not_found_error', `no route ${req.method ?? ''} ${url.pathname}`));
  else sendJson(res, 404, openAIError(`no route ${req.method ?? ''} ${url.pathname}`, 'invalid_request_error', 'not_found'));
}

/** POST /register with the port and the one catalog; the env answers with the workload's size. */
async function register(port: number): Promise<void> {
  const res = await fetch(`${ENV_URL}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ protocol_version: PROTOCOL_VERSION, port, catalog }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`POST /register answered HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const reply: unknown = await res.json();
  if (isRecord(reply) && typeof reply.requests === 'number') log(`registered: the workload holds ${reply.requests} requests`);
}

/** Poll GET /work; exit 0 the moment the env says the workload is done. */
function poll(server: ReturnType<typeof createServer>): void {
  let inFlight = false;
  const timer = setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    void (async () => {
      try {
        const res = await fetch(`${ENV_URL}/work`, { signal: AbortSignal.timeout(2000) });
        if (res.status === 200) {
          const work: unknown = await res.json();
          if (isRecord(work) && work.done === true) {
            clearInterval(timer);
            server.close();
            process.exit(0);
          }
        }
      } catch {
        // The env is not reachable yet: try again on the next tick.
      } finally {
        inFlight = false;
      }
    })();
  }, POLL_INTERVAL_MS);
}

async function start(): Promise<void> {
  await load();
  if (process.argv.includes('--list')) {
    const text = `${JSON.stringify(catalog)}\n`;
    await new Promise<void>((resolve) => process.stdout.write(text, () => resolve()));
    process.exit(0);
  }
  if (ENV_URL === '') throw new Error('MAKEFUN_ENV_URL is not set');
  const server = createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      log((err as Error).stack ?? String(err));
      if (!res.headersSent) sendWireError(res, req.url?.startsWith('/v1/messages') === true ? 'anthropic' : 'openai', 500, 'the server failed to answer');
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the server has no port');
  if (address.port === 8080) throw new Error('the OS picked 8080, which the env owns on one layout: restart the trial');
  log(`listening on 0.0.0.0:${address.port} with ${catalog.providers.length} providers and ${servedModelIds().length} free models`);
  await register(address.port);
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
  poll(server);
}

try {
  await start();
} catch (err) {
  log((err as Error).stack ?? String(err));
  process.exit(1);
}
