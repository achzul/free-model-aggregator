// The canonical conversation and every translation this aggregator speaks.
//
// A client request (OpenAI Chat Completions or Anthropic Messages) is parsed once into a canonical
// form; the canonical form is rendered onto the chosen provider's wire (OpenAI, Anthropic or
// Gemini); the provider's answer is parsed back into a canonical answer and rendered onto the
// client's wire, as JSON or as a server-sent-event stream.
//
// The translations are built to preserve, byte for byte, the five things a provider echoes from what
// it was sent and a client compares against what it sent: the system text, the last user turn's
// text, the tool names in order, the max_tokens value, the stop list, and the image (by hash). The
// rules each wire's parser applies, mirrored here:
//   - a message's text is its text blocks joined with "\n" (a string content is itself);
//   - the system text is every system part joined with "\n";
//   - the user text is the LAST user turn's text — so when a conversation ends on a tool-result
//     turn, the renderers append a closing user turn carrying the canonical user text, keeping the
//     last-user-turn text identical on every wire;
//   - an image hashes by its bytes (a data URL decodes to the same bytes on every wire) or by its
//     URL string, so images travel as base64 or as the same URL, never re-encoded;
//   - JSON mode exists only on the OpenAI wire (response_format) and the Gemini wire
//     (responseMimeType); the router never sends a JSON-mode request to an Anthropic-wire provider.
//
// Providers are always called non-streaming: the answer's stop and usage are the same either way,
// and the client's stream is synthesized from the one canonical answer, in the client's own event
// order. Everything here is a pure function of its arguments — no clock, no randomness — so a live
// pass and its replay produce the same bytes.

import { isRecord, type Json } from './brief.ts';

export interface CanonImage {
  base64: string | null;
  mediaType: string | null;
  url: string | null;
}

export interface CanonToolCall {
  id: string;
  name: string;
  /** The call's arguments as a JSON string (the OpenAI spelling; Anthropic's input object stringifies to it). */
  arguments: string;
}

export interface CanonToolResult {
  id: string;
  text: string;
  isError: boolean;
}

export interface CanonTurn {
  role: 'user' | 'assistant' | 'tool';
  /** The turn's text: its text blocks joined with "\n" ("" when it carries none). */
  text: string;
  hasText: boolean;
  images: CanonImage[];
  toolCalls: CanonToolCall[];
  toolResults: CanonToolResult[];
}

export interface CanonTool {
  name: string;
  description: string;
  parameters: Json;
}

export type ToolChoice = { mode: 'auto' | 'any' | 'none' } | { mode: 'tool'; name: string };

export interface CanonRequest {
  system: string;
  turns: CanonTurn[];
  /** The last user turn's text, as the client's own wire parses it. */
  userText: string;
  tools: CanonTool[];
  toolChoice: ToolChoice | null;
  maxTokens: number | null;
  stops: string[];
  jsonMode: boolean;
  /** The client's own response_format object, passed through untouched on the OpenAI wire. */
  responseFormat: Json | null;
  temperature: number | null;
  topP: number | null;
  stream: boolean;
}

export interface CanonAnswer {
  text: string;
  /** OpenAI spelling: stop | length | tool_calls | content_filter. */
  stop: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  usage: { input: number; output: number };
}

/** A message body's text under every wire's parser: a string is itself; blocks join with "\n". */
export function blocksText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join('\n');
}

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strList = (v: unknown): string[] => {
  if (typeof v === 'string') return [v];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
};

/** A data URL or plain URL as a canonical image; bytes are kept as the base64 the sender used. */
function imageOfUrl(url: string): CanonImage {
  const data = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
  if (data !== null && data[2] !== undefined) return { base64: data[3], mediaType: data[1] ?? null, url: null };
  return { base64: null, mediaType: null, url };
}

function imageDataUrl(image: CanonImage): string {
  return `data:${image.mediaType ?? 'image/png'};base64,${image.base64 ?? ''}`;
}

/** The tool name a tool result answers, found by its call id in the turns before it ("" when unknown). */
function toolNameOf(turns: readonly CanonTurn[], id: string): string {
  for (const turn of turns) for (const call of turn.toolCalls) if (call.id === id) return call.name;
  return '';
}

// --------------------------------------------------------------------------- client requests in

