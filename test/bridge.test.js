import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { PassThrough } from 'node:stream';
import { createBridge } from '../src/bridge.js';

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function startServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    readBody(req)
      .then((body) => {
        const record = { headers: req.headers, body };
        requests.push(record);
        return handler ? handler(req, res, record) : undefined;
      })
      .catch(() => {
        res.writeHead(500);
        res.end('test server failure');
      });
  });
  server.requests = requests;
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function run({ handler, inputLines, apiKey = '', timeoutMs = 60000 }) {
  const server = await startServer(handler);
  const input = new PassThrough();
  const output = new PassThrough();
  let rawOutput = '';
  output.setEncoding('utf8');
  output.on('data', (chunk) => {
    rawOutput += chunk;
  });

  const bridge = createBridge({
    input,
    output,
    url: `http://127.0.0.1:${server.address().port}/v1/mcp`,
    apiKey,
    timeoutMs,
    log: () => {},
  });

  for (const line of inputLines) input.write(`${line}\n`);
  input.end();

  try {
    await bridge.done;
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }

  await new Promise((resolve) => setImmediate(resolve));

  const outputLines = rawOutput
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  return { outputLines, rawOutput, requests: server.requests };
}

test('initialize negotiates protocol version and auth headers', async () => {
  const handler = async (req, res, record) => {
    const parsed = JSON.parse(record.body);
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
      res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: {} }));
    }
  };

  const withKey = await run({
    handler,
    apiKey: 'ps_test123',
    inputLines: [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping', params: {} }),
    ],
  });

  assert.equal(withKey.requests[0].headers.authorization, 'Bearer ps_test123');
  assert.equal(withKey.requests[1].headers.authorization, 'Bearer ps_test123');
  assert.equal(
    withKey.requests[1].headers['mcp-protocol-version'],
    '2025-03-26',
  );
  assert.equal(withKey.outputLines[0].result.protocolVersion, '2025-03-26');

  const noKey = await run({
    handler,
    apiKey: '',
    inputLines: [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping', params: {} }),
    ],
  });

  assert.equal(noKey.requests[0].headers.authorization, undefined);
  assert.equal(
    noKey.requests[1].headers['mcp-protocol-version'],
    '2025-03-26',
  );
});

test('notification with 202 response writes nothing', async () => {
  const result = await run({
    handler: async (req, res) => {
      res.writeHead(202);
      res.end();
    },
    inputLines: [
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    ],
  });

  assert.deepEqual(result.outputLines, []);
});

test('invalid JSON line returns parse error', async () => {
  const result = await run({
    handler: async () => {
      throw new Error('server should not be called for parse errors');
    },
    inputLines: ['not json'],
  });

  assert.equal(result.requests.length, 0);
  assert.deepEqual(result.outputLines, [
    { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
  ]);
});

test('server 500 text body emits JSON-RPC error with same string id', async () => {
  const result = await run({
    handler: async (req, res) => {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('oops');
    },
    inputLines: [
      JSON.stringify({ jsonrpc: '2.0', id: 'abc', method: 'ping', params: {} }),
    ],
  });

  assert.deepEqual(result.outputLines, [
    {
      jsonrpc: '2.0',
      id: 'abc',
      error: { code: -32603, message: 'PinSharing returned HTTP 500' },
    },
  ]);
});

test('server 400 JSON-RPC error is passed through compact', async () => {
  const result = await run({
    handler: async (req, res) => {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 7,
          error: { code: -32602, message: 'Invalid params' },
        }),
      );
    },
    inputLines: [
      JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: {} }),
    ],
  });

  assert.deepEqual(result.outputLines[0], {
    jsonrpc: '2.0',
    id: 7,
    error: { code: -32602, message: 'Invalid params' },
  });
  assert.equal(
    result.rawOutput.trim(),
    '{"jsonrpc":"2.0","id":7,"error":{"code":-32602,"message":"Invalid params"}}',
  );
});

test('SSE response with two events writes two lines', async () => {
  const sseBody = [
    'event: message',
    'data: {"jsonrpc":"2.0","id":9,"result":{"x":1}}',
    '',
    'data: {"jsonrpc":"2.0","id":9,"result":{"y":2}}',
    '',
  ].join('\n');

  const result = await run({
    handler: async (req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(sseBody);
    },
    inputLines: [
      JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: {} }),
    ],
  });

  assert.equal(result.outputLines.length, 2);
  assert.deepEqual(result.outputLines[0], {
    jsonrpc: '2.0',
    id: 9,
    result: { x: 1 },
  });
  assert.deepEqual(result.outputLines[1], {
    jsonrpc: '2.0',
    id: 9,
    result: { y: 2 },
  });
});

