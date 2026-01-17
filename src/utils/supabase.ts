/**
 * Supabase client factory for MCP Server
 * Provides both service_role and user-authenticated clients
 */

import type { Env } from '../types'

/**
 * Creates a service role client for admin operations
 * Use sparingly - bypasses all RLS
 */
export function createServiceClient(env: Env) {
  return {
    /**
     * Call an RPC function with service_role
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
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
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
     * Query a table with service_role
     */
    from: (table: string) => ({
      select: async <T = unknown>(
        columns = '*',
        options: {
          filter?: Record<string, unknown>
          eq?: Array<{ column: string; value: unknown }>
          limit?: number
          order?: { column: string; ascending?: boolean }
        } = {}
      ): Promise<{ data: T[] | null; error: string | null }> => {
        try {
          let url = `${env.SUPABASE_URL}/rest/v1/${table}?select=${columns}`

          // Add eq filters
          if (options.eq) {
            for (const { column, value } of options.eq) {
              url += `&${column}=eq.${value}`
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
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
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
      },

      insert: async <T = unknown>(
        data: Record<string, unknown>
      ): Promise<{ data: T | null; error: string | null }> => {
        try {
          const response = await fetch(
            `${env.SUPABASE_URL}/rest/v1/${table}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                'Prefer': 'return=representation'
              },
              body: JSON.stringify(data)
            }
          )

          if (!response.ok) {
            const errorText = await response.text()
            return { data: null, error: errorText }
          }

          const result = await response.json()
          return { data: Array.isArray(result) ? result[0] : result, error: null }
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

/**
 * Parse PostgreSQL timestamp to ISO string
 */
export function parseTimestamp(timestamp: string): Date {
  return new Date(timestamp)
}

/**
 * Format date to YYYY-MM-DD for database queries
 */
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

/**
 * Format datetime to ISO string for database
 */
export function formatDateTime(date: Date): string {
  return date.toISOString()
}
