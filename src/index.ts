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
 * MCP Error Codes
 */
const MCP_ERRORS = {
  // Authentication errors (-32000 to -32099)
  API_KEY_MISSING: {
    code: -32001,
    message: 'API key required',
    hint: 'Provide your API key in the x-api-key header or as Bearer token in Authorization header'
  },
  API_KEY_INVALID_FORMAT: {
    code: -32002,
    message: 'Invalid API key format',
    hint: 'API key must start with "kntor_" prefix. Example: kntor_abc123...'
  },
  API_KEY_INVALID: {
    code: -32003,
    message: 'Invalid or expired API key',
    hint: 'Check that your API key is correct and has not been revoked'
  },
  API_KEY_INACTIVE: {
    code: -32004,
    message: 'API key is inactive',
    hint: 'Contact your administrator to reactivate this API key'
  },
  API_KEY_EXPIRED: {
    code: -32005,
    message: 'API key has expired',
    hint: 'Request a new API key from your administrator'
  },
  RATE_LIMIT_EXCEEDED: {
    code: -32006,
    message: 'Rate limit exceeded',
    hint: 'You have exceeded your monthly API call limit. Upgrade your plan or wait until next month'
  },
  // Server errors
  SERVER_CONFIG_ERROR: {
    code: -32010,
    message: 'Server configuration error',
    hint: 'The server is misconfigured. Please contact support'
  }
}

/**
 * Create authentication error response with detailed information
 */
function createAuthErrorResponse(
  errorType: keyof typeof MCP_ERRORS,
  additionalData?: Record<string, unknown>
): { response: JSONRPCResponse; status: number } {
  const error = MCP_ERRORS[errorType]
  return {
    response: jsonRPCError(null, error.code, error.message, {
      hint: error.hint,
      error_type: errorType.toLowerCase(),
      documentation: 'https://github.com/edgargomero/kntor-mcp-server#authentication',
      ...additionalData
    }),
    status: errorType === 'SERVER_CONFIG_ERROR' ? 500 : 401
  }
}

/**
 * Map API key validation result to appropriate error
 */
