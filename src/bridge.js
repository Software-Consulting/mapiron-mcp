import readline from 'node:readline';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const hasId = (message) =>
  message &&
  typeof message === 'object' &&
  !Array.isArray(message) &&
  'id' in message;

const redactString = (value) =>
  String(value).replace(/ps_[A-Za-z0-9]+/g, '[REDACTED]');

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const contentType = (header = '') =>
  header.split(';')[0].trim().toLowerCase();

const writeLine = (output, value) => {
  output.write(`${JSON.stringify(value)}\n`);
};

const writeError = (output, id, code, message) => {
  writeLine(output, { jsonrpc: '2.0', id, error: { code, message } });
};

function parseSse(body) {
  const events = [];
  let dataLines = [];

  const flush = () => {
    if (dataLines.length > 0) events.push(dataLines.join('\n'));
    dataLines = [];
  };

  for (const line of body.split(/\r?\n/)) {
    if (line === '') {
      flush();
    } else if (line.startsWith(':')) {
      continue;
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }

  flush();
  return events;
}

/**
 * Create a stdio-to-HTTP JSON-RPC bridge.
 *
 * @param {object} options
 * @param {NodeJS.ReadableStream} options.input
 * @param {NodeJS.WritableStream} options.output
 * @param {string} options.url
 * @param {string} [options.apiKey]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.timeoutMs]
 * @param {(message: string) => void} [options.log]
 * @returns {{ done: Promise<void> }}
 */
export function createBridge({
  input,
  output,
  url,
  apiKey,
  fetchImpl = fetch,
  timeoutMs = 60000,
  log = () => {},
}) {
  const safeLog = (message) => {
    try {
      log(redactString(message));
    } catch {}
  };

  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const inflight = new Set();
  let negotiatedProtocolVersion;
  let sessionId;
  let stopped = false;
  // Messages read while an initialize is in flight wait for it, so they carry the negotiated
  // protocol version and session id (stdio clients may pipeline right after initialize).
  let initGate = Promise.resolve();

  const handleParsed = (request, parsed) => {
    if (
      request &&
      request.method === 'initialize' &&
      parsed &&
      parsed.result &&
      typeof parsed.result.protocolVersion === 'string'
    ) {
      negotiatedProtocolVersion = parsed.result.protocolVersion;
      safeLog(`Negotiated MCP protocol version ${negotiatedProtocolVersion}`);
    }
    writeLine(output, parsed);
  };

  const handleJsonBody = (request, body) => {
    const parsed = parseJson(body);
    if (parsed === undefined) {
      if (hasId(request)) {
        writeError(output, request.id, -32603, 'Invalid response from MapIron');
      } else {
        safeLog('Ignored invalid JSON response from MapIron');
      }
      return;
    }
    handleParsed(request, parsed);
  };

  const handleSuccess = (request, type, body) => {
    if (type === 'application/json') {
      handleJsonBody(request, body);
    } else if (type === 'text/event-stream') {
      for (const eventData of parseSse(body)) {
        handleJsonBody(request, eventData);
      }
    } else if (body !== '') {
      const parsed = parseJson(body);
      if (parsed !== undefined) {
        handleParsed(request, parsed);
      } else if (hasId(request)) {
        writeError(output, request.id, -32603, 'Invalid response from MapIron');
      } else {
        safeLog(`Ignored response with content-type ${type}`);
      }
    }
  };

  async function processMessage(request, rawLine) {
    const headers = {
      'content-type': 'application/json',
      'accept': 'application/json, text/event-stream',
      'user-agent': `mapiron-mcp/${version}`,
    };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    if (negotiatedProtocolVersion) {
      headers['mcp-protocol-version'] = negotiatedProtocolVersion;
    }
    if (sessionId) headers['mcp-session-id'] = sessionId;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: rawLine,
        signal: controller.signal,
      });

      const responseSessionId = response.headers.get('mcp-session-id');
      if (responseSessionId) {
        sessionId = responseSessionId;
        safeLog(`Remembered MCP session id ${sessionId}`);
      }

      const status = response.status;
      const type = contentType(response.headers.get('content-type') || '');
      const body = await response.text();

      if (status === 202 || (status < 400 && body === '')) return;

      if (status >= 400) {
        const parsed = type === 'application/json' ? parseJson(body) : undefined;
        if (parsed !== undefined) {
          writeLine(output, parsed);
        } else if (hasId(request)) {
          writeError(
            output,
            request.id,
            -32603,
            `MapIron returned HTTP ${status}`,
          );
        } else {
          safeLog(`MapIron returned HTTP ${status} for notification`);
        }
        return;
      }

      handleSuccess(request, type, body);
    } catch (error) {
      if (hasId(request)) {
        const detail = controller.signal.aborted
          ? `timed out after ${timeoutMs} ms`
          : redactString(error?.message || String(error));
        writeError(
          output,
          request.id,
          -32603,
          `Could not reach MapIron: ${detail}`,
        );
      } else {
        safeLog(
          `Dropped failed notification: ${redactString(
            error?.message || String(error),
          )}`,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  rl.on('line', (line) => {
    if (stopped) return;
    if (line.trim() === '') return;

    let request;
    try {
      request = JSON.parse(line);
    } catch {
      writeLine(output, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      });
      return;
    }

    const isInit = request && !Array.isArray(request) && request.method === 'initialize';
    const gate = initGate;
    const promise = (isInit ? processMessage(request, line) : gate.then(() => processMessage(request, line))).catch((error) => {
      safeLog(
        `Unexpected bridge error: ${redactString(
          error?.message || String(error),
        )}`,
      );
    });
    if (isInit) initGate = promise.then(() => {}, () => {});
    inflight.add(promise);
    promise.finally(() => inflight.delete(promise));
  });

  const done = new Promise((resolve, reject) => {
    rl.on('close', async () => {
      stopped = true;
      while (inflight.size > 0) {
        await Promise.allSettled([...inflight]);
      }
      resolve();
    });
    rl.on('error', reject);
  });

  return { done };
}
