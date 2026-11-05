#!/usr/bin/env node
import { createRequire } from 'node:module';
import { createBridge } from '../src/bridge.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const redactString = (value) =>
  String(value).replace(/ps_[A-Za-z0-9]+/g, '[REDACTED]');

function fatal(message) {
  process.stderr.write(`pinsharing-mcp: ${redactString(message)}\n`);
  process.exit(1);
}

function debug(...args) {
  if (process.env.PINSHARING_MCP_DEBUG !== '1') return;
  const message = args
    .map((arg) => (typeof arg === 'string' ? arg : String(arg)))
    .join(' ');
  process.stderr.write(`pinsharing-mcp: ${redactString(message)}\n`);
}

function printHelp() {
  process.stdout.write(`PinSharing MCP stdio bridge

Usage:
  pinsharing-mcp [--version | --help]

Environment:
  PINSHARING_API_KEY        Recommended. PinSharing API key (ps_...).
  PINSHARING_MCP_URL        Hosted MCP server URL.
                            Default: https://api.pinsharing.com/v1/mcp
  PINSHARING_MCP_TIMEOUT_MS HTTP timeout in milliseconds.
                            Default: 60000
  PINSHARING_MCP_DEBUG      Set to 1 to log debug messages to stderr.
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

const apiKey = process.env.PINSHARING_API_KEY || '';

let url;
try {
  url = new URL(
    process.env.PINSHARING_MCP_URL || 'https://api.pinsharing.com/v1/mcp',
  );
} catch {
  fatal(
    `Invalid PINSHARING_MCP_URL: ${process.env.PINSHARING_MCP_URL || ''}`,
  );
}

const hostname = url.hostname.toLowerCase();
if (
  url.protocol !== 'https:' &&
  !['localhost', '127.0.0.1'].includes(hostname)
) {
  fatal(
    'PINSHARING_MCP_URL must be https: unless the host is localhost or 127.0.0.1',
  );
}

const rawTimeoutMs = process.env.PINSHARING_MCP_TIMEOUT_MS || '60000';
const timeoutMs = Number(rawTimeoutMs);
if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
  fatal('PINSHARING_MCP_TIMEOUT_MS must be a positive integer');
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