/** An OpenAI Chat Completions body as a canonical request. */
export function parseOpenAIRequest(body: Json): CanonRequest {
  const messages = Array.isArray(body.messages) ? body.messages.filter(isRecord) : [];
  const systemParts: string[] = [];
  const turns: CanonTurn[] = [];
  let userText = '';
  for (const message of messages) {
    const role = message.role;
    if (role === 'system' || role === 'developer') {
      const text = blocksText(message.content);
      if (text !== '') systemParts.push(text);
      continue;
    }
    if (role === 'user') {
      const images: CanonImage[] = [];
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (isRecord(block) && block.type === 'image_url' && isRecord(block.image_url) && typeof block.image_url.url === 'string') {
            images.push(imageOfUrl(block.image_url.url));
          }
        }
      }
      const text = blocksText(message.content);
      userText = text;
      turns.push({ role: 'user', text, hasText: text !== '' || typeof message.content === 'string', images, toolCalls: [], toolResults: [] });
      continue;
    }
    if (role === 'assistant') {
      const toolCalls: CanonToolCall[] = [];
      if (Array.isArray(message.tool_calls)) {
        for (const call of message.tool_calls) {
          if (!isRecord(call) || !isRecord(call.function)) continue;
          toolCalls.push({
            id: typeof call.id === 'string' ? call.id : '',
            name: typeof call.function.name === 'string' ? call.function.name : '',
            arguments: typeof call.function.arguments === 'string' ? call.function.arguments : '{}',
          });
        }
      }
      const text = blocksText(message.content);
      turns.push({ role: 'assistant', text, hasText: text !== '', images: [], toolCalls, toolResults: [] });
      continue;
    }
    if (role === 'tool') {
      const text = typeof message.content === 'string' ? message.content : blocksText(message.content);
      turns.push({
        role: 'tool',
        text: '',
        hasText: false,
        images: [],
        toolCalls: [],
        toolResults: [{ id: typeof message.tool_call_id === 'string' ? message.tool_call_id : '', text, isError: false }],
      });
    }
  }
  const tools: CanonTool[] = [];
  if (Array.isArray(body.tools)) {
    for (const tool of body.tools) {
      if (!isRecord(tool) || !isRecord(tool.function) || typeof tool.function.name !== 'string') continue;
      tools.push({
        name: tool.function.name,
        description: typeof tool.function.description === 'string' ? tool.function.description : '',
        parameters: isRecord(tool.function.parameters) ? tool.function.parameters : { type: 'object', properties: {} },
      });
    }
  }
  let toolChoice: ToolChoice | null = null;
  if (body.tool_choice === 'auto') toolChoice = { mode: 'auto' };
  else if (body.tool_choice === 'required') toolChoice = { mode: 'any' };
  else if (body.tool_choice === 'none') toolChoice = { mode: 'none' };
  else if (isRecord(body.tool_choice) && isRecord(body.tool_choice.function) && typeof body.tool_choice.function.name === 'string') {
    toolChoice = { mode: 'tool', name: body.tool_choice.function.name };
  }
  const format = isRecord(body.response_format) ? body.response_format : null;
  return {
    system: systemParts.join('\n'),
    turns,
    userText,
    tools,
    toolChoice,
    maxTokens: numOrNull(body.max_tokens) ?? numOrNull(body.max_completion_tokens),
    stops: strList(body.stop),
    jsonMode: format !== null && (format.type === 'json_object' || format.type === 'json_schema'),
    responseFormat: format,
    temperature: numOrNull(body.temperature),
    topP: numOrNull(body.top_p),
    stream: body.stream === true,
  };
}

