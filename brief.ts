// The trial brief: three JSON documents found by their `schema` member inside $MAKEFUN_PROMPT_FILE,
// plus the provider-catalog probe that turns them into the one catalog this entry registers and
// prints with --list.
//
//   - providers/v1: the ten free-tier providers (id, wire, auth scheme, base path, key variable, key)
//   - ratings/v1:   the quality table — every model's rating_milli, context length, capability flags
//                   (tools / vision / json) and free flag; the sealed truth routing trusts
//   - workload/v1:  the requests the client will send, in order, each with its requirements
//
// The probe speaks each provider's own catalog route (OpenAI and Anthropic wires list at
// GET <base>/v1/models, Gemini at GET <base>/v1beta/models) with the provider's own auth scheme.
// Everything built here is a pure function of the brief and the listings: no clock, no randomness,
// so the registered catalog and the --list document are the same bytes on a live pass and its replay.

import { readFileSync } from 'node:fs';

export type Wire = 'openai' | 'anthropic' | 'gemini';
export type AuthScheme = 'bearer' | 'x-api-key' | 'x-goog-api-key' | 'none';
export type Json = Record<string, unknown>;

export const isRecord = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);

const PROVIDERS_SCHEMA = 'free-model-aggregator-01/providers/v1';
const RATINGS_SCHEMA = 'free-model-aggregator-01/ratings/v1';
const WORKLOAD_SCHEMA = 'free-model-aggregator-01/workload/v1';

export interface ProviderEntry {
  id: string;
  name: string;
  wire: Wire;
  auth: AuthScheme;
  /** The provider's base path (`/p/<id>`) or an absolute base URL, exactly as the brief spells it. */
  base: string;
  keyEnv: string;
  key: string;
}

export interface RatingRow {
  provider: string;
  model: string;
  ratingMilli: number;
  contextLength: number | null;
  tools: boolean;
  vision: boolean;
  json: boolean;
  free: boolean;
}

export interface Requirement {
  tools?: boolean;
  vision?: boolean;
  json?: boolean;
  minContext?: number;
}

export interface WorkloadRow {
  id: string;
  api: 'openai' | 'anthropic';
  stream: boolean;
  weight: number;
  requires: Requirement;
}

export interface Brief {
  providers: ProviderEntry[];
  ratings: RatingRow[];
  workload: WorkloadRow[];
  error: string | null;
}

/** One model as a provider's catalog route listed it; null where the listing stayed silent. */
export interface ListedModel {
  id: string;
  free: boolean | null;
  contextLength: number | null;
}

export interface Probe {
  provider: ProviderEntry;
  ok: boolean;
  models: ListedModel[];
}

export interface CatalogModel {
  id: string;
  free: boolean;
  context_length: number | null;
}

export interface Catalog {
  providers: { id: string; base_url: string; key_env: string; wire: Wire; models: CatalogModel[] }[];
}

