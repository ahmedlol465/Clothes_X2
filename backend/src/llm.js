/**
 * Free-tier LLM provider (§6.3 AI service).
 *
 * Default: Google Gemini with a FREE key (no card) via its OpenAI-compatible
 * endpoint. Also supports Groq / OpenRouter / OpenAI through the same shape —
 * pick with LLM_PROVIDER. No npm dependencies (uses global fetch).
 *
 *   1. Get a free key:  https://aistudio.google.com/apikey
 *   2. backend/.env:     GEMINI_API_KEY=paste-it-here
 *   3. Restart:          npm start
 *
 * Without any key every caller falls back to the rule engine, so the app keeps
 * working fully offline.
 *
 * What changed for the stylist rebuild:
 *   • `stylistChat` now receives the CONVERSATION HISTORY and a STYLE MEMORY
 *     digest, so the assistant remembers earlier turns instead of resetting
 *     every message (the old version accepted `history` and dropped it).
 *   • It returns STRUCTURED output — intent, occasion, constraints, follow-up
 *     question — not just prose.
 *   • `streamChat` streams tokens so the chat UI can type replies out live.
 *   • `describeOutfit` turns a photo into a structured reference spec.
 */
'use strict';

const weatherService = require('./weather');

const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 25000;

/**
 * Candidate model lists, most-preferred first.
 *
 * Free-tier model IDs turn over fast — Google alone retired
 * gemini-2.0-flash and gemini-2.5-flash for new keys within a year, and the
 * busiest aliases answer 503 "high demand" at random. A single hard-coded
 * model therefore breaks the stylist periodically for reasons the user cannot
 * fix. Instead each provider lists several and the runtime rotates through
 * them, remembering whichever answered.
 */
const PROVIDERS = {
  gemini: {
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: 'GEMINI_API_KEY',
    keyUrl: 'https://aistudio.google.com/apikey',
    models: [
      'gemini-flash-lite-latest',
      'gemini-3.1-flash-lite-preview',
      'gemini-3-flash-preview',
      'gemini-flash-latest',
      'gemini-3.8-flash',
    ],
    vision: true,
  },
  groq: {
    base: 'https://api.groq.com/openai/v1',
    keyEnv: 'GROQ_API_KEY',
    keyUrl: 'https://console.groq.com/keys',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    visionModels: ['meta-llama/llama-4-scout-17b-16e-instruct'],
    vision: true,
  },
  openrouter: {
    base: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    keyUrl: 'https://openrouter.ai/keys',
    models: [
      'meta-llama/llama-3.3-70b-instruct:free',
      'google/gemini-2.0-flash-exp:free',
    ],
    vision: true,
  },
  openai: {
    base: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY',
    keyUrl: 'https://platform.openai.com/keys',
    models: ['gpt-4o-mini'],
    vision: true,
  },
};

/** provider name → the model id that last worked, so we stop re-probing. */
const workingModel = new Map();

/** Statuses worth trying the next model for rather than reporting failure. */
const ROTATE_ON = [400, 404, 429, 500, 502, 503, 504];

/**
 * Ordered model list to try for this provider.
 *
 * An explicit `LLM_MODEL` is honoured exactly (the user asked for it, so a
 * failure should be reported rather than silently routed elsewhere). Otherwise
 * the last known-good model leads, then the rest of the list.
 */
function modelChain(p, { vision = false } = {}) {
  const list = (vision ? p.visionModels || p.models : p.models) || [];
  if (vision && !list.length) return p.models || [];
  const override = process.env.LLM_MODEL;
  if (override) return [override];
  const known = workingModel.get(p.name);
  const rest = list.filter((m) => m !== known);
  return known ? [known, ...rest] : list;
}