/** An Anthropic Messages body as a canonical request. */
export function parseAnthropicRequest(body: Json): CanonRequest {
  const turns: CanonTurn[] = [];
  let userText = '';
  const messages = Array.isArray(body.messages) ? body.messages.filter(isRecord) : [];
  for (const message of messages) {
    const content = message.content;
    if (message.role === 'assistant') {
      const toolCalls: CanonToolCall[] = [];
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!isRecord(block) || block.type !== 'tool_use') continue;
          toolCalls.push({
            id: typeof block.id === 'string' ? block.id : '',
            name: typeof block.name === 'string' ? block.name : '',
            arguments: JSON.stringify(isRecord(block.input) ? block.input : {}),
          });
        }
      }
      const text = blocksText(content);
      turns.push({ role: 'assistant', text, hasText: text !== '', images: [], toolCalls, toolResults: [] });
      continue;
    }
    // A user turn: text, images and tool results, in the order the client sent them.
    const images: CanonImage[] = [];
    const toolResults: CanonToolResult[] = [];
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!isRecord(block)) continue;
        if (block.type === 'image' && isRecord(block.source)) {
          if (block.source.type === 'base64' && typeof block.source.data === 'string') {
            images.push({ base64: block.source.data, mediaType: typeof block.source.media_type === 'string' ? block.source.media_type : null, url: null });
          } else if (block.source.type === 'url' && typeof block.source.url === 'string') {
            images.push({ base64: null, mediaType: null, url: block.source.url });
          }
        } else if (block.type === 'tool_result') {
          const inner = block.content;
          toolResults.push({
            id: typeof block.tool_use_id === 'string' ? block.tool_use_id : '',
            text: typeof inner === 'string' ? inner : blocksText(inner) !== '' ? blocksText(inner) : inner === undefined ? '' : JSON.stringify(inner),
            isError: block.is_error === true,
          });
        }
      }
    }
    const text = blocksText(content);
    userText = text;
    turns.push({ role: 'user', text, hasText: text !== '' || typeof content === 'string', images, toolCalls: [], toolResults });
  }
  const tools: CanonTool[] = [];
  if (Array.isArray(body.tools)) {
    for (const tool of body.tools) {
      if (!isRecord(tool) || typeof tool.name !== 'string') continue;
      tools.push({
        name: tool.name,
        description: typeof tool.description === 'string' ? tool.description : '',
        parameters: isRecord(tool.input_schema) ? tool.input_schema : { type: 'object', properties: {} },
      });
    }
  }
  let toolChoice: ToolChoice | null = null;
  if (isRecord(body.tool_choice)) {
    if (body.tool_choice.type === 'auto') toolChoice = { mode: 'auto' };
    else if (body.tool_choice.type === 'any') toolChoice = { mode: 'any' };
    else if (body.tool_choice.type === 'none') toolChoice = { mode: 'none' };
    else if (body.tool_choice.type === 'tool' && typeof body.tool_choice.name === 'string') toolChoice = { mode: 'tool', name: body.tool_choice.name };
  }
  return {
    system: blocksText(body.system),
    turns,
    userText,
    tools,
    toolChoice,
    maxTokens: numOrNull(body.max_tokens),
    stops: strList(body.stop_sequences),
    jsonMode: false,
    responseFormat: null,
    temperature: numOrNull(body.temperature),
    topP: numOrNull(body.top_p),
    stream: body.stream === true,
  };
}

// --------------------------------------------------------------------------- provider requests out

/** The canonical request on the OpenAI wire, naming `model`. */
export function renderOpenAIRequest(canon: CanonRequest, model: string): Json {
  const messages: Json[] = [];
  if (canon.system !== '') messages.push({ role: 'system', content: canon.system });
  for (const turn of canon.turns) {
    if (turn.role === 'user') {
      for (const result of turn.toolResults) messages.push({ role: 'tool', tool_call_id: result.id, content: result.text });
      if (turn.hasText || turn.images.length > 0) {
        if (turn.images.length === 0) {
          messages.push({ role: 'user', content: turn.text });
        } else {
          const parts: Json[] = [];
          if (turn.hasText) parts.push({ type: 'text', text: turn.text });
          for (const image of turn.images) parts.push({ type: 'image_url', image_url: { url: image.base64 !== null ? imageDataUrl(image) : (image.url ?? '') } });
          messages.push({ role: 'user', content: parts });
        }
      } else if (turn.toolResults.length === 0) {
        messages.push({ role: 'user', content: '' });
      }
      continue;
    }
    if (turn.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: turn.text !== '' ? turn.text : turn.toolCalls.length > 0 ? null : '',
        ...(turn.toolCalls.length > 0
          ? { tool_calls: turn.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) }
          : {}),
      });
      continue;
    }
    for (const result of turn.toolResults) messages.push({ role: 'tool', tool_call_id: result.id, content: result.text });
  }
  // The last user message on this wire must carry the canonical user text (see the header note).
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (lastUser === undefined || blocksText(lastUser.content) !== canon.userText) messages.push({ role: 'user', content: canon.userText });

  const out: Json = { model, messages };
  if (canon.tools.length > 0) {
    out.tools = canon.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  }
  if (canon.toolChoice !== null) {
    if (canon.toolChoice.mode === 'auto') out.tool_choice = 'auto';
    else if (canon.toolChoice.mode === 'any') out.tool_choice = 'required';
    else if (canon.toolChoice.mode === 'none') out.tool_choice = 'none';
    else out.tool_choice = { type: 'function', function: { name: canon.toolChoice.name } };
  }
  if (canon.maxTokens !== null) out.max_tokens = canon.maxTokens;
  if (canon.stops.length > 0) out.stop = canon.stops;
  if (canon.jsonMode) out.response_format = canon.responseFormat ?? { type: 'json_object' };
  if (canon.temperature !== null) out.temperature = canon.temperature;
  if (canon.topP !== null) out.top_p = canon.topP;
  return out;
}

