/**
 * Kntor MCP Server
 *
 * Model Context Protocol server for Kntor.io ERP
 * Allows AI agents to interact with the healthcare ERP
 *
 * Transports:
 * - HTTP + SSE (for n8n, WhatsApp bots, web clients)
 * - stdio (for Claude Desktop)
 *
 * Authentication:
 * - API Key (x-api-key header) → Identifies brand
 * - JWT (in tool calls) → Identifies user, preserves RBAC
 */

import type { Env, MCPContext, ApiKeyValidationResult } from './types'
import { validateApiKey, extractApiKey } from './auth/api-key'
import { tools, executeTool } from './tools'

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
  'Access-Control-Max-Age': '86400'
}

/**
 * MCP JSON-RPC Response
 */
interface JSONRPCResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

/**
 * Create a JSON-RPC success response
 */
function jsonRPCSuccess(id: string | number | null, result: unknown): JSONRPCResponse {
  return {
    jsonrpc: '2.0',
    id,
    result
  }
}

/**
 * Create a JSON-RPC error response
 */
function jsonRPCError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): JSONRPCResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, data }
  }
}

/**
 * Handle MCP protocol messages
 */
async function handleMCPMessage(
  message: {
    jsonrpc: string
    id?: string | number | null
    method: string
    params?: unknown
  },
  apiKeyResult: ApiKeyValidationResult,
  env: Env
): Promise<JSONRPCResponse> {
  const id = message.id ?? null

  switch (message.method) {
    // === Initialization ===
    case 'initialize': {
      return jsonRPCSuccess(id, {
        protocolVersion: '2024-11-05',
        serverInfo: {
          name: 'kntor-mcp-server',
          version: '1.0.0'
        },
        capabilities: {
          tools: {},
          resources: {},
          prompts: {}
        }
      })
    }

    case 'initialized': {
      // Client acknowledged initialization
      return jsonRPCSuccess(id, {})
    }

    // === Tool Operations ===
    case 'tools/list': {
      return jsonRPCSuccess(id, {
        tools: tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        }))
      })
    }

    case 'tools/call': {
      const params = message.params as {
        name: string
        arguments?: Record<string, unknown>
      }

      if (!params?.name) {
        return jsonRPCError(id, -32602, 'Invalid params: tool name required')
      }

      // Build context from API key validation
      const context: MCPContext = {
        apiKeyId: apiKeyResult.api_key_id!,
        brandId: apiKeyResult.brand_id!,
        brandName: apiKeyResult.brand_name!,
        tier: apiKeyResult.tier!
      }

      // Execute tool
      const result = await executeTool(
        params.name,
        params.arguments || {},
        context,
        env
      )

      if (result.success) {
        return jsonRPCSuccess(id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result.data, null, 2)
            }
          ]
        })
      } else {
        return jsonRPCSuccess(id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: result.error }, null, 2)
            }
          ],
          isError: true
        })
      }
    }

    // === Resource Operations (not implemented yet) ===
    case 'resources/list': {
      return jsonRPCSuccess(id, { resources: [] })
    }

    case 'resources/read': {
      return jsonRPCError(id, -32601, 'Resources not implemented')
    }

    // === Prompt Operations (not implemented yet) ===
    case 'prompts/list': {
      return jsonRPCSuccess(id, { prompts: [] })
    }

    case 'prompts/get': {
      return jsonRPCError(id, -32601, 'Prompts not implemented')
    }

    // === Ping ===
    case 'ping': {
      return jsonRPCSuccess(id, {})
    }

    // === Unknown Method ===
    default: {
      return jsonRPCError(id, -32601, `Method not found: ${message.method}`)
    }
  }
}

/**
 * Main Cloudflare Worker fetch handler
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    // Health check endpoint
    if (url.pathname === '/health' || url.pathname === '/') {
      return new Response(
        JSON.stringify({
          status: 'healthy',
          server: 'kntor-mcp-server',
          version: '1.0.0',
          timestamp: new Date().toISOString()
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        }
      )
    }

    // MCP message endpoint
    if (url.pathname === '/mcp' || url.pathname === '/messages') {
      // Validate API key
      const apiKey = extractApiKey(request)

      if (!apiKey) {
        return new Response(
          JSON.stringify(
            jsonRPCError(null, -32000, 'API key required', {
              hint: 'Provide API key in x-api-key header or as Bearer token'
            })
          ),
          {
            status: 401,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          }
        )
      }

      const apiKeyResult = await validateApiKey(apiKey, env)

      if (!apiKeyResult.valid) {
        return new Response(
          JSON.stringify(
            jsonRPCError(null, -32000, apiKeyResult.message || 'Invalid API key', {
              error: apiKeyResult.error
            })
          ),
          {
            status: 401,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          }
        )
      }

      // Parse JSON-RPC message
      let message: {
        jsonrpc: string
        id?: string | number | null
        method: string
        params?: unknown
      }

      try {
        message = await request.json()
      } catch {
        return new Response(
          JSON.stringify(jsonRPCError(null, -32700, 'Parse error')),
          {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          }
        )
      }

      // Validate JSON-RPC format
      if (message.jsonrpc !== '2.0' || !message.method) {
        return new Response(
          JSON.stringify(jsonRPCError(null, -32600, 'Invalid Request')),
          {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          }
        )
      }

      // Handle the message
      const response = await handleMCPMessage(message, apiKeyResult, env)

      return new Response(JSON.stringify(response), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      })
    }

    // SSE endpoint for streaming (future)
    if (url.pathname === '/sse') {
      return new Response(
        JSON.stringify({ error: 'SSE transport not yet implemented' }),
        {
          status: 501,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        }
      )
    }

    // 404 for unknown paths
    return new Response(
      JSON.stringify({
        error: 'Not found',
        endpoints: {
          '/': 'Health check',
          '/health': 'Health check',
          '/mcp': 'MCP JSON-RPC endpoint',
          '/messages': 'MCP JSON-RPC endpoint (alias)'
        }
      }),
      {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      }
    )
  }
}