function pickProvider() {
  const want = String(process.env.LLM_PROVIDER || '').toLowerCase();
  if (want) {
    const p = PROVIDERS[want];
    const key = p && process.env[p.keyEnv];
    if (p && key) return { name: want, ...p, key, model: process.env.LLM_MODEL || modelChain(p)[0] };
    return {
      name: want, configured: false,
      hint: p
        ? `Set ${p.keyEnv} in backend/.env (free: ${p.keyUrl})`
        : `Unknown LLM_PROVIDER="${want}". Use: ${Object.keys(PROVIDERS).join('|')}`,
    };
  }
  for (const [name, p] of Object.entries(PROVIDERS)) {
    const key = process.env[p.keyEnv];
    if (key) return { name, ...p, key, model: process.env.LLM_MODEL || modelChain(p)[0] };
  }
  return {
    name: 'off', configured: false,
    hint: 'Set GEMINI_API_KEY in backend/.env (free, no card: https://aistudio.google.com/apikey)',
  };
}

function status() {
  const p = pickProvider();
  return {
    provider: p.name,
    model: p.model || null,
    models: p.key ? modelChain(p) : [],
    configured: !!p.key,
    vision: !!p.vision,
    ...(p.key ? {} : { howToEnable: p.hint }),
  };
}

function authHeaders(p, json = true) {
  const headers = json ? { 'Content-Type': 'application/json' } : {};
  headers.Authorization = `Bearer ${p.key}`;
  if (p.name === 'openrouter') {
    headers['HTTP-Referer'] = 'http://localhost:3001';
    headers['X-Title'] = 'SmartWardrobe';
  }
  return headers;
}

function assertProvider() {
  const p = pickProvider();
  if (!p.key) throw new Error(p.hint || 'No LLM key configured.');
  return p;
}

/**
 * Run `attempt(model)` against each candidate model in turn, keeping the first
 * success and remembering it. A model is abandoned on a retired/quota/busy
 * status or on a transport error; a real refusal (401/403) aborts immediately
 * because rotating will not fix bad credentials.
 */
async function withModelRotation(p, { vision = false }, attempt) {
  const chain = modelChain(p, { vision });
  if (!chain.length) throw new Error(`No model configured for ${p.name}.`);
  let lastError;
  for (const model of chain) {
    try {
      const result = await attempt(model);
      if (result == null) {
        lastError = new Error(`Empty reply from ${p.name}/${model}`);
        continue;
      }
      workingModel.set(p.name, model);
      return result;
    } catch (e) {
      lastError = e;
      if (!ROTATE_ON.includes(e.status)) throw e;
    }
  }
  throw lastError || new Error(`Every model for ${p.name} failed.`);
}

/** POST a chat completion, raising a status-carrying error on failure. */
async function postCompletion(p, model, payload, { timeout = TIMEOUT_MS } = {}) {
  const res = await fetch(`${p.base}/chat/completions`, {
    method: 'POST',
    headers: authHeaders(p),
    body: JSON.stringify({ model, ...payload }),
    signal: AbortSignal.timeout(timeout),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      data?.error?.message || `LLM HTTP ${res.status} (${p.name}/${model})`,
    );
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Raw chat-completions call. Returns { text, tokens }. */
async function complete({ system, user, maxTokens = 500, temperature = 0.7, json = false }) {
  const p = assertProvider();
  const data = await withModelRotation(p, {}, async (model) => {
    const res = await postCompletion(p, model, {
      temperature,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: user },
      ],
    });
    // A reasoning model can spend the whole token budget thinking and return
    // no content. That is a model problem, not a request problem — rotate.
    if (!res?.choices?.[0]?.message?.content) return null;
    return res;
  });
  const text = data?.choices?.[0]?.message?.content || '';
  const usage = data?.usage || {};
  return {
    text: String(text),
    tokens: {
      prompt: usage.prompt_tokens || 0,
      completion: usage.completion_tokens || 0,
    },
  };
}

/**
 * Extract a JSON object from model output.
 * Handles fenced blocks and prose either side, which small models add freely.
 */
function parseJson(text) {
  const raw = String(text || '');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    // A trailing comma or a stray quote from a small model is common; try a
    // light repair before giving up entirely.
    try {
      return JSON.parse(body.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return null;
    }
  }
}

// ------------------------------------------------------------- stylist chat