/** The canonical request on the Anthropic wire, naming `model`. */
export function renderAnthropicRequest(canon: CanonRequest, model: string): Json {
  const messages: Json[] = [];
  for (const turn of canon.turns) {
    if (turn.role === 'assistant') {
      const blocks: Json[] = [];
      if (turn.hasText) blocks.push({ type: 'text', text: turn.text });
      for (const call of turn.toolCalls) {
        let input: unknown = {};
        try {
          input = JSON.parse(call.arguments);
        } catch {
          input = {};
        }
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: isRecord(input) ? input : {} });
      }
      messages.push({ role: 'assistant', content: blocks.length > 0 ? blocks : [{ type: 'text', text: '' }] });
      continue;
    }
    const blocks: Json[] = [];
    for (const result of turn.toolResults) {
      blocks.push({ type: 'tool_result', tool_use_id: result.id, content: result.text, ...(result.isError ? { is_error: true } : {}) });
    }
    if (turn.role === 'user') {
      if (turn.hasText) blocks.push({ type: 'text', text: turn.text });
      for (const image of turn.images) {
        blocks.push(
          image.base64 !== null
            ? { type: 'image', source: { type: 'base64', media_type: image.mediaType ?? 'image/png', data: image.base64 } }
            : { type: 'image', source: { type: 'url', url: image.url ?? '' } },
        );
      }
    }
    if (blocks.length === 0) blocks.push({ type: 'text', text: '' });
    messages.push({ role: 'user', content: blocks });
  }
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (lastUser === undefined || blocksText(lastUser.content) !== canon.userText) {
    messages.push({ role: 'user', content: [{ type: 'text', text: canon.userText }] });
  }

  const out: Json = { model, messages };
  if (canon.system !== '') out.system = canon.system;
  if (canon.maxTokens !== null) out.max_tokens = canon.maxTokens;
  if (canon.tools.length > 0) {
    out.tools = canon.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  }
  if (canon.toolChoice !== null) {
    if (canon.toolChoice.mode === 'auto') out.tool_choice = { type: 'auto' };
    else if (canon.toolChoice.mode === 'any') out.tool_choice = { type: 'any' };
    else if (canon.toolChoice.mode === 'none') out.tool_choice = { type: 'none' };
    else out.tool_choice = { type: 'tool', name: canon.toolChoice.name };
  }
  if (canon.stops.length > 0) out.stop_sequences = canon.stops;
  if (canon.temperature !== null) out.temperature = canon.temperature;
  if (canon.topP !== null) out.top_p = canon.topP;
  return out;
}

