import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const bin = path.join(root, 'bin', 'pinsharing-mcp.js');

function spawnBin(args = [], env = {}) {
  return spawn(process.execPath, [bin, ...args], {
    cwd: root,
    env: {
      ...process.env,
      PINSHARING_API_KEY: '',
      PINSHARING_MCP_DEBUG: '',
      PINSHARING_MCP_TIMEOUT_MS: '60000',
      ...env,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function collect(child) {
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  return {
    getStdout: () => stdout,
    getStderr: () => stderr,
  };
}

test('--version prints package version', async () => {
  const child = spawnBin(['--version']);
  const { getStdout, getStderr } = collect(child);
  const [code] = await once(child, 'close');

  assert.equal(code, 0);
  assert.equal(getStdout().trim(), '1.0.0');
  assert.equal(getStderr(), '');
});

test('non-https non-localhost URL exits 1 with a clear stderr message', async () => {
  const child = spawnBin([], {
    PINSHARING_MCP_URL: 'http://example.com/v1/mcp',
  });
  const { getStdout, getStderr } = collect(child);
  const [code] = await once(child, 'close');

  assert.equal(code, 1);
  assert.equal(getStdout(), '');
  assert.match(getStderr(), /https/);
});

test('end-to-end stdio run against a local mock server', async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      requests.push(parsed);
      res.writeHead(200, { 'content-type': 'application/json' });
      if (parsed.method === 'initialize') {
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: parsed.id,
            result: { protocolVersion: '2025-03-26' },
          }),
        );
      } else {
        res.end(
          JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: { tools: [] } }),
        );
      }
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const child = spawnBin([], {
    PINSHARING_MCP_URL: `http://127.0.0.1:${port}/v1/mcp`,
  });
  const { getStdout, getStderr } = collect(child);

  child.stdin.write(
    `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`,
  );
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`,
  );
  child.stdin.end();

  const [code] = await once(child, 'close');
  await new Promise((resolve) => server.close(resolve));

  assert.equal(code, 0);
  assert.equal(getStderr(), '');

  const stdout = getStdout();
  const lines = stdout.split('\n').filter(Boolean);
  assert.equal(lines.length, 2);

  for (const line of lines) {
    assert.doesNotThrow(() => JSON.parse(line));
  }

  assert.equal(JSON.parse(lines[0]).result.protocolVersion, '2025-03-26');
  assert.deepEqual(JSON.parse(lines[1]).result.tools, []);
});