test('mcp-session-id from a response is sent on the next request', async () => {
  const result = await run({
    handler: async (req, res, record) => {
      const parsed = JSON.parse(record.body);
      if (parsed.method === 'initialize') {
        res.writeHead(200, {
          'content-type': 'application/json',
          'mcp-session-id': 'session-abc',
        });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: parsed.id,
            result: { protocolVersion: '2025-03-26' },
          }),
        );
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: {} }));
      }
    },
    inputLines: [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping', params: {} }),
    ],
  });

  assert.equal(result.requests[1].headers['mcp-session-id'], 'session-abc');
});

test('timeout writes -32603 with same id', async () => {
  const result = await run({
    timeoutMs: 200,
    handler: async (req, res, record) => {
      const parsed = JSON.parse(record.body);
      if (parsed.method === 'ping') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: {} }));
      }
      // static_map intentionally never responds.
    },
    inputLines: [
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'timeout-id',
        method: 'static_map',
        params: {},
      }),
    ],
  });

  assert.deepEqual(result.outputLines, [
    {
      jsonrpc: '2.0',
      id: 'timeout-id',
      error: {
        code: -32603,
        message: 'Could not reach PinSharing: timed out after 200 ms',
      },
    },
  ]);
});

test('slow request does not block a later ping', async () => {
  const result = await run({
    handler: async (req, res, record) => {
      const parsed = JSON.parse(record.body);
      if (parsed.method === 'ping') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: {} }));
        return;
      }

      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: {} }));
      }, 300);
    },
    inputLines: [
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'slow',
        method: 'static_map',
        params: {},
      }),
      JSON.stringify({ jsonrpc: '2.0', id: 'fast', method: 'ping', params: {} }),
    ],
  });

  assert.deepEqual(
    result.outputLines.map((line) => line.id),
    ['fast', 'slow'],
  );
});

test('every output line is valid JSON and never contains the key', async () => {
  const key = 'ps_test_secret_123';
  const result = await run({
    apiKey: key,
    handler: async (req, res, record) => {
      const parsed = JSON.parse(record.body);
      if (!('id' in parsed)) {
        res.writeHead(202);
        res.end();
        return;
      }

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
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: {} }));
      }
    },
    inputLines: [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping', params: {} }),
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    ],
  });

  assert.ok(result.outputLines.length >= 2);
  for (const line of result.rawOutput.split('\n').filter(Boolean)) {
    assert.doesNotThrow(() => JSON.parse(line));
  }
  assert.equal(result.rawOutput.includes(key), false);
});

test('done waits for in-flight requests after input ends', async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    readBody(req).then((body) => {
      const record = { headers: req.headers, body };
      requests.push(record);
      const parsed = JSON.parse(record.body);
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: {} }));
      }, 100);
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const input = new PassThrough();
  const output = new PassThrough();
  let rawOutput = '';
  output.setEncoding('utf8');
  output.on('data', (chunk) => {
    rawOutput += chunk;
  });

  const bridge = createBridge({
    input,
    output,
    url: `http://127.0.0.1:${server.address().port}/v1/mcp`,
    apiKey: '',
    timeoutMs: 60000,
    log: () => {},
  });

  let doneResolved = false;
  const done = bridge.done.then(() => {
    doneResolved = true;
  });

  input.write(
    `${JSON.stringify({ jsonrpc: '2.0', id: 'slow', method: 'ping', params: {} })}\n`,
  );
  input.end();

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(doneResolved, false);

  await done;
  assert.equal(doneResolved, true);

  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  const lines = rawOutput
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0], { jsonrpc: '2.0', id: 'slow', result: {} });
});

test('requests pipelined behind initialize wait for it', async () => {
  const result = await run({
    handler: async (req, res, record) => {
      const parsed = JSON.parse(record.body);
      if (parsed.method === 'initialize') await new Promise((r) => setTimeout(r, 150));
      if (!('id' in parsed)) {
        res.writeHead(202);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: parsed.method === 'initialize' ? { protocolVersion: '2025-11-25' } : {} }));
    },
    inputLines: [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    ],
  });
  assert.equal(result.requests[0].headers['mcp-protocol-version'], undefined);
  assert.equal(result.requests.length, 3);
  for (const r of result.requests.slice(1)) {
    assert.equal(r.headers['mcp-protocol-version'], '2025-11-25');
  }
  assert.deepEqual(result.outputLines.map((l) => l.id), [1, 2]);
});
