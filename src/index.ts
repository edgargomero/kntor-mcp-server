/**
 * Kntor MCP Server
 *
 * Model Context Protocol server for Kntor.io ERP
 * Allows AI agents to interact with the multi-tenant ERP
 *
 * Transports:
 * - HTTP + SSE (for n8n, WhatsApp bots, web clients)
 * - stdio (for Claude Desktop)
 *
 * Authentication:
 * - API Key (x-api-key header) → Identifies brand + user (from key creator)
 * - Brand isolation enforced via brand_id in all operations
 * - User tracking via API key's created_by field
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

    case 'initialized':
    case 'notifications/initialized': {
      // Client acknowledged initialization (both formats)
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

      // Build context from API key validation (includes user info from API key creator)
      const context: MCPContext = {
        apiKeyId: apiKeyResult.api_key_id!,
        brandId: apiKeyResult.brand_id!,
        brandName: apiKeyResult.brand_name!,
        tier: apiKeyResult.tier!,
        userId: apiKeyResult.user_id!,
        userEmail: apiKeyResult.user_email || '',
        userRole: apiKeyResult.user_role || 'authenticated'
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

    // MCP Protected Resource Metadata (RFC 9470)
    // Tell clients that this server uses API key auth, not OAuth
    if (url.pathname === '/.well-known/oauth-protected-resource') {
      return new Response(
        JSON.stringify({
          resource: url.origin,
          // No authorization_servers = no OAuth required
          // Client should use provided headers instead
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        }
      )
    }

    // OAuth metadata discovery - return 404 to indicate OAuth not supported
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return new Response(null, { status: 404, headers: corsHeaders })
    }

    // Handle OAuth Dynamic Client Registration (RFC 7591)
    // Return mock success so mcp-remote skips actual OAuth flow
    if (url.pathname === '/register' && request.method === 'POST') {
      // Return a mock client registration response
      return new Response(
        JSON.stringify({
          client_id: 'kntor-api-key-auth',
          client_id_issued_at: Math.floor(Date.now() / 1000),
          // No client_secret = public client, no OAuth token needed
        }),
        {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
          }
        }
      )
    }

    // Handle other OAuth endpoints - return 404
    if (url.pathname.startsWith('/oauth')) {
      return new Response(null, { status: 404, headers: corsHeaders })
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

    // SSE endpoint for Claude Desktop (legacy SSE transport)
    // GET /sse establishes SSE connection and sends endpoint event
    if (url.pathname === '/sse' && request.method === 'GET') {
      // Generate a session ID
      const sessionId = crypto.randomUUID()

      // Build the messages endpoint URL
      const messagesUrl = new URL('/messages', url.origin)
      messagesUrl.searchParams.set('sessionId', sessionId)

      // Create SSE stream
      const { readable, writable } = new TransformStream()
      const writer = writable.getWriter()
      const encoder = new TextEncoder()

      // Send the endpoint event immediately
      const sendEvent = async (event: string, data: string) => {
        await writer.write(encoder.encode(`event: ${event}\ndata: ${data}\n\n`))
      }

      // Start the SSE stream
      ;(async () => {
        try {
          // Send endpoint event (tells client where to POST messages)
          await sendEvent('endpoint', messagesUrl.toString())

          // Keep connection alive with periodic pings
          const pingInterval = setInterval(async () => {
            try {
              await writer.write(encoder.encode(': ping\n\n'))
            } catch {
              clearInterval(pingInterval)
            }
          }, 30000)

          // Keep the connection open for 5 minutes max
          await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000))
          clearInterval(pingInterval)
          await writer.close()
        } catch (error) {
          console.error('SSE stream error:', error)
          try {
            await writer.close()
          } catch { /* ignore */ }
        }
      })()

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          ...corsHeaders
        }
      })
    }

    // Messages endpoint for SSE transport (POST /messages?sessionId=xxx)
    if (url.pathname === '/messages' && request.method === 'POST') {
      // Validate API key
      const apiKey = extractApiKey(request)

      if (!apiKey) {
        return new Response(
          JSON.stringify(
            jsonRPCError(null, -32000, 'API key required', {
              hint: 'Provide API key in x-api-key header'
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
            jsonRPCError(null, -32000, apiKeyResult.message || 'Invalid API key')
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

      // Return JSON response (not SSE - that's only for the GET /sse stream)
      return new Response(JSON.stringify(response), {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders
        }
      })
    }

    // 404 for unknown paths
    return new Response(
      JSON.stringify({
        error: 'Not found',
        endpoints: {
          '/': 'Health check',
          '/health': 'Health check',
          '/mcp': 'MCP JSON-RPC endpoint (HTTP)',
          '/sse': 'SSE transport for Claude Desktop (GET)',
          '/messages': 'SSE transport messages endpoint (POST)'
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
