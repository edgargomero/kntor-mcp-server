/**
 * JWT validation for MCP Server
 * Validates Supabase JWTs passed in tool calls
 */

import type { Env, JWTPayload } from '../types'

/**
 * Decodes and validates a Supabase JWT
 * @param jwt - The JWT token from tool call
 * @param env - Worker environment
 * @returns Decoded payload if valid, null otherwise
 */
export async function validateJWT(
  jwt: string,
  env: Env
): Promise<JWTPayload | null> {
  if (!jwt) {
    return null
  }

  try {
    // Decode JWT without verification first (to check expiry)
    const parts = jwt.split('.')
    if (parts.length !== 3) {
      console.error('Invalid JWT format')
      return null
    }

    // Decode payload (middle part)
    const payloadBase64 = parts[1]
    const payloadJson = atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/'))
    const payload: JWTPayload = JSON.parse(payloadJson)

    // Check expiration
    const now = Math.floor(Date.now() / 1000)
    if (payload.exp && payload.exp < now) {
      console.error('JWT expired')
      return null
    }

    // Verify JWT is from our Supabase instance by calling auth endpoint
    const verifyResponse = await fetch(
      `${env.SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          'Authorization': `Bearer ${jwt}`,
          'apikey': env.SUPABASE_ANON_KEY
        }
      }
    )

    if (!verifyResponse.ok) {
      console.error('JWT verification failed:', await verifyResponse.text())
      return null
    }

    // Get user info from verification response
    const userData = await verifyResponse.json()

    return {
      ...payload,
      sub: userData.id || payload.sub,
      email: userData.email || payload.email
    }
  } catch (error) {
    console.error('JWT validation error:', error)
    return null
  }
}

/**
 * Creates a Supabase client that uses the user's JWT
 * This preserves auth.uid() in RPC calls for RBAC
 */
export function createUserClient(jwt: string, env: Env) {
  return {
    /**
     * Call an RPC function with user's JWT
     */
    rpc: async <T = unknown>(
      fnName: string,
      params: Record<string, unknown> = {}
    ): Promise<{ data: T | null; error: string | null }> => {
      try {
        const response = await fetch(
          `${env.SUPABASE_URL}/rest/v1/rpc/${fnName}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': env.SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${jwt}`
            },
            body: JSON.stringify(params)
          }
        )

        if (!response.ok) {
          const errorText = await response.text()
          return { data: null, error: errorText }
        }

        const data = await response.json()
        return { data, error: null }
      } catch (error) {
        return {
          data: null,
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      }
    },

    /**
     * Query a table with user's JWT
     */
    from: (table: string) => ({
      select: async <T = unknown>(
        columns = '*',
        options: {
          filter?: Record<string, unknown>
          limit?: number
          order?: { column: string; ascending?: boolean }
        } = {}
      ): Promise<{ data: T[] | null; error: string | null }> => {
        try {
          let url = `${env.SUPABASE_URL}/rest/v1/${table}?select=${columns}`

          // Add filters
          if (options.filter) {
            for (const [key, value] of Object.entries(options.filter)) {
              url += `&${key}=eq.${value}`
            }
          }

          // Add limit
          if (options.limit) {
            url += `&limit=${options.limit}`
          }

          // Add order
          if (options.order) {
            url += `&order=${options.order.column}.${options.order.ascending ? 'asc' : 'desc'}`
          }

          const response = await fetch(url, {
            headers: {
              'apikey': env.SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${jwt}`
            }
          })

          if (!response.ok) {
            const errorText = await response.text()
            return { data: null, error: errorText }
          }

          const data = await response.json()
          return { data, error: null }
        } catch (error) {
          return {
            data: null,
            error: error instanceof Error ? error.message : 'Unknown error'
          }
        }
      }
    })
  }
}
