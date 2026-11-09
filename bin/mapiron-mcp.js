#!/usr/bin/env node
import { createRequire } from 'node:module';
import { createBridge } from '../src/bridge.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

// MAPIRON_* is the current name. PINSHARING_* (the name before the
// November 2026 rename) is still read, so existing configs keep working.
function env(name) {
  const current = process.env[`MAPIRON_${name}`];
  if (current !== undefined && current !== '') return current;
  const legacy = process.env[`PINSHARING_${name}`];
  if (legacy !== undefined && legacy !== '') return legacy;
  return '';
}

const redactString = (value) =>
  String(value).replace(/ps_[A-Za-z0-9]+/g, '[REDACTED]');

function fatal(message) {
  process.stderr.write(`mapiron-mcp: ${redactString(message)}\n`);
  process.exit(1);
}

function debug(...args) {
  if (env('MCP_DEBUG') !== '1') return;
  const message = args
    .map((arg) => (typeof arg === 'string' ? arg : String(arg)))
    .join(' ');
  process.stderr.write(`mapiron-mcp: ${redactString(message)}\n`);
}

function printHelp() {
  process.stdout.write(`MapIron MCP stdio bridge

Usage:
  mapiron-mcp [--version | --help]

Environment:
  MAPIRON_API_KEY        Recommended. MapIron API key (ps_...).
  MAPIRON_MCP_URL        Hosted MCP server URL.
                         Default: https://api.mapiron.com/v1/mcp
  MAPIRON_MCP_TIMEOUT_MS HTTP timeout in milliseconds.
                         Default: 60000
  MAPIRON_MCP_DEBUG      Set to 1 to log debug messages to stderr.

The older PINSHARING_* names are still accepted.
`);
}

const args = process.argv.slice(2);

if (args.includes('--help')) {
  printHelp();
  process.exit(0);
}

if (args.includes('--version')) {
  process.stdout.write(`${version}\n`);
  process.exit(0);
}

if (args.length > 0) {
  fatal(`Unknown argument: ${args[0]}`);
}

const apiKey = env('API_KEY');

const rawUrl = env('MCP_URL') || 'https://api.mapiron.com/v1/mcp';
let url;
try {
  url = new URL(rawUrl);
} catch {
  fatal(`Invalid MAPIRON_MCP_URL: ${rawUrl}`);
}

const hostname = url.hostname.toLowerCase();
if (
  url.protocol !== 'https:' &&
  !['localhost', '127.0.0.1'].includes(hostname)
) {
  fatal(
    'MAPIRON_MCP_URL must be https: unless the host is localhost or 127.0.0.1',
  );
}

const rawTimeoutMs = env('MCP_TIMEOUT_MS') || '60000';
const timeoutMs = Number(rawTimeoutMs);
if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
  fatal('MAPIRON_MCP_TIMEOUT_MS must be a positive integer');
}

const bridge = createBridge({
  input: process.stdin,
  output: process.stdout,
  url: url.href,
  apiKey,
  timeoutMs,
  log: debug,
});

process.once('SIGINT', () => process.exit(0));
process.once('SIGTERM', () => process.exit(0));

bridge.done.then(
  () => {
    process.exitCode = 0;
  },
  (error) => {
    fatal(error?.message || String(error));
  },
);
