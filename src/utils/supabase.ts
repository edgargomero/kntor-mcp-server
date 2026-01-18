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
 * Creates a user-authenticated client
 * Uses user's JWT to preserve RLS and auth.uid()
 */
export function createUserClient(env: Env, userJwt: string) {
  const baseHeaders = {
    'apikey': env.SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${userJwt}`
  }

  return {
    from: (table: string) => {
      let queryUrl = `${env.SUPABASE_URL}/rest/v1/${table}`
      const filters: string[] = []
      let selectColumns = '*'
      let orderBy: string | null = null
      let limitCount: number | null = null
      let isSingle = false

      const builder = {
        select: (columns = '*') => {
          selectColumns = columns
          return builder
        },
        eq: (column: string, value: unknown) => {
          filters.push(`${column}=eq.${encodeURIComponent(String(value))}`)
          return builder
        },
        or: (orFilter: string) => {
          filters.push(`or=(${orFilter})`)
          return builder
        },
        order: (column: string, options?: { ascending?: boolean }) => {
          orderBy = `${column}.${options?.ascending !== false ? 'asc' : 'desc'}`
          return builder
        },
        limit: (count: number) => {
          limitCount = count
          return builder
        },
        single: () => {
          isSingle = true
          limitCount = 1
          return builder
        },
        insert: async (data: Record<string, unknown> | Record<string, unknown>[]) => {
          try {
            const response = await fetch(queryUrl, {
              method: 'POST',
              headers: {
                ...baseHeaders,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
              },
              body: JSON.stringify(data)
            })
            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}))
              return { data: null, error: { message: errorData.message || response.statusText } }
            }
            const result = await response.json()
            return { data: result, error: null }
          } catch (error) {
            return { data: null, error: { message: error instanceof Error ? error.message : 'Unknown error' } }
          }
        },
        update: async (data: Record<string, unknown>) => {
          try {
            let url = `${queryUrl}?${filters.join('&')}`
            const response = await fetch(url, {
              method: 'PATCH',
              headers: {
                ...baseHeaders,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
              },
              body: JSON.stringify(data)
            })
            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}))
              return { data: null, error: { message: errorData.message || response.statusText } }
            }
            const result = await response.json()
            return { data: isSingle ? result[0] : result, error: null }
          } catch (error) {
            return { data: null, error: { message: error instanceof Error ? error.message : 'Unknown error' } }
          }
        },
        delete: async () => {
          try {
            let url = `${queryUrl}?${filters.join('&')}`
            const response = await fetch(url, {
              method: 'DELETE',
              headers: baseHeaders
            })
            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}))
              return { error: { message: errorData.message || response.statusText } }
            }
            return { error: null }
          } catch (error) {
            return { error: { message: error instanceof Error ? error.message : 'Unknown error' } }
          }
        },
        then: async (resolve: (value: { data: unknown; error: unknown; count?: number }) => void) => {
          try {
            let url = `${queryUrl}?select=${encodeURIComponent(selectColumns)}`
            if (filters.length > 0) {
              url += `&${filters.join('&')}`
            }
            if (orderBy) {
              url += `&order=${orderBy}`
            }
            if (limitCount) {
              url += `&limit=${limitCount}`
            }

            const response = await fetch(url, { headers: baseHeaders })
            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}))
              return resolve({ data: null, error: { message: errorData.message || response.statusText } })
            }
            const result = await response.json()
            return resolve({
              data: isSingle ? (result[0] || null) : result,
              error: null,
              count: Array.isArray(result) ? result.length : undefined
            })
          } catch (error) {
            return resolve({ data: null, error: { message: error instanceof Error ? error.message : 'Unknown error' } })
          }
        }
      }

      return builder
    }
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
