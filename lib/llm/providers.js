// Provider adapters for Claude, ChatGPT (OpenAI) and Gemini. Each adapter speaks the vendor's REST API
// directly (no SDKs) and exposes the same three steps so one agent loop works for all of them:
//   init({system, tools, history, userText}) -> state
//   call(state) -> { text, calls: [{id, name, args}], raw }
//   append(state, raw, results: [{id, name, result}]) -> mutates state with the tool round-trip
// `history` is neutral: [{role: 'user' | 'assistant', text}]. Tool traces are not kept between turns.

async function post(url, headers, body, label, timeoutMs = 60_000) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new Error(`${label}: request failed (${e.name === 'TimeoutError' ? 'timed out' : e.message})`);
  }
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) {
    const msg = json?.error?.message || json?.message || text.slice(0, 200);
    throw new Error(`${label}: HTTP ${res.status} ${msg}`);
  }
  return json;
}

const parseArgs = (s) => { try { return typeof s === 'string' ? JSON.parse(s || '{}') : (s ?? {}); } catch { return {}; } };

/* ───────────── Claude (Anthropic Messages API) ───────────── */
export const anthropic = ({ apiKey, model, baseUrl = 'https://api.anthropic.com', timeoutMs }) => ({
  init: ({ system, tools, history, userText }) => ({
    system,
    tools: tools.length ? tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema })) : undefined,
    messages: [...history.map((m) => ({ role: m.role, content: m.text })), { role: 'user', content: userText }],
  }),
  async call(s) {
    const r = await post(`${baseUrl}/v1/messages`, { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      { model, max_tokens: 1024, system: s.system, tools: s.tools, messages: s.messages }, 'Claude', timeoutMs);
    const blocks = r.content ?? [];
    return {
      text: blocks.filter((b) => b.type === 'text').map((b) => b.text).join('').trim(),
      calls: blocks.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input ?? {} })),
      raw: blocks,
    };
  },
  append(s, raw, results) {
    s.messages.push({ role: 'assistant', content: raw });
    s.messages.push({ role: 'user', content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: String(r.result) })) });
  },
});

/* ───────────── ChatGPT (OpenAI Chat Completions) ───────────── */
export const openai = ({ apiKey, model, baseUrl = 'https://api.openai.com', timeoutMs }) => ({
  init: ({ system, tools, history, userText }) => ({
    tools: tools.length ? tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } })) : undefined,
    messages: [{ role: 'system', content: system }, ...history.map((m) => ({ role: m.role, content: m.text })), { role: 'user', content: userText }],
  }),
  async call(s) {
    const r = await post(`${baseUrl}/v1/chat/completions`, { authorization: `Bearer ${apiKey}` },
      { model, messages: s.messages, tools: s.tools }, 'ChatGPT', timeoutMs);
    const msg = r.choices?.[0]?.message ?? {};
    return {
      text: (msg.content ?? '').trim(),
      calls: (msg.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function?.name, args: parseArgs(c.function?.arguments) })),
      raw: msg,
    };
  },
  append(s, raw, results) {
    s.messages.push(raw);
    for (const r of results) s.messages.push({ role: 'tool', tool_call_id: r.id, content: String(r.result) });
  },
});

/* ───────────── Gemini (generateContent) ───────────── */
export const gemini = ({ apiKey, model, baseUrl = 'https://generativelanguage.googleapis.com', timeoutMs }) => ({
  init: ({ system, tools, history, userText }) => ({
    system,
    tools: tools.length ? [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.schema })) }] : undefined,
    contents: [...history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })), { role: 'user', parts: [{ text: userText }] }],
  }),
  async call(s) {
    const r = await post(`${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': apiKey },
      { systemInstruction: { parts: [{ text: s.system }] }, tools: s.tools, contents: s.contents }, 'Gemini', timeoutMs);
    const content = r.candidates?.[0]?.content ?? { role: 'model', parts: [] };
    const parts = content.parts ?? [];
    return {
      text: parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('').trim(),
      calls: parts.filter((p) => p.functionCall).map((p, i) => ({ id: p.functionCall.id ?? `call_${i}`, name: p.functionCall.name, args: p.functionCall.args ?? {} })),
      raw: content, // sent back verbatim so thought signatures survive the round-trip
    };
  },
  append(s, raw, results) {
    s.contents.push(raw);
    s.contents.push({ role: 'user', parts: results.map((r) => ({ functionResponse: { name: r.name, response: { result: String(r.result) } } })) });
  },
});

export const PROVIDERS = {
  anthropic: { label: 'Claude', keyEnv: ['ANTHROPIC_API_KEY'], modelEnv: 'ANTHROPIC_MODEL', baseEnv: 'ANTHROPIC_BASE_URL', defaultModel: 'claude-sonnet-5-5', make: anthropic },
  openai: { label: 'ChatGPT', keyEnv: ['OPENAI_API_KEY'], modelEnv: 'OPENAI_MODEL', baseEnv: 'OPENAI_BASE_URL', defaultModel: 'gpt-5', make: openai },
  gemini: { label: 'Gemini', keyEnv: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], modelEnv: 'GEMINI_MODEL', baseEnv: 'GEMINI_BASE_URL', defaultModel: 'gemini-3.8-flash', make: gemini },
};

const firstEnv = (env, names) => names.map((n) => env[n]).find(Boolean);

/** What the UI may know: never includes keys. */
export function listProviders(env = process.env) {
  return Object.entries(PROVIDERS).map(([id, p]) => ({
    id, label: p.label, available: Boolean(firstEnv(env, p.keyEnv)), defaultModel: env[p.modelEnv] || p.defaultModel,
  }));
}

export function createAdapter(id, { model, env = process.env, timeoutMs } = {}) {
  const p = PROVIDERS[id];
  if (!p) throw new Error(`Unknown provider "${id}"`);
  const apiKey = firstEnv(env, p.keyEnv);
  if (!apiKey) throw new Error(`${p.label} is not configured: set ${p.keyEnv[0]} in .env and restart the server`);
  const opts = { apiKey, model: model || env[p.modelEnv] || p.defaultModel, timeoutMs };
  if (env[p.baseEnv]) opts.baseUrl = env[p.baseEnv];
  return p.make(opts);
}
