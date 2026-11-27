import { Injectable, Logger } from '@nestjs/common';

const MODEL = '@cf/meta/llama-3.1-8b-instruct';
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * One plain sentence on why an outfit was picked, from a free Cloudflare
 * Workers AI text model. The rule engine stays the decision-maker - this
 * only explains its pick. Any failure (missing credentials, timeout,
 * rate limit) falls back to an honest template built from the same
 * facts the engine used, so the line always tells the truth.
 */
@Injectable()
export class OutfitReasonService {
  private readonly log = new Logger(OutfitReasonService.name);

  async explain(
    outfit: any,
    weather: Record<string, unknown>,
    occasion: string,
  ): Promise<string> {
    const pieces: any[] = outfit?.items ?? [];
    const names = pieces.map((i) => i?.name).filter(Boolean);
    // Ground the explanation in what the items actually are (colour +
    // measured subcategory), not their names: a name like "Piece 12345"
    // tells the model nothing, so it invents garments (the stress test
    // caught it praising a "black tie" that was never in the outfit).
    const descs = pieces
      .map((i) => {
        const sub = i?.legacy?.analysis?.subcategory;
        return [i?.color, sub || i?.category].filter(Boolean).join(' ');
      })
      .filter((d) => d.trim().length > 0);
    const tempC = Number(weather?.tempC ?? 24);
    const condition = `${weather?.condition ?? ''}`.trim() || 'mild';
    const list = descs.length ? descs : names;
    const fallback =
      `Picked for ${occasion} at ${Math.round(tempC)}°C: ` +
      `${list.slice(0, 3).join(', ')}${list.length > 3 ? ' and more' : ''}.`;

    if (process.env.NODE_ENV === 'test') return fallback;
    const accountId = process.env.CF_ACCOUNT_ID;
    const token = process.env.CF_API_TOKEN;
    if (!accountId || !token || !list.length) return fallback;

    try {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messages: [
              {
                role: 'system',
                content:
                  'You explain outfit recommendations in one short plain ' +
                  'sentence (max 18 words). Mention the occasion and ' +
                  'weather and one concrete reason. Describe only the ' +
                  'listed items; never add items, colours or details that ' +
                  'are not listed. No adjectives like "perfect" or "stunning".',
              },
              {
                role: 'user',
                content:
                  `Occasion: ${occasion}. Weather: ${Math.round(tempC)}°C, ` +
                  `${condition}. Items: ${list.join('; ')}. ` +
                  'In one sentence, why do these exact items work here?',
              },
            ],
            max_tokens: 60,
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
      if (!res.ok) throw new Error(`Cloudflare ${res.status}`);
      const payload: any = await res.json();
      // Workers AI answers in three shapes depending on the model:
      // {result:{response:"..."}}, {result:{response:{content:"..."}}},
      // or OpenAI-style {result:{choices:[{message:{content:"..."}}]}}.
      const r: any = payload?.result;
      const text = (
        typeof r?.response === 'string'
          ? r.response
          : typeof r?.response?.content === 'string'
            ? r.response.content
            : `${r?.choices?.[0]?.message?.content ?? ''}`
      ).trim();
      if (!text) throw new Error('empty response');
      return text;
    } catch (e) {
      this.log.warn(`AI reason unavailable (${(e as Error).message}); template used.`);
      return fallback;
    }
  }
}