/** One line per candidate garment. */
function catalogLines(wardrobe = []) {
  return wardrobe
    .map((i) => [
      i.id, i.name, i.category, i.color, i.style, i.formality || '',
      i.material || '', `worn ${i.timesWorn || 0}x`,
    ].filter(Boolean).join(' | '))
    .join('\n');
}

/** Trim history to the most recent turns so the prompt stays bounded. */
function recentTurns(history = [], max = 10) {
  return (Array.isArray(history) ? history : [])
    .filter((h) => h && (h.text || h.content || h.message))
    .slice(-max)
    .map((h) => {
      const from = h.fromUser ?? (h.role === 'user');
      return `${from ? 'User' : 'Assistant'}: ${String(h.text || h.content || h.message).slice(0, 400)}`;
    })
    .join('\n');
}

const STYLIST_SYSTEM =
  'You are SmartWardrobe, a sharp, friendly personal stylist who knows this user\'s ' +
  'wardrobe intimately. You are opinionated but never condescending.\n' +
  'Rules:\n' +
  '- Ground every recommendation ONLY in the catalog ids you are given. Never invent an item.\n' +
  '- Use the conversation history and the learned preferences to stay consistent ' +
  'across turns: remember what they already wore, rejected or liked.\n' +
  '- Reference the actual weather and the actual occasion.\n' +
  '- Be concise: 2-4 sentences of warm, concrete advice. No filler, no lists of generic tips.\n' +
  '- Never claim to have done something you did not (e.g. ordered, saved, bought).\n' +
  'Reply with ONLY one JSON object, no markdown, shaped exactly:\n' +
  '{"text":"<the reply, 2-4 sentences>",' +
  '"intent":"build_outfit|remix|explain|opinion|learn|chat",' +
  '"occasion":"<short label or null>",' +
  '"itemIds":["<2-4 catalog ids forming one outfit>"],' +
  '"constraints":{"colors":[],"styles":[],"avoid":[]},' +
  '"followUp":"<one short question, or null>",' +
  '"memoryNotes":"<a durable preference learned from this message, or null>"}';

/**
 * Wardrobe-aware stylist reply with full conversational memory.
 *
 * @returns {{text, intent, occasion, itemIds, constraints, followUp,
 *            memoryNotes, tokens}}
 */
async function stylistChat({
  message, history = [], wardrobe = [], weather, styleProfile = {},
  memoryDigest = '', events = [], imageUrl = null,
}) {
  const catalog = catalogLines(wardrobe) || '(the wardrobe is empty — tell the user to add items)';
  const priorTurns = recentTurns(history);
  const agenda = (Array.isArray(events) ? events : []).slice(0, 3)
    .map((e) => `${e.title} (${e.date || 'soon'})`).join('; ');

  const sections = [
    `TODAY: ${weather?.summary || `${weather?.tempC ?? 24}°C, ${weather?.condition || 'clear'}`}`,
    `STYLE PROFILE: ${JSON.stringify(styleProfile || {})}`,
    memoryDigest ? `LEARNED PREFERENCES:\n${memoryDigest}` : '',
    agenda ? `UPCOMING EVENTS: ${agenda}` : '',
    priorTurns ? `CONVERSATION SO FAR:\n${priorTurns}` : '',
    `WARDROBE CATALOG (id | name | category | color | style | formality | material | wear count):\n${catalog}`,
  ].filter(Boolean).join('\n\n');

  const userParts = [`${sections}\n\nLATEST MESSAGE: ${message}`];
  if (imageUrl) userParts.push('The user attached a photo. Describe it briefly inside "text" and pick catalog items that recreate it.');

  const { text, tokens } = await complete({
    system: STYLIST_SYSTEM,
    user: userParts.join('\n\n'),
    maxTokens: 500,
    temperature: 0.75,
    json: true,
  });

  const parsed = parseJson(text);
  if (parsed) {
    return {
      text: String(parsed.text || '').trim(),
      intent: typeof parsed.intent === 'string' ? parsed.intent : 'chat',
      occasion: parsed.occasion ? String(parsed.occasion) : null,
      itemIds: Array.isArray(parsed.itemIds) ? parsed.itemIds.map(String).slice(0, 5) : [],
      constraints: {
        colors: arr(parsed.constraints?.colors),
        styles: arr(parsed.constraints?.styles),
        avoid: arr(parsed.constraints?.avoid),
      },
      followUp: parsed.followUp ? String(parsed.followUp) : null,
      memoryNotes: parsed.memoryNotes ? String(parsed.memoryNotes).slice(0, 200) : null,
      tokens,
    };
  }

  // Model ignored the JSON instruction — use the prose rather than failing.
  return {
    text: text.replace(/```json?|```/g, '').trim(),
    intent: 'chat', occasion: null, itemIds: [], constraints: { colors: [], styles: [], avoid: [] },
    followUp: null, memoryNotes: null, tokens,
  };
}

