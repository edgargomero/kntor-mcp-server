/**
 * API Key validation for MCP Server
 * Uses service_role to call validate_mcp_api_key RPC
 */

import type { Env, ApiKeyValidationResult } from '../types'

/**
 * Validates an API key against the database
 * @param apiKey - Raw API key (e.g., kntor_abc123...)
 * @param env - Worker environment with Supabase credentials
 * @returns Validation result with brand context if valid
 */
export async function validateApiKey(
  apiKey: string,
  env: Env
): Promise<ApiKeyValidationResult> {
  // Basic format validation
  if (!apiKey || !apiKey.startsWith('kntor_')) {
    return {
      valid: false,
      error: 'invalid_format',
      message: 'API key must start with kntor_'
    }
  }

  try {
    // Debug: Log environment availability
    console.log('[validateApiKey] SUPABASE_URL defined:', !!env.SUPABASE_URL)
    console.log('[validateApiKey] SERVICE_ROLE_KEY defined:', !!env.SUPABASE_SERVICE_ROLE_KEY)

    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[validateApiKey] Missing environment variables')
      return {
        valid: false,
        error: 'config_error',
        message: 'Server configuration error: missing Supabase credentials'
      }
    }

    const rpcUrl = `${env.SUPABASE_URL}/rest/v1/rpc/validate_mcp_api_key`
    console.log('[validateApiKey] Calling RPC:', rpcUrl)

    // Call the RPC with service_role (bypasses RLS)
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({ p_api_key: apiKey })
    })

    console.log('[validateApiKey] Response status:', response.status)

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[validateApiKey] RPC failed:', response.status, errorText)
      return {
        valid: false,
        error: 'validation_error',
        message: `Failed to validate API key: ${response.status}`
      }
    }

    const result: ApiKeyValidationResult = await response.json()
    console.log('[validateApiKey] Result valid:', result.valid)
    return result
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('[validateApiKey] Exception:', errorMessage)
    return {
      valid: false,
      error: 'internal_error',
      message: `Internal server error: ${errorMessage}`
    }
  }
}

/**
 * Extracts API key from request headers
 * Supports: x-api-key header or Authorization: Bearer <key>
 */
export function extractApiKey(request: Request): string | null {
  // Check x-api-key header first (preferred)
  const xApiKey = request.headers.get('x-api-key')
  if (xApiKey) {
    return xApiKey
  }

  // Check Authorization header for Bearer token that looks like an API key
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer kntor_')) {
    return authHeader.replace('Bearer ', '')
  }

  return null
}
