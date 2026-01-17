/**
 * Usage metering for MCP Server
 * Logs all tool executions for billing and analytics
 */

import type { Env, MCPContext } from '../types'

interface MeteringParams {
  context: MCPContext
  toolName: string
  success: boolean
  errorMessage?: string
  durationMs?: number
  requestMetadata?: Record<string, unknown>
}

/**
 * Logs a tool execution to the mcp_usage table
 * Uses service_role to bypass RLS
 */
export async function logUsage(
  params: MeteringParams,
  env: Env
): Promise<void> {
  const {
    context,
    toolName,
    success,
    errorMessage,
    durationMs,
    requestMetadata = {}
  } = params

  try {
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/rpc/log_mcp_usage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({
          p_api_key_id: context.apiKeyId,
          p_brand_id: context.brandId,
          p_tool_name: toolName,
          p_user_id: context.userId || null,
          p_success: success,
          p_error_message: errorMessage || null,
          p_duration_ms: durationMs || null,
          p_request_metadata: requestMetadata
        })
      }
    )

    if (!response.ok) {
      // Log error but don't throw - metering shouldn't break tool execution
      console.error('Failed to log usage:', await response.text())
    }
  } catch (error) {
    console.error('Metering error:', error)
  }
}

/**
 * Wraps a tool execution with metering
 * Automatically logs start/end time and success/failure
 */
export async function withMetering<T>(
  context: MCPContext,
  toolName: string,
  env: Env,
  fn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now()
  let success = true
  let errorMessage: string | undefined

  try {
    const result = await fn()
    return result
  } catch (error) {
    success = false
    errorMessage = error instanceof Error ? error.message : 'Unknown error'
    throw error
  } finally {
    const durationMs = Date.now() - startTime

    // Fire and forget - don't await metering
    logUsage(
      {
        context,
        toolName,
        success,
        errorMessage,
        durationMs
      },
      env
    ).catch(console.error)
  }
}
