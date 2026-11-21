// Minimal MCP server over stdio (newline-delimited JSON-RPC 2.0). Logs go to stderr.
import { createInterface } from 'node:readline';
import { analyze } from './analyze.js';
import { atOrAbove, summarize } from './report.js';

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const TOOLS = [
  {
    name: 'riskdiff_scan',
    description:
      'Score every hunk of a git diff by merge risk (secrets, removed auth checks, dangerous exec, SQL, ' +
      'weakened tests, risky dependencies, sensitive paths) and return them riskiest first as JSON. ' +
      'With no range it scans uncommitted changes, including untracked files.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Directory inside the git repository to scan. Defaults to the server working directory.' },
        range: { type: 'string', description: 'git diff arguments, e.g. "main...HEAD" or "HEAD~3 -- src". Omit for uncommitted changes.' },
        staged: { type: 'boolean', description: 'Scan staged changes only.' },
        checkPackages: { type: 'boolean', description: 'Look new npm/PyPI dependencies up in their registries (sends package names only).' },
        minLevel: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Only return hunks at or above this level. Default: low.' },
      },
      additionalProperties: false,
    },
  },
];

export async function callTool(name, args = {}) {
  if (name !== 'riskdiff_scan') throw Object.assign(new Error(`unknown tool: ${name}`), { code: -32602 });
  const range = typeof args.range === 'string' ? args.range.trim().split(/\s+/).filter(Boolean) : [];
  const { results, packageCheck } = await analyze({
    cwd: args.cwd || process.cwd(),
    mode: args.staged ? 'staged' : range.length ? 'range' : 'worktree',
    args: range,
    packages: args.checkPackages,
  });
  const min = args.minLevel || 'low';
  const report = {
    summary: summarize(results),
    hunks: results.filter((r) => r.score > 0 && atOrAbove(r.level, min)).map(({ hunk, ...rest }) => rest),
  };
  if (packageCheck?.failed) report.warning = `could not reach the registry for ${packageCheck.failed} package(s)`;
  return JSON.stringify(report, null, 2);
}

export async function handle(msg, serverInfo) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return null; // notifications get no reply
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  const error = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion;
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo,
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call':
      try {
        const text = await callTool(params?.name, params?.arguments);
        return reply({ content: [{ type: 'text', text }], isError: false });
      } catch (err) {
        if (err.code === -32602) return error(-32602, err.message);
        return reply({ content: [{ type: 'text', text: `riskdiff: ${err.message}` }], isError: true });
      }
    default:
      return error(-32601, `method not found: ${method}`);
  }
}

export function serve({ version, input = process.stdin, output = process.stdout } = {}) {
  const serverInfo = { name: 'riskdiff', version };
  const rl = createInterface({ input, crlfDelay: Infinity });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) + '\n');
      return;
    }
    try {
      const res = await handle(msg, serverInfo);
      if (res) output.write(JSON.stringify(res) + '\n');
    } catch (err) {
      console.error(`riskdiff mcp: ${err.stack || err.message}`);
    }
  });
  return new Promise((done) => rl.on('close', done));
}