function arr(v) {
  return Array.isArray(v) ? v.map(String).slice(0, 6) : [];
}

/**
 * Stream a stylist reply token by token.
 *
 * Yields `{ delta }` for each token and finishes with
 * `{ done: true, text, tokens }`. Used by POST /ai/chat/stream.
 *
 * @returns {AsyncGenerator<{delta?:string, done?:boolean, text?:string, tokens?:object}>}
 */
async function* streamChat({ message, history = [], wardrobe = [], weather, styleProfile = {}, memoryDigest = '' }) {
  const p = assertProvider();
  const catalog = catalogLines(wardrobe) || '(the wardrobe is empty)';
  const priorTurns = recentTurns(history);
  const system = STYLIST_SYSTEM.replace(
    'Reply with ONLY one JSON object, no markdown, shaped exactly:\n' +
    '{"text":"<the reply, 2-4 sentences>",' +
    '"intent":"build_outfit|remix|explain|opinion|learn|chat",' +
    '"occasion":"<short label or null>",' +
    '"itemIds":["<2-4 catalog ids forming one outfit>"],' +
    '"constraints":{"colors":[],"styles":[],"avoid":[]},' +
    '"followUp":"<one short question, or null>",' +
    '"memoryNotes":"<a durable preference learned from this message, or null>"}',
    'You are streaming. Emit ONLY the reply text as plain prose — 2-4 warm sentences. ' +
    'No JSON, no markdown, no bullet points. Refer to garments by their NAME only; ' +
    'never print catalog ids, they are not for the reader.',
  );

  const user = [
    `TODAY: ${weather?.summary || 'unknown'}`,
    memoryDigest ? `LEARNED PREFERENCES:\n${memoryDigest}` : '',
    priorTurns ? `CONVERSATION SO FAR:\n${priorTurns}` : '',
    `WARDROBE CATALOG (id | name | category | color | style | formality | material | wear count):\n${catalog}`,
    `LATEST MESSAGE: ${message}`,
  ].filter(Boolean).join('\n\n');

  // Rotation is resolved before any token is yielded: once a stream starts we
  // cannot restart it without duplicating the text the user already saw.
  const res = await withModelRotation(p, {}, async (model) => {
    const response = await fetch(`${p.base}/chat/completions`, {
      method: 'POST',
      headers: authHeaders(p),
      body: JSON.stringify({
        model,
        temperature: 0.75,
        max_tokens: 500,
        stream: true,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS + 10000),
    });
    if (!response.ok || !response.body) {
      const err = await response.json().catch(() => ({}));
      const e = new Error(
        err?.error?.message || `Stream HTTP ${response.status} (${p.name}/${model})`,
      );
      e.status = response.status;
      throw e;
    }
    return response;
  });

  let full = '';
  let usage = {};
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    // SSE frames are separated by a blank line.
    let split;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      for (const line of frame.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let json;
        try {
          json = JSON.parse(payload);
        } catch {
          continue;
        }
        if (json.usage) usage = json.usage;
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          yield { delta };
        }
      }
    }
  }

  yield {
    done: true,
    text: full.trim(),
    tokens: {
      prompt: usage.prompt_tokens || 0,
      completion: usage.completion_tokens || 0,
    },
  };
}