/** Join a brief base (a `/p/<id>` path or an absolute URL) to the env's origin for dialling. */
export function dialBase(envUrl: string, base: string): string {
  const b = base.trim();
  if (/^https?:\/\//i.test(b)) return b.replace(/\/+$/, '');
  const origin = envUrl.replace(/\/+$/, '');
  if (b === '') return origin;
  return `${origin}${b.startsWith('/') ? '' : '/'}${b.replace(/\/+$/, '')}`;
}

/** The headers a provider's auth scheme wants, given its key (an empty key or `none` sends nothing). */
export function authHeaders(auth: AuthScheme, key: string): Record<string, string> {
  if (key === '' || auth === 'none') return {};
  if (auth === 'bearer') return { authorization: `Bearer ${key}` };
  if (auth === 'x-api-key') return { 'x-api-key': key };
  return { 'x-goog-api-key': key };
}

/** Every JSON object carrying a string `schema`, in the order the brief's text holds them. */
function documentsIn(text: string): Json[] {
  const out: Json[] = [];
  for (let at = text.indexOf('{'); at !== -1; at = text.indexOf('{', at + 1)) {
    const end = objectEnd(text, at);
    if (end === -1) continue;
    try {
      const value: unknown = JSON.parse(text.slice(at, end + 1));
      if (isRecord(value) && typeof value.schema === 'string') out.push(value);
    } catch {
      // Not a standalone document: keep scanning.
    }
  }
  return out;
}

/** The index of the `}` that closes the object opening at `start`, or -1; string contents are skipped. */
function objectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function providerOf(v: unknown): ProviderEntry | null {
  if (!isRecord(v)) return null;
  const id = str(v.id);
  const wire = v.wire === 'openai' || v.wire === 'anthropic' || v.wire === 'gemini' ? v.wire : null;
  if (id === '' || wire === null) return null;
  const auth = v.auth === 'bearer' || v.auth === 'x-api-key' || v.auth === 'x-goog-api-key' || v.auth === 'none' ? v.auth : 'bearer';
  const base = [v.path, v.base_path, v.base_url, v.base].map(str).find((s) => s !== '') ?? '';
  return { id, name: str(v.name) !== '' ? str(v.name) : id, wire, auth, base, keyEnv: str(v.key_env), key: str(v.key) };
}

function ratingOf(v: unknown): RatingRow | null {
  if (!isRecord(v)) return null;
  const provider = str(v.provider);
  const model = str(v.model);
  if (provider === '' || model === '') return null;
  return {
    provider,
    model,
    ratingMilli: numOrNull(v.rating_milli) ?? 0,
    contextLength: numOrNull(v.context_length),
    tools: v.tools === true,
    vision: v.vision === true,
    json: v.json === true,
    free: v.free === true,
  };
}

function requirementOf(v: unknown): Requirement {
  if (!isRecord(v)) return {};
  return {
    ...(v.tools === true ? { tools: true } : {}),
    ...(v.vision === true ? { vision: true } : {}),
    ...(v.json === true ? { json: true } : {}),
    ...(numOrNull(v.min_context) !== null ? { minContext: numOrNull(v.min_context) as number } : {}),
  };
}

function workloadOf(v: unknown): WorkloadRow | null {
  if (!isRecord(v) || str(v.id) === '') return null;
  return {
    id: str(v.id),
    api: v.api === 'anthropic' ? 'anthropic' : 'openai',
    stream: v.stream === true,
    weight: v.weight === 2 ? 2 : 1,
    requires: requirementOf(v.requires),
  };
}

/** The brief at `path`: its three documents, or an empty brief with the reason in `error`. */
export function readBrief(path: string): Brief {
  const empty: Brief = { providers: [], ratings: [], workload: [], error: null };
  if (path === '') return { ...empty, error: 'MAKEFUN_PROMPT_FILE is not set' };
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    return { ...empty, error: `cannot read the brief: ${(err as Error).message}` };
  }
  const docs = documentsIn(text);
  const directory = docs.find((d) => d.schema === PROVIDERS_SCHEMA && Array.isArray(d.providers));
  if (directory === undefined) return { ...empty, error: `the brief holds no ${PROVIDERS_SCHEMA} document` };
  const providers = (directory.providers as unknown[]).flatMap((v) => {
    const p = providerOf(v);
    return p === null ? [] : [p];
  });
  const ratingsDoc = docs.find((d) => d.schema === RATINGS_SCHEMA && Array.isArray(d.ratings));
  const ratings = ratingsDoc === undefined ? [] : (ratingsDoc.ratings as unknown[]).flatMap((v) => {
    const r = ratingOf(v);
    return r === null ? [] : [r];
  });
  const workloadDoc = docs.find((d) => d.schema === WORKLOAD_SCHEMA && Array.isArray(d.manifest));
  const workload = workloadDoc === undefined ? [] : (workloadDoc.manifest as unknown[]).flatMap((v) => {
    const w = workloadOf(v);
    return w === null ? [] : [w];
  });
  return { providers, ratings, workload, error: null };
}

