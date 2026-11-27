import { Injectable, Logger } from '@nestjs/common';

const MODEL = '@cf/meta/llama-3.1-8b-instruct';
const REQUEST_TIMEOUT_MS = 10_000;

const OCCASIONS = [
  'casual',
  'smart casual',
  'formal',
  'work',
  'interview',
  'date',
  'wedding',
  'party',
  'gym',
  'beach',
];

/**
 * His own words -> the engine's existing inputs. "Date night, a bit
 * dressy" becomes { occasion: 'date', focus: 'dressy' } so the same
 * rule engine answers it - the AI only translates, it never decides.
 * Keyword fallback when the free text model is unavailable, so the
 * feature degrades to a decent guess instead of an error.
 */
@Injectable()
export class OutfitIntentService {
  private readonly log = new Logger(OutfitIntentService.name);

  async parse(
    text: string,
  ): Promise<{ occasion?: string; focus: string; source: 'ai' | 'keywords' }> {
    const trimmed = text.trim();
    if (!trimmed) return { focus: '', source: 'keywords' };

    if (process.env.NODE_ENV !== 'test') {
      const accountId = process.env.CF_ACCOUNT_ID;
      const token = process.env.CF_API_TOKEN;
      if (accountId && token) {
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
                      'Extract outfit-request intent. Reply with ONLY compact ' +
                      'JSON: {"occasion": one of ' +
                      OCCASIONS.join('|') +
                      ' or null, "focus": "garments, colors or styles ' +
                      'mentioned, as short keywords"}.',
                  },
                  { role: 'user', content: trimmed },
                ],
                max_tokens: 80,
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
          const raw =
            typeof r?.response === 'string'
              ? r.response
              : typeof r?.response?.content === 'string'
                ? r.response.content
                : `${r?.choices?.[0]?.message?.content ?? ''}`;
          const match = raw.match(/\{[\s\S]*\}/);
          if (!match) throw new Error(`no JSON in response: ${raw.slice(0, 120)}`);
          const parsed = JSON.parse(match[0]);
          const occasion = OCCASIONS.includes(
            `${parsed?.occasion ?? ''}`.toLowerCase(),
          )
            ? `${parsed.occasion}`.toLowerCase()
            : undefined;
          const focus = `${parsed?.focus ?? ''}`.trim() || trimmed;
          return { occasion, focus, source: 'ai' };
        } catch (e) {
          this.log.warn(
            `AI intent unavailable (${(e as Error).message}); keywords used.`,
          );
        }
      }
    }

    const lower = trimmed.toLowerCase();
    const occasion = OCCASIONS.find((o) => lower.includes(o));
    return { occasion, focus: trimmed, source: 'keywords' };
  }
}