// ------------------------------------------------------------------- vision

const VISION_ATTRS = ['category', 'color', 'style', 'pattern', 'material', 'season', 'formality'];

/** Clothing analysis from a photo. Returns { attrs, tokens }. */
async function analyzeImage({ dataUrl, hint = '' }) {
  const p = assertProvider();
  const data = await withModelRotation(p, { vision: true }, async (model) => {
    const res = await postCompletion(p, model, {
      temperature: 0.2,
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                'Analyze this clothing item. Reply with ONLY one JSON object, no other text: ' +
                '{"name": "<short garment name>", "category": "Tops|Bottoms|Shoes|Outerwear|Accessories", ' +
                '"color": "<main color>", "style": "<e.g. Casual, Formal, Smart Casual>", ' +
                '"pattern": "<Plain, Striped, Checked, Floral...>", "material": "<fabric>", ' +
                '"season": "<Spring / Summer, Autumn / Winter, All Season>", ' +
                '"formality": "<Casual, Smart Casual, Formal, Elegant>", "confidence": 0.0-1.0}' +
                (hint ? ` Hint: ${hint}` : ''),
            },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }, { timeout: 30000 });
    if (!res?.choices?.[0]?.message?.content) return null;
    return res;
  });
  const text = data?.choices?.[0]?.message?.content || '';
  const usage = data?.usage || {};
  const parsed = parseJson(text) || {};
  const attrs = {};
  for (const k of VISION_ATTRS) if (parsed[k]) attrs[k] = String(parsed[k]);
  if (parsed.name) attrs.suggestedName = String(parsed.name);
  if (parsed.confidence != null) attrs.confidence = Number(parsed.confidence);
  return {
    attrs,
    tokens: { prompt: usage.prompt_tokens || 0, completion: usage.completion_tokens || 0 },
  };
}

const OUTFIT_VISION_SYSTEM =
  'You are a fashion analyst. Look at the photo of a person and describe the outfit ' +
  'they are wearing as structured data, so it can be recreated from a different ' +
  'wardrobe. Be literal about what you can actually see — never guess a garment ' +
  'that is not in the photo. Reply with ONLY one JSON object, no markdown:\n' +
  '{"title":"<short name for the look>","occasion":"<when someone would wear this>",' +
  '"notes":"<1 sentence on the overall look>","slots":[' +
  '{"slot":"outerwear|top|bottom|shoes|accessory","garment":"<e.g. navy wool blazer>",' +
  '"color":"navy","material":"wool","pattern":"plain","formality":"formal"}]}';

/**
 * Read a photo of a full outfit and return a structured reference spec,
 * ready for `vision.matchSpec()` to match against the user's own wardrobe.
 *
 * @returns {{spec: object, tokens: object}}
 */
async function describeOutfit({ dataUrl, hint = '' }) {
  const p = assertProvider();
  const data = await withModelRotation(p, { vision: true }, async (model) => {
    const res = await postCompletion(p, model, {
      temperature: 0.2,
      max_tokens: 600,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: OUTFIT_VISION_SYSTEM + (hint ? ` Context: ${hint}` : '') },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }, { timeout: 30000 });
    if (!res?.choices?.[0]?.message?.content) return null;
    return res;
  });
  const text = data?.choices?.[0]?.message?.content || '';
  const usage = data?.usage || {};
  const parsed = parseJson(text);
  if (!parsed) throw new Error('Vision model returned no readable outfit description.');
  return {
    spec: parsed,
    tokens: { prompt: usage.prompt_tokens || 0, completion: usage.completion_tokens || 0 },
  };
}

// ------------------------------------------------------------------ weather

/**
 * Kept for backwards compatibility — now delegates to the keyless
 * Open-Meteo service in src/weather.js instead of requiring WEATHER_KEY.
 */
async function liveWeather(city) {
  return weatherService.resolve(city);
}

module.exports = {
  status,
  complete,
  parseJson,
  stylistChat,
  streamChat,
  analyzeImage,
  describeOutfit,
  liveWeather,
};
