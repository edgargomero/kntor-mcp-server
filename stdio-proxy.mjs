#!/usr/bin/env node
/**
 * Kntor MCP Stdio Proxy
 *
 * Simple stdio proxy that forwards MCP messages to the remote server.
 * No OAuth complexity - just API key authentication.
 *
 * Usage in claude_desktop_config.json:
 * {
 *   "mcpServers": {
 *     "kntor-erp": {
 *       "command": "node",
 *       "args": ["C:\\path\\to\\stdio-proxy.mjs"],
 *       "env": {
 *         "KNTOR_API_KEY": "kntor_your_key_here"
 *       }
 *     }
 *   }
 * }
 */

import { createInterface } from 'readline';

const SERVER_URL = 'https://kntor-mcp-server.edgar-gomero.workers.dev/mcp';
const API_KEY = process.env.KNTOR_API_KEY;

if (!API_KEY) {
  console.error('Error: KNTOR_API_KEY environment variable is required');
  process.exit(1);
}

// Read line by line from stdin
const rl = createInterface({
  input: process.stdin,
  terminal: false
});

rl.on('line', async (line) => {
  try {
    // Parse incoming JSON-RPC message
    const message = JSON.parse(line);

    // Forward to remote server
    const response = await fetch(SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY
      },
      body: JSON.stringify(message)
    });

    // Get response
    const result = await response.json();

    // Write to stdout (Claude Desktop reads this)
    console.log(JSON.stringify(result));

  } catch (error) {
    // Return JSON-RPC error
    const errorResponse = {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32603,
        message: error.message || 'Internal error'
      }
    };
    console.log(JSON.stringify(errorResponse));
  }
});

// Handle stdin close
rl.on('close', () => {
  process.exit(0);
});

// Keep process alive
process.stdin.resume();