/** The canonical request on the Gemini wire; the model travels in the URL path, not the body. */
export function renderGeminiRequest(canon: CanonRequest): Json {
  const contents: Json[] = [];
  for (const turn of canon.turns) {
    if (turn.role === 'assistant') {
      const parts: Json[] = [];
      if (turn.hasText) parts.push({ text: turn.text });
      for (const call of turn.toolCalls) {
        let args: unknown = {};
        try {
          args = JSON.parse(call.arguments);
        } catch {
          args = {};
        }
        parts.push({ functionCall: { name: call.name, args: isRecord(args) ? args : {} } });
      }
      contents.push({ role: 'model', parts: parts.length > 0 ? parts : [{ text: '' }] });
      continue;
    }
    const parts: Json[] = [];
    for (const result of turn.toolResults) {
      parts.push({ functionResponse: { name: toolNameOf(canon.turns, result.id), response: { result: result.text } } });
    }
    if (turn.role === 'user') {
      if (turn.hasText) parts.push({ text: turn.text });
      for (const image of turn.images) {
        parts.push(
          image.base64 !== null
            ? { inlineData: { mimeType: image.mediaType ?? 'image/png', data: image.base64 } }
            : { fileData: { fileUri: image.url ?? '' } },
        );
      }
    }
    if (parts.length === 0) parts.push({ text: '' });
    contents.push({ role: 'user', parts });
  }
  const lastUser = [...contents].reverse().find((c) => c.role === 'user');
  const lastText = lastUser === undefined ? null : (Array.isArray(lastUser.parts) ? lastUser.parts : [])
    .flatMap((p) => (isRecord(p) && typeof p.text === 'string' ? [p.text] : []))
    .join('\n');
  if (lastText !== canon.userText) contents.push({ role: 'user', parts: [{ text: canon.userText }] });

  const out: Json = { contents };
  if (canon.system !== '') out.systemInstruction = { parts: [{ text: canon.system }] };
  if (canon.tools.length > 0) {
    out.tools = [{ functionDeclarations: canon.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }];
  }
  if (canon.toolChoice !== null) {
    const mode = canon.toolChoice.mode === 'auto' ? 'AUTO' : canon.toolChoice.mode === 'any' ? 'ANY' : canon.toolChoice.mode === 'none' ? 'NONE' : 'ANY';
    out.toolConfig = {
      functionCallingConfig: {
        mode,
        ...(canon.toolChoice.mode === 'tool' ? { allowedFunctionNames: [canon.toolChoice.name] } : {}),
      },
    };
  }
  const config: Json = {};
  if (canon.maxTokens !== null) config.maxOutputTokens = canon.maxTokens;
  if (canon.stops.length > 0) config.stopSequences = canon.stops;
  if (canon.temperature !== null) config.temperature = canon.temperature;
  if (canon.topP !== null) config.topP = canon.topP;
  if (canon.jsonMode) config.responseMimeType = 'application/json';
  if (Object.keys(config).length > 0) out.generationConfig = config;
  return out;
}

// --------------------------------------------------------------------------- provider answers in

function stopFromOpenAI(finish: unknown): CanonAnswer['stop'] {
  if (finish === 'length') return 'length';
  if (finish === 'tool_calls' || finish === 'function_call') return 'tool_calls';
  if (finish === 'content_filter') return 'content_filter';
  return 'stop';
}

function stopFromAnthropic(reason: unknown): CanonAnswer['stop'] {
  if (reason === 'max_tokens') return 'length';
  if (reason === 'tool_use') return 'tool_calls';
  if (reason === 'refusal') return 'content_filter';
  return 'stop';
}

function stopFromGemini(reason: unknown): CanonAnswer['stop'] {
  if (reason === 'MAX_TOKENS') return 'length';
  if (reason === 'SAFETY' || reason === 'PROHIBITED_CONTENT') return 'content_filter';
  return 'stop';
}

const num0 = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** An answer body's text: its text blocks concatenated whole, as the answering wire carries them. */
function answerTextOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.flatMap((b) => (isRecord(b) && b.type === 'text' && typeof b.text === 'string' ? [b.text] : [])).join('');
}

/** A Chat Completions JSON answer as a canonical answer (null when it is not one). */
export function parseOpenAIAnswer(body: unknown): CanonAnswer | null {
  if (!isRecord(body)) return null;
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const choice = isRecord(choices[0]) ? choices[0] : null;
  if (choice === null || !isRecord(choice.message)) return null;
  const content = choice.message.content;
  const text = answerTextOf(content);
  const usage = isRecord(body.usage) ? body.usage : {};
  return { text, stop: stopFromOpenAI(choice.finish_reason), usage: { input: num0(usage.prompt_tokens), output: num0(usage.completion_tokens) } };
}

/** A Messages JSON answer as a canonical answer (null when it is not one). */
export function parseAnthropicAnswer(body: unknown): CanonAnswer | null {
  if (!isRecord(body) || !Array.isArray(body.content)) return null;
  const usage = isRecord(body.usage) ? body.usage : {};
  return { text: answerTextOf(body.content), stop: stopFromAnthropic(body.stop_reason), usage: { input: num0(usage.input_tokens), output: num0(usage.output_tokens) } };
}

/** A Gemini generateContent JSON answer as a canonical answer (null when it is not one). */
export function parseGeminiAnswer(body: unknown): CanonAnswer | null {
  if (!isRecord(body)) return null;
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  const candidate = isRecord(candidates[0]) ? candidates[0] : null;
  if (candidate === null || !isRecord(candidate.content)) return null;
  const parts = Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  const text = parts.flatMap((p) => (isRecord(p) && typeof p.text === 'string' ? [p.text] : [])).join('');
  const usage = isRecord(body.usageMetadata) ? body.usageMetadata : {};
  return { text, stop: stopFromGemini(candidate.finishReason), usage: { input: num0(usage.promptTokenCount), output: num0(usage.candidatesTokenCount) } };
}

