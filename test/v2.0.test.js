import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { CLI, tempRepo } from './helpers.js';
import { runHook } from '../src/hook.js';
import { handle } from '../src/mcp.js';
import { aiReview, buildPrompt } from '../src/ai.js';
import { formatText, formatMarkdown } from '../src/report.js';

const RISKY = 'const apiKey = "sk-abcdefghijklmnopqrstuvwxyz";\neval(userInput);\n';

test('hook reports risky changes in the edited file', async () => {
  const repo = tempRepo({ 'src/app.js': 'export const a = 1;\n', 'src/other.js': 'x\n' });
  try {
    repo.write('src/app.js', RISKY);
    const out = await runHook({ cwd: repo.dir, tool_name: 'Edit', tool_input: { file_path: join(repo.dir, 'src/app.js') } });
    assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.match(out.hookSpecificOutput.additionalContext, /src\/app\.js/);
    assert.match(out.hookSpecificOutput.additionalContext, /hardcoded-secret/);
  } finally {
    repo.cleanup();
  }
});

test('hook stays silent for other files, safe edits, and paths outside the repo', async () => {
  const repo = tempRepo({ 'src/app.js': 'export const a = 1;\n', 'src/other.js': 'x\n' });
  try {
    repo.write('src/app.js', RISKY);
    repo.write('src/other.js', 'y\n');
    const at = (p) => runHook({ cwd: repo.dir, tool_input: { file_path: p } });
    assert.equal(await at(join(repo.dir, 'src/other.js')), null);
    assert.equal(await at(join(repo.dir, '..', 'elsewhere.js')), null);
    assert.equal(await runHook({ cwd: repo.dir, tool_input: {} }), null);
  } finally {
    repo.cleanup();
  }
});

test('hook subcommand exits 0 on bad input and prints JSON on findings', () => {
  const repo = tempRepo({ 'a.js': '1\n' });
  try {
    repo.write('a.js', RISKY);
    const run = (input) => execFileSync('node', [CLI, 'hook'], { cwd: repo.dir, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    assert.equal(run('not json'), '');
    const out = JSON.parse(run(JSON.stringify({ cwd: repo.dir, tool_input: { file_path: 'a.js' } })));
    assert.match(out.hookSpecificOutput.additionalContext, /dangerous-exec/);
  } finally {
    repo.cleanup();
  }
});

test('mcp handles initialize, tools/list, tools/call, and errors', async () => {
  const repo = tempRepo({ 'a.js': '1\n' });
  try {
    repo.write('a.js', RISKY);
    const info = { name: 'riskdiff', version: 't' };
    const init = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, info);
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.deepEqual(init.result.capabilities, { tools: {} });
    assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, info), null);

    const list = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, info);
    assert.equal(list.result.tools[0].name, 'riskdiff_scan');

    const call = await handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'riskdiff_scan', arguments: { cwd: repo.dir, minLevel: 'high' } } }, info);
    assert.equal(call.result.isError, false);
    const report = JSON.parse(call.result.content[0].text);
    assert.ok(report.summary.high >= 1);
    assert.ok(report.hunks.every((h) => h.level === 'high'));

    const bad = await handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } }, info);
    assert.equal(bad.error.code, -32602);
    const missing = await handle({ jsonrpc: '2.0', id: 5, method: 'foo' }, info);
    assert.equal(missing.error.code, -32601);
  } finally {
    repo.cleanup();
  }
});

test('mcp subcommand speaks newline-delimited JSON-RPC over stdio', async () => {
  const child = spawn('node', [CLI, 'mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = [];
  child.stdout.setEncoding('utf8');
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      lines.push(JSON.parse(buf.slice(0, i)));
      buf = buf.slice(i + 1);
    }
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  child.stdin.end();
  await new Promise((r) => child.on('close', r));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].result.serverInfo.name, 'riskdiff');
  assert.equal(lines[1].result.tools.length, 1);
});

const fakeResults = () => [
  { file: 'a.js', line: 1, status: 'modified', score: 50, level: 'high', findings: [{ id: 'dangerous-exec', reason: 'Runs a shell command', weight: 30 }], hunk: { added: ['exec(x)'], removed: [] } },
  { file: 'b.js', line: 4, status: 'modified', score: 25, level: 'medium', findings: [{ id: 'sql-injection', reason: 'Builds SQL from strings', weight: 25 }], hunk: { added: ['q = "SELECT " + id'], removed: [] } },
];

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const r = responses.shift();
    return {
      ok: r.status === 200,
      status: r.status,
      headers: { get: () => '0' },
      json: async () => r.body,
    };
  };
  fn.calls = calls;
  return fn;
}

test('aiReview sends a structured request and attaches verdicts', async () => {
  const results = fakeResults();
  const verdicts = { verdicts: [{ hunk: 1, verdict: 'real', note: 'exec on user input' }, { hunk: 2, verdict: 'false-positive', note: 'id is a constant' }] };
  const fetch = fakeFetch([{ status: 200, body: { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(verdicts) }] } }]);
  const out = await aiReview(results, { apiKey: 'k', fetch });

  assert.equal(out.reviewed, 2);
  assert.deepEqual(results[0].ai, { verdict: 'real', note: 'exec on user input' });
  assert.equal(results[1].ai.verdict, 'false-positive');
  const { init, body } = fetch.calls[0];
  assert.equal(init.headers['x-api-key'], 'k');
  assert.equal(init.headers['anthropic-version'], '2023-06-01');
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.match(body.messages[0].content, /<hunk id="2" file="b.js"/);

  assert.match(formatText(results), /AI: likely real — exec on user input/);
  assert.match(formatMarkdown(results), /likely false positive/);
});

test('aiReview retries on 529 and reports API and refusal errors', async () => {
  const ok = { status: 200, body: { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"verdicts":[]}' }] } };
  const retry = fakeFetch([{ status: 529, body: {} }, ok]);
  await aiReview(fakeResults(), { apiKey: 'k', fetch: retry });
  assert.equal(retry.calls.length, 2);

  const denied = fakeFetch([{ status: 401, body: { error: { message: 'invalid x-api-key' } } }]);
  await assert.rejects(aiReview(fakeResults(), { apiKey: 'k', fetch: denied }), /401 \(check ANTHROPIC_API_KEY\): invalid x-api-key/);

  const refused = fakeFetch([{ status: 200, body: { stop_reason: 'refusal', content: [] } }]);
  await assert.rejects(aiReview(fakeResults(), { apiKey: 'k', fetch: refused }), /declined/);

  await assert.rejects(aiReview(fakeResults(), { apiKey: '', fetch: refused }), /ANTHROPIC_API_KEY/);
});

test('buildPrompt truncates long hunks', () => {
  const r = fakeResults()[0];
  r.hunk.added = Array.from({ length: 100 }, (_, i) => `line ${i}`);
  const prompt = buildPrompt([r]);
  assert.match(prompt, /line 39/);
  assert.doesNotMatch(prompt, /line 40\b/);
  assert.match(prompt, /hunk truncated/);
});
