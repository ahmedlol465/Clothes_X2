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
 * Without any key every caller falls back to the embedded rule engine
 * (src/ai-engine.js), so the app keeps working offline.
 */
'use strict';

const PROVIDERS = {
  gemini: {
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: 'GEMINI_API_KEY',
    keyUrl: 'https://aistudio.google.com/apikey',
    model: 'gemini-2.0-flash',
    vision: true,
  },
  groq: {
    base: 'https://api.groq.com/openai/v1',
    keyEnv: 'GROQ_API_KEY',
    keyUrl: 'https://console.groq.com/keys',
    model: 'llama-3.3-70b-versatile',
    visionModel: 'meta-llama/llama-4-scout-17b-16e-instruct',
    vision: true,
  },
  openrouter: {
    base: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    keyUrl: 'https://openrouter.ai/keys',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    vision: true,
  },
  openai: {
    base: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY',
    keyUrl: 'https://platform.openai.com/api-keys',
    model: 'gpt-4o-mini',
    vision: true,
  },
};

function pickProvider() {
  const want = String(process.env.LLM_PROVIDER || '').toLowerCase();
  if (want) {
    const p = PROVIDERS[want];
    const key = p && process.env[p.keyEnv];
    if (p && key) return { name: want, ...p, key, model: process.env.LLM_MODEL || p.model };
    return {
      name: want, configured: false,
      hint: p
        ? `Set ${p.keyEnv} in backend/.env (free: ${p.keyUrl})`
        : `Unknown LLM_PROVIDER="${want}". Use: ${Object.keys(PROVIDERS).join('|')}`,
    };
  }
  for (const [name, p] of Object.entries(PROVIDERS)) {
    const key = process.env[p.keyEnv];
    if (key) return { name, ...p, key, model: process.env.LLM_MODEL || p.model };
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
    configured: !!p.key,
    vision: !!p.vision,
    ...(p.key ? {} : { howToEnable: p.hint }),
  };
}

/** Raw chat-completions call. Returns { text, tokens }. */
async function complete({ system, user, maxTokens = 500, temperature = 0.7 }) {
  const p = pickProvider();
  if (!p.key) throw new Error(p.hint || 'No LLM key configured.');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` };
  if (p.name === 'openrouter') {
    headers['HTTP-Referer'] = 'http://localhost:3001';
    headers['X-Title'] = 'SmartWardrobe';
  }
  const res = await fetch(`${p.base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: p.model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(25000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `LLM HTTP ${res.status} (${p.name}/${p.model})`);
  }
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

/** Extract the first {...} JSON block from model output. */
function parseJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

function catalogLines(wardrobe) {
  return wardrobe.slice(0, 40).map(
    (i) => `${i.id} | ${i.name} | ${i.category} | ${i.color} | ${i.style} | ${i.formality} | worn ${i.timesWorn || 0}x`,
  );
}

/**
 * Wardrobe-aware stylist reply. Returns { text, itemIds, tokens }.
 * itemIds are validated against the catalog by the caller.
 */
async function stylistChat({ message, wardrobe, weather, styleProfile }) {
  const catalog = catalogLines(wardrobe).join('\n') || '(wardrobe empty)';
  const prefs = styleProfile ? JSON.stringify(styleProfile) : '{}';
  const { text, tokens } = await complete({
    system:
      'You are SmartWardrobe, a friendly personal fashion stylist. ' +
      'Answer in at most 60 words, mentioning garment names from the catalog. ' +
      'After the answer, on its own line, output ONLY this JSON with 2-4 catalog ids that form the outfit: {"itemIds": ["id1", "id2", "id3"]}',
    user:
      `Weather: ${weather?.tempC ?? 24}°C, ${weather?.condition ?? 'clear'}. ` +
      `Style profile: ${prefs}\nCatalog (id | name | category | color | style | formality | wear count):\n${catalog}\n` +
      `User request: ${message}`,
    maxTokens: 400,
  });
  const parsed = parseJson(text);
  const cleanText = text.replace(/\{[\s\S]*\}/, '').trim() || text;
  return { text: cleanText, itemIds: parsed?.itemIds || [], tokens };
}

const VISION_ATTRS = ['category', 'color', 'style', 'pattern', 'material', 'season', 'formality'];

/**
 * Clothing analysis from a photo (data URL or http URL).
 * Returns { attrs, tokens } where attrs matches analyzeClothing() fields.
 */
async function analyzeImage({ dataUrl, hint = '' }) {
  const p = pickProvider();
  if (!p.key) throw new Error(p.hint || 'No LLM key configured.');
  const model = p.visionModel || p.model;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` };
  if (p.name === 'openrouter') {
    headers['HTTP-Referer'] = 'http://localhost:3001';
    headers['X-Title'] = 'SmartWardrobe';
  }
  const res = await fetch(`${p.base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 300,
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
    }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `Vision HTTP ${res.status} (${p.name}/${model})`);
  }
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

// ---------------------------------------------------------- live weather
let weatherCache = { at: 0, data: null };

/** OpenWeatherMap current weather (free key). Null when unconfigured. */
async function liveWeather(city) {
  const key = process.env.WEATHER_KEY;
  if (!key) return null;
  const now = Date.now();
  if (weatherCache.data && now - weatherCache.at < 10 * 60 * 1000) {
    return { ...weatherCache.data, city: city || weatherCache.data.city };
  }
  const q = encodeURIComponent(city || process.env.WEATHER_CITY || 'Cairo');
  const res = await fetch(
    `https://api.openweathermap.org/data/2.5/weather?q=${q}&appid=${key}&units=metric`,
    { signal: AbortSignal.timeout(10000) },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Weather HTTP ${res.status}`);
  const out = {
    tempC: Math.round(data?.main?.temp ?? 24),
    condition: data?.weather?.[0]?.description || 'clear',
    city: data?.name || city || 'Cairo',
  };
  out.summary = `${cap(out.condition)} • ${out.tempC}°C`;
  weatherCache = { at: now, data: out };
  return out;
}

function cap(s) {
  return String(s).replace(/\b\w/g, (c) => c.toUpperCase());
}

module.exports = { status, complete, parseJson, stylistChat, analyzeImage, liveWeather };