function getAuthError(apiKeyResult: ApiKeyValidationResult): keyof typeof MCP_ERRORS {
  if (!apiKeyResult.error) return 'API_KEY_INVALID'

  switch (apiKeyResult.error) {
    case 'invalid_format':
      return 'API_KEY_INVALID_FORMAT'
    case 'not_found':
    case 'validation_error':
      return 'API_KEY_INVALID'
    case 'inactive':
      return 'API_KEY_INACTIVE'
    case 'expired':
      return 'API_KEY_EXPIRED'
    case 'rate_limit':
      return 'RATE_LIMIT_EXCEEDED'
    case 'config_error':
    case 'internal_error':
      return 'SERVER_CONFIG_ERROR'
    default:
      return 'API_KEY_INVALID'
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

      // Check rate limit before executing tool
      if (apiKeyResult.remaining_calls !== undefined && apiKeyResult.remaining_calls <= 0) {
        return jsonRPCError(id, MCP_ERRORS.RATE_LIMIT_EXCEEDED.code, MCP_ERRORS.RATE_LIMIT_EXCEEDED.message, {
          hint: MCP_ERRORS.RATE_LIMIT_EXCEEDED.hint,
          monthly_limit: apiKeyResult.monthly_limit,
          current_usage: apiKeyResult.current_usage,
          reset_date: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString(),
          upgrade_url: 'https://kntor.io/pricing'
        })
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

    // GET /usage - Query API key usage statistics
    if (url.pathname === '/usage' && request.method === 'GET') {
      const apiKey = extractApiKey(request)

      if (!apiKey) {
        return new Response(
          JSON.stringify({ error: 'API key required', hint: 'Provide your API key in the x-api-key header' }),
          { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        )
      }

      const apiKeyResult = await validateApiKey(apiKey, env)

      if (!apiKeyResult.valid) {
        return new Response(
          JSON.stringify({ error: apiKeyResult.message || 'Invalid API key' }),
          { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        )
      }

      // Calculate next cycle reset date (first day of next month)
      const now = new Date()
      const cycleReset = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()

      return new Response(
        JSON.stringify({
          tier: apiKeyResult.tier,
          monthly_limit: apiKeyResult.monthly_limit,
          current_usage: apiKeyResult.current_usage,
          remaining_calls: apiKeyResult.remaining_calls,
          cycle_reset: cycleReset
        }),
        { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
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

    // MCP message endpoint - supports both JSON and Streamable HTTP transport
    if (url.pathname === '/mcp') {
      // Handle GET request for Streamable HTTP transport (session initialization)
      if (request.method === 'GET') {
        const acceptHeader = request.headers.get('Accept') || ''

        // If client accepts SSE, this is Streamable HTTP transport initialization
        if (acceptHeader.includes('text/event-stream')) {
          // Validate API key first
          const apiKey = extractApiKey(request)

          if (!apiKey) {
            const { response, status } = createAuthErrorResponse('API_KEY_MISSING')
            return new Response(JSON.stringify(response), {
              status,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            })
          }

          const apiKeyResult = await validateApiKey(apiKey, env)

          if (!apiKeyResult.valid) {
            const errorType = getAuthError(apiKeyResult)
            const { response, status } = createAuthErrorResponse(errorType, {
              provided_key_prefix: apiKey.substring(0, 12) + '...',
              server_message: apiKeyResult.message
            })
            return new Response(JSON.stringify(response), {
              status,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            })
          }

          // Generate session ID for Streamable HTTP
          const sessionId = crypto.randomUUID()

          // Create SSE stream for Streamable HTTP transport
          const { readable, writable } = new TransformStream()
          const writer = writable.getWriter()
          const encoder = new TextEncoder()

          // Keep connection alive
          ;(async () => {
            try {
              // Send initial ping to establish connection
              await writer.write(encoder.encode(': connected\n\n'))

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
              console.error('Streamable HTTP stream error:', error)
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
              'Mcp-Session-Id': sessionId,
              ...corsHeaders
            }
          })
        }

        // Regular GET returns server info
        return new Response(
          JSON.stringify({
            name: 'kntor-mcp-server',
            version: '1.0.0',
            description: 'MCP Server for Kntor.io ERP',
            transport: ['streamable-http', 'http'],
            endpoints: {
              mcp: '/mcp'
            }
          }),
          {
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          }
        )
      }

      // Handle DELETE request for session termination (Streamable HTTP)
      if (request.method === 'DELETE') {
        const sessionId = request.headers.get('Mcp-Session-Id')
        // Just acknowledge the session termination
        return new Response(null, {
          status: 204,
          headers: corsHeaders
        })
      }

      // POST request - handle MCP messages
      // Validate API key
      const apiKey = extractApiKey(request)

      if (!apiKey) {
        const { response, status } = createAuthErrorResponse('API_KEY_MISSING')
        return new Response(JSON.stringify(response), {
          status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        })
      }

      const apiKeyResult = await validateApiKey(apiKey, env)

      if (!apiKeyResult.valid) {
        const errorType = getAuthError(apiKeyResult)
        const { response, status } = createAuthErrorResponse(errorType, {
          provided_key_prefix: apiKey.substring(0, 12) + '...',
          server_message: apiKeyResult.message
        })
        return new Response(JSON.stringify(response), {
          status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        })
      }

      // Parse JSON-RPC message(s) - can be single or batch
      let body: unknown

      try {
        body = await request.json()
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

      // Check if client wants SSE response (Streamable HTTP)
      const acceptHeader = request.headers.get('Accept') || ''
      const wantsSSE = acceptHeader.includes('text/event-stream')
      const sessionId = request.headers.get('Mcp-Session-Id') || crypto.randomUUID()

      // Handle batch requests
      const messages = Array.isArray(body) ? body : [body]
      const responses: JSONRPCResponse[] = []

      for (const message of messages) {
        // Validate JSON-RPC format
        if (!message || message.jsonrpc !== '2.0' || !message.method) {
          responses.push(jsonRPCError(message?.id ?? null, -32600, 'Invalid Request'))
          continue
        }

        // Handle the message
        const response = await handleMCPMessage(message, apiKeyResult, env)

        // Only add response if it has an id (not a notification)
        if (message.id !== undefined) {
          responses.push(response)
        }
      }

      // If client wants SSE, send as event stream
      if (wantsSSE) {
        const { readable, writable } = new TransformStream()
        const writer = writable.getWriter()
        const encoder = new TextEncoder()

        ;(async () => {
          try {
            for (const response of responses) {
              await writer.write(
                encoder.encode(`event: message\ndata: ${JSON.stringify(response)}\n\n`)
              )
            }
            await writer.close()
          } catch (error) {
            console.error('SSE response error:', error)
            try {
              await writer.close()
            } catch { /* ignore */ }
          }
        })()

        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Mcp-Session-Id': sessionId,
            ...corsHeaders
          }
        })
      }

      // Return JSON response
      const jsonResponse = Array.isArray(body) ? responses : responses[0]

      return new Response(JSON.stringify(jsonResponse), {
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': sessionId,
          ...corsHeaders
        }
      })
    }

    // Legacy /messages endpoint for backwards compatibility
    if (url.pathname === '/messages') {
      // Validate API key
      const apiKey = extractApiKey(request)

      if (!apiKey) {
        const { response, status } = createAuthErrorResponse('API_KEY_MISSING')
        return new Response(JSON.stringify(response), {
          status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        })
      }

      const apiKeyResult = await validateApiKey(apiKey, env)

      if (!apiKeyResult.valid) {
        const errorType = getAuthError(apiKeyResult)
        const { response, status } = createAuthErrorResponse(errorType, {
          provided_key_prefix: apiKey.substring(0, 12) + '...',
          server_message: apiKeyResult.message
        })
        return new Response(JSON.stringify(response), {
          status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        })
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

    // 404 for unknown paths
    return new Response(
      JSON.stringify({
        error: 'Not found',
        endpoints: {
          '/': 'Health check',
          '/health': 'Health check',
          '/usage': 'API key usage statistics (GET)',
          '/mcp': 'MCP endpoint (Streamable HTTP + JSON-RPC)',
          '/sse': 'Legacy SSE transport (GET)',
          '/messages': 'Legacy SSE messages endpoint (POST)'
        },
        transports: ['streamable-http', 'sse', 'http']
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
