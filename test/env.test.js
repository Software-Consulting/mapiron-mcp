import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const bin = path.join(root, 'bin', 'mapiron-mcp.js');

const CLEAN = {
  MAPIRON_API_KEY: '',
  MAPIRON_MCP_URL: '',
  MAPIRON_MCP_DEBUG: '',
  MAPIRON_MCP_TIMEOUT_MS: '',
  PINSHARING_API_KEY: '',
  PINSHARING_MCP_URL: '',
  PINSHARING_MCP_DEBUG: '',
  PINSHARING_MCP_TIMEOUT_MS: '',
};

// Runs one initialize through the bridge and returns the headers the mock saw.
async function headersSeen(env) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers);
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const mockUrl = `http://127.0.0.1:${server.address().port}/v1/mcp`;
  const resolved = Object.fromEntries(
    Object.entries(env).map(([k, v]) => [k, v === '$MOCK' ? mockUrl : v]),
  );
  const child = spawn(process.execPath, [bin], {
    cwd: root,
    env: { ...process.env, ...CLEAN, ...resolved },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (c) => { stderr += c; });
  child.stdout.resume();
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
  child.stdin.end();
  const [code] = await once(child, 'close');
  await new Promise((resolve) => server.close(resolve));
  return { code, stderr, seen };
}

test('MAPIRON_* variables are used', async () => {
  const { code, seen } = await headersSeen({ MAPIRON_MCP_URL: '$MOCK', MAPIRON_API_KEY: 'ps_new' });
  assert.equal(code, 0);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].authorization, 'Bearer ps_new');
  assert.match(seen[0]['user-agent'], /^mapiron-mcp\//);
});

test('legacy PINSHARING_* variables still work', async () => {
  const { code, seen } = await headersSeen({ PINSHARING_MCP_URL: '$MOCK', PINSHARING_API_KEY: 'ps_old' });
  assert.equal(code, 0);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].authorization, 'Bearer ps_old');
});

test('MAPIRON_* wins when both names are set', async () => {
  const { code, seen } = await headersSeen({
    MAPIRON_MCP_URL: '$MOCK',
    PINSHARING_MCP_URL: 'http://example.com/v1/mcp',
    MAPIRON_API_KEY: 'ps_new',
    PINSHARING_API_KEY: 'ps_old',
  });
  assert.equal(code, 0);
  assert.equal(seen[0].authorization, 'Bearer ps_new');
});

test('the default server is api.mapiron.com', async () => {
  const child = spawn(process.execPath, [bin, '--help'], {
    cwd: root,
    env: { ...process.env, ...CLEAN },
  });
  let out = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (c) => { out += c; });
  const [code] = await once(child, 'close');
  assert.equal(code, 0);
  assert.match(out, /Default: https:\/\/api\.mapiron\.com\/v1\/mcp/);
  assert.match(out, /PINSHARING_\* names are still accepted/);
});