/** The quality table's row for one provider's model, or null where the table has none. */
export function ratingRow(brief: Brief, providerId: string, modelId: string): RatingRow | null {
  return brief.ratings.find((r) => r.provider === providerId && r.model === modelId) ?? null;
}

/** Whether a model with these capabilities meets a request's requirements; unknown never meets. */
export function meets(requires: Requirement, caps: { tools: boolean; vision: boolean; json: boolean; contextLength: number | null }): boolean {
  if (requires.tools === true && !caps.tools) return false;
  if (requires.vision === true && !caps.vision) return false;
  if (requires.json === true && !caps.json) return false;
  if (requires.minContext !== undefined && (caps.contextLength === null || caps.contextLength < requires.minContext)) return false;
  return true;
}

/** A listing's price word: false only when some price is a positive number; null when it says nothing. */
function listingFree(v: Json): boolean | null {
  if (typeof v.free === 'boolean') return v.free;
  const pricing = isRecord(v.pricing) ? v.pricing : null;
  if (pricing === null) return null;
  const values = Object.values(pricing).flatMap((x) => {
    if (typeof x === 'number') return [x];
    if (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x))) return [Number(x)];
    return [];
  });
  if (values.length === 0) return null;
  return values.every((n) => n === 0);
}

function listedModel(wire: Wire, v: unknown): ListedModel | null {
  if (!isRecord(v)) return null;
  const id = wire === 'gemini' ? str(v.name).replace(/^models\//, '') : str(v.id);
  if (id === '') return null;
  return { id, free: listingFree(v), contextLength: numOrNull(v.context_length) ?? numOrNull(v.context_window) ?? numOrNull(v.inputTokenLimit) };
}

/** Probe one provider's catalog route in its own wire; every failure leaves an empty, not-ok probe. */
export async function probeProvider(envUrl: string, provider: ProviderEntry, timeoutMs: number): Promise<Probe> {
  const base = dialBase(envUrl, provider.base);
  const url = provider.wire === 'gemini' ? `${base}/v1beta/models` : `${base}/v1/models`;
  const headers: Record<string, string> = { accept: 'application/json', ...authHeaders(provider.auth, provider.key) };
  if (provider.wire === 'anthropic') headers['anthropic-version'] = '2023-06-01';
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { provider, ok: false, models: [] };
    const body: unknown = await res.json();
    if (!isRecord(body)) return { provider, ok: false, models: [] };
    const list = provider.wire === 'gemini' ? body.models : body.data;
    if (!Array.isArray(list)) return { provider, ok: false, models: [] };
    return {
      provider,
      ok: true,
      models: list.flatMap((v) => {
        const m = listedModel(provider.wire, v);
        return m === null ? [] : [m];
      }),
    };
  } catch {
    return { provider, ok: false, models: [] };
  }
}

/**
 * The one catalog: every provider that answered its probe, every model it listed, the free flag from
 * the quality table where the table has a row (it is the sealed truth) and from the listing otherwise.
 * `base_url` stays the brief's own path — the env's origin differs between a live pass and its replay,
 * and this document is part of what a replay must reproduce.
 */
export function buildCatalog(brief: Brief, probes: readonly Probe[]): Catalog {
  const providers: Catalog['providers'] = [];
  for (const probe of probes) {
    if (!probe.ok) continue;
    const seen = new Set<string>();
    const models: CatalogModel[] = [];
    for (const model of [...probe.models].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      if (seen.has(model.id)) continue;
      seen.add(model.id);
      const row = ratingRow(brief, probe.provider.id, model.id);
      models.push({ id: model.id, free: row !== null ? row.free : (model.free ?? false), context_length: row?.contextLength ?? model.contextLength });
    }
    providers.push({ id: probe.provider.id, base_url: probe.provider.base, key_env: probe.provider.keyEnv, wire: probe.provider.wire, models });
  }
  return { providers };
}
