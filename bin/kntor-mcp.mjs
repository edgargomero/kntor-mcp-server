#!/usr/bin/env node
/**
 * Kntor MCP Client
 *
 * Stdio proxy that connects Claude Desktop to Kntor.io ERP.
 * Handles MCP protocol communication over stdin/stdout.
 *
 * Usage:
 *   KNTOR_API_KEY=kntor_xxx npx kntor-mcp
 *
 * Configuration for Claude Desktop (claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "kntor-erp": {
 *       "command": "npx",
 *       "args": ["-y", "kntor-mcp"],
 *       "env": {
 *         "KNTOR_API_KEY": "kntor_your_api_key_here"
 *       }
 *     }
 *   }
 * }
 */

const SERVER_URL = process.env.KNTOR_MCP_URL || 'https://mcp.kntor.io/mcp';
const API_KEY = process.env.KNTOR_API_KEY;

// Validate API key
if (!API_KEY) {
  const error = {
    jsonrpc: '2.0',
    id: null,
    error: {
      code: -32600,
      message: 'KNTOR_API_KEY environment variable is required. Get your API key at https://kntor.io/settings/mcp'
    }
  };
  console.log(JSON.stringify(error));
  process.exit(1);
}

if (!API_KEY.startsWith('kntor_')) {
  const error = {
    jsonrpc: '2.0',
    id: null,
    error: {
      code: -32600,
      message: 'Invalid API key format. Key should start with "kntor_"'
    }
  };
  console.log(JSON.stringify(error));
  process.exit(1);
}

// Buffer for incomplete JSON messages
let buffer = '';

// Process stdin data
process.stdin.setEncoding('utf8');
process.stdin.on('data', async (chunk) => {
  buffer += chunk;

  // Process complete lines
  const lines = buffer.split('\n');
  buffer = lines.pop() || ''; // Keep incomplete line in buffer

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const message = JSON.parse(line);
      await handleMessage(message);
    } catch (parseError) {
      // Log parse errors to stderr (won't interfere with protocol)
      console.error('[kntor-mcp] Parse error:', parseError.message);
    }
  }
});

// Handle a single MCP message
async function handleMessage(message) {
  // Preserve the request id (use 0 as fallback, not null - Claude Desktop requires string/number)
  const requestId = message.id !== undefined ? message.id : 0;

  try {
    console.error(`[kntor-mcp] Sending: ${message.method}`);

    const response = await fetch(SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY
      },
      body: JSON.stringify(message)
    });

    const responseText = await response.text();
    console.error(`[kntor-mcp] Response (${response.status}): ${responseText.substring(0, 200)}`);

    if (!response.ok) {
      let errorData;
      try {
        errorData = JSON.parse(responseText);
      } catch {
        errorData = { message: responseText };
      }

      const errorResponse = {
        jsonrpc: '2.0',
        id: requestId,
        error: {
          code: -32000,
          message: `Server error (${response.status}): ${errorData.error?.message || errorData.message || responseText}`
        }
      };
      console.log(JSON.stringify(errorResponse));
      return;
    }

    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      const errorResponse = {
        jsonrpc: '2.0',
        id: requestId,
        error: {
          code: -32603,
          message: `Invalid JSON response: ${responseText.substring(0, 100)}`
        }
      };
      console.log(JSON.stringify(errorResponse));
      return;
    }

    // Ensure the response has the correct id
    if (result.id === null || result.id === undefined) {
      result.id = requestId;
    }

    console.log(JSON.stringify(result));

  } catch (networkError) {
    console.error(`[kntor-mcp] Network error: ${networkError.message}`);
    const errorResponse = {
      jsonrpc: '2.0',
      id: requestId,
      error: {
        code: -32603,
        message: `Network error: ${networkError.message}`
      }
    };
    console.log(JSON.stringify(errorResponse));
  }
}

// Handle stdin close
process.stdin.on('end', () => {
  process.exit(0);
});

// Handle process signals
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

// Keep process alive
process.stdin.resume();

// Log startup to stderr (doesn't interfere with protocol)
console.error('[kntor-mcp] Connected to Kntor.io ERP');