// --------------------------------------------------------------------------- client answers out

/** The fixed epoch second on every OpenAI-shaped document this server emits (nothing reads a clock). */
export const FIXED_CREATED = 1767225600;
/** The fixed instant on every Anthropic-shaped model listing. */
export const FIXED_CREATED_AT = '2026-01-01T00:00:00Z';

function stopToAnthropic(stop: CanonAnswer['stop']): string {
  if (stop === 'length') return 'max_tokens';
  if (stop === 'tool_calls') return 'tool_use';
  if (stop === 'content_filter') return 'refusal';
  return 'end_turn';
}

/** The canonical answer as a Chat Completions object naming the model that served it. */
export function renderOpenAIAnswer(answer: CanonAnswer, model: string, seq: number): Json {
  return {
    id: `chatcmpl-agg-${seq}`,
    object: 'chat.completion',
    created: FIXED_CREATED,
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: answer.text }, finish_reason: answer.stop, logprobs: null }],
    usage: { prompt_tokens: answer.usage.input, completion_tokens: answer.usage.output, total_tokens: answer.usage.input + answer.usage.output },
  };
}

/** The canonical answer as a Messages object naming the model that served it. */
export function renderAnthropicAnswer(answer: CanonAnswer, model: string, seq: number): Json {
  return {
    id: `msg_agg_${seq}`,
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text: answer.text }],
    stop_reason: stopToAnthropic(answer.stop),
    stop_sequence: null,
    usage: { input_tokens: answer.usage.input, output_tokens: answer.usage.output },
  };
}

function sse(event: string | null, data: unknown): string {
  return `${event === null ? '' : `event: ${event}\n`}data: ${JSON.stringify(data)}\n\n`;
}

function pieces(text: string, size = 24): string[] {
  const out: string[] = [];
  for (let at = 0; at < text.length; at += size) out.push(text.slice(at, at + size));
  return out.length === 0 ? [''] : out;
}

/** The canonical answer as a Chat Completions event stream: content, finish, usage, [DONE]. */
export function renderOpenAIStream(answer: CanonAnswer, model: string, seq: number): string {
  const chunk = (delta: Json, finish: string | null): Json => ({
    id: `chatcmpl-agg-${seq}`,
    object: 'chat.completion.chunk',
    created: FIXED_CREATED,
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  });
  const frames: string[] = [sse(null, chunk({ role: 'assistant', content: '' }, null))];
  if (answer.text !== '') for (const piece of pieces(answer.text)) frames.push(sse(null, chunk({ content: piece }, null)));
  frames.push(sse(null, chunk({}, answer.stop)));
  frames.push(
    sse(null, {
      id: `chatcmpl-agg-${seq}`,
      object: 'chat.completion.chunk',
      created: FIXED_CREATED,
      model,
      choices: [],
      usage: { prompt_tokens: answer.usage.input, completion_tokens: answer.usage.output, total_tokens: answer.usage.input + answer.usage.output },
    }),
  );
  frames.push('data: [DONE]\n\n');
  return frames.join('');
}

/** The canonical answer as a Messages event stream, in the API's own event order. */
export function renderAnthropicStream(answer: CanonAnswer, model: string, seq: number): string {
  const frames: string[] = [
    sse('message_start', {
      type: 'message_start',
      message: {
        id: `msg_agg_${seq}`,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: answer.usage.input, output_tokens: 0 },
      },
    }),
    sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
  ];
  if (answer.text !== '') {
    for (const piece of pieces(answer.text)) {
      frames.push(sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } }));
    }
  }
  frames.push(sse('content_block_stop', { type: 'content_block_stop', index: 0 }));
  frames.push(
    sse('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stopToAnthropic(answer.stop), stop_sequence: null },
      usage: { output_tokens: answer.usage.output },
    }),
  );
  frames.push(sse('message_stop', { type: 'message_stop' }));
  return frames.join('');
}

/** An error in the OpenAI wire's envelope. */
export function openAIError(message: string, type: string, code: string | null): Json {
  return { error: { message, type, code } };
}

/** An error in the Anthropic wire's envelope. */
export function anthropicError(type: string, message: string): Json {
  return { type: 'error', error: { type, message } };
}
