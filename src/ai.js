// Optional second opinion from Claude on the riskiest hunks. Opt-in only (--ai): it sends
// the changed lines of up to MAX_HUNKS hunks to the Anthropic API. Plain fetch, no SDK,
// so riskdiff stays dependency-free.
const API_URL = 'https://api.anthropic.com/v1/messages';
export const DEFAULT_MODEL = 'claude-opus-5-5';
const MAX_HUNKS = 15;
const MAX_LINES = 40;
const VERDICTS = ['real', 'false-positive', 'unsure'];

const SYSTEM =
  'You review code changes that a static risk scanner flagged. For each hunk, decide whether the ' +
  'flagged risk is real, a false positive, or unclear from the lines shown. "real" means a reviewer ' +
  'should look at it before merging. Give one short sentence explaining why, naming the specific line ' +
  'or construct. Judge only what is shown; say "unsure" rather than guessing about code you cannot see.';

const SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          hunk: { type: 'integer' },
          verdict: { type: 'string', enum: VERDICTS },
          note: { type: 'string' },
        },
        required: ['hunk', 'verdict', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['verdicts'],
  additionalProperties: false,
};

export function buildPrompt(hunks) {
  const parts = hunks.map((r, i) => {
    const lines = [
      `<hunk id="${i + 1}" file="${r.file}" line="${r.line}" status="${r.status}" score="${r.score}">`,
      'Findings:',
      ...r.findings.map((f) => `- [${f.id}] ${f.reason}`),
    ];
    const removed = r.hunk.removed.slice(0, MAX_LINES);
    const added = r.hunk.added.slice(0, MAX_LINES);
    if (removed.length) lines.push('Removed lines:', ...removed.map((l) => `- ${l}`));
    if (added.length) lines.push('Added lines:', ...added.map((l) => `+ ${l}`));
    if (r.hunk.removed.length > MAX_LINES || r.hunk.added.length > MAX_LINES) lines.push('(hunk truncated)');
    lines.push('</hunk>');
    return lines.join('\n');
  });
  return `Review these ${hunks.length} flagged hunks and return one verdict per hunk id.\n\n${parts.join('\n\n')}`;
}

// Adds `ai: {verdict, note}` to the riskiest results. Returns {reviewed, model}.
// Throws with a readable message on any API problem; callers treat that as a warning.
export async function aiReview(results, { apiKey = process.env.ANTHROPIC_API_KEY, model, fetch = globalThis.fetch, timeoutMs = 120000 } = {}) {
  if (!apiKey) throw new Error('--ai needs ANTHROPIC_API_KEY to be set');
  model ||= process.env.RISKDIFF_AI_MODEL || DEFAULT_MODEL;
  const hunks = results.filter((r) => r.score > 0 && r.hunk).slice(0, MAX_HUNKS);
  if (!hunks.length) return { reviewed: 0, model };

  const body = {
    model,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: 'user', content: buildPrompt(hunks) }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    fallbacks: 'default',
  };
  const res = await send(fetch, body, apiKey, timeoutMs);

  if (res.stop_reason === 'refusal') throw new Error('the model declined to review this diff');
  if (res.stop_reason === 'max_tokens') throw new Error('the AI review was cut off (max_tokens)');
  const text = res.content?.find((b) => b.type === 'text')?.text;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('the AI review returned invalid JSON');
  }
  for (const v of parsed.verdicts ?? []) {
    const r = hunks[v.hunk - 1];
    if (r && VERDICTS.includes(v.verdict)) r.ai = { verdict: v.verdict, note: String(v.note ?? '').trim() };
  }
  return { reviewed: hunks.filter((r) => r.ai).length, model: res.model ?? model };
}

// POST with up to two retries on rate limits, overload, and server errors.
async function send(fetch, body, apiKey, timeoutMs) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'server-side-fallback-2026-07-01',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (attempt < 2) continue;
      throw new Error(`could not reach the Anthropic API: ${err.message}`);
    }
    if (res.ok) return res.json();

    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < 2) {
      const wait = Number(res.headers.get('retry-after'));
      await new Promise((r) => setTimeout(r, Number.isFinite(wait) && wait > 0 ? Math.min(wait, 30) * 1000 : 1000 * 2 ** attempt));
      continue;
    }
    let detail = '';
    try {
      detail = (await res.json())?.error?.message ?? '';
    } catch {}
    const hint = res.status === 401 ? ' (check ANTHROPIC_API_KEY)' : '';
    throw new Error(`Anthropic API error ${res.status}${hint}${detail ? `: ${detail}` : ''}`);
  }
}
