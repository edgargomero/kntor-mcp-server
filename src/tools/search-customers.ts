/**
 * Search Customers Tool
 *
 * Searches for customers in the Kntor.io ERP by various criteria
 */

import { z } from 'zod'
import type { Env, MCPContext, ToolResult } from '../types'
import { logUsage } from '../utils/metering'

/**
 * Input schema for search_customers
 */
export const SearchCustomersInputSchema = z.object({
  query: z.string().min(2).max(100).optional().describe('Search query (searches name, email, phone, RUT)'),
  customer_type: z.enum(['individual', 'company']).optional().describe('Filter by customer type'),
  status: z.enum(['active', 'inactive', 'lead', 'prospect']).optional().describe('Filter by status'),
  limit: z.number().min(1).max(50).default(20).optional().describe('Maximum results to return (default: 20)')
})

export type SearchCustomersInput = z.infer<typeof SearchCustomersInputSchema>

/**
 * Tool definition for MCP
 */
export const searchCustomersTool = {
  name: 'search_customers',
  description: `Search for customers (clients) in the system.

You can search by:
- Name (first_name, last_name, company_name)
- Email
- Phone number
- RUT (Chilean tax ID)
- Customer code

Optionally filter by customer_type or status.
Authentication is handled via API key - no JWT required.`,
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query - searches across name, email, phone, RUT, and customer code',
        minLength: 2,
        maxLength: 100
      },
      customer_type: {
        type: 'string',
        enum: ['individual', 'company'],
        description: 'Filter by customer type'
      },
      status: {
        type: 'string',
        enum: ['active', 'inactive', 'lead', 'prospect'],
        description: 'Filter by customer status'
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of results (default: 20, max: 50)',
        minimum: 1,
        maximum: 50
      }
    },
    required: []
  }
}

/**
 * Execute the search_customers tool
 */
export async function executeSearchCustomers(
  input: SearchCustomersInput,
  context: MCPContext,
  env: Env
): Promise<ToolResult> {
  const startTime = Date.now()

  try {
    // Build URL parameters for search
    const columns = 'id,customer_code,customer_type,first_name,last_name,company_name,email,phone,rut,status,customer_category,total_orders,total_sales,last_order_date,created_at'
    let url = `${env.SUPABASE_URL}/rest/v1/customers?select=${columns}`

    // Always filter by brand_id for isolation
    url += `&brand_id=eq.${context.brandId}`

    // Apply search query if provided (using or filter)
    if (input.query) {
      const searchTerm = encodeURIComponent(input.query)
      url += `&or=(first_name.ilike.*${searchTerm}*,last_name.ilike.*${searchTerm}*,company_name.ilike.*${searchTerm}*,email.ilike.*${searchTerm}*,phone.ilike.*${searchTerm}*,rut.ilike.*${searchTerm}*,customer_code.ilike.*${searchTerm}*)`
    }

    // Apply filters
    if (input.customer_type) {
      url += `&customer_type=eq.${input.customer_type}`
    }
    if (input.status) {
      url += `&status=eq.${input.status}`
    }

    // Add ordering and limit
    url += `&order=created_at.desc`
    url += `&limit=${input.limit || 20}`

    const response = await fetch(url, {
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[search_customers] Database error:', errorText)
      return {
        success: false,
        error: `Failed to search customers: ${errorText}`
      }
    }

    const data = await response.json()

    // Format results for better readability
    const formattedCustomers = (data || []).map((customer: Record<string, unknown>) => ({
      id: customer.id,
      customer_code: customer.customer_code,
      type: customer.customer_type,
      name: customer.customer_type === 'company'
        ? customer.company_name
        : `${customer.first_name || ''} ${customer.last_name || ''}`.trim(),
      email: customer.email,
      phone: customer.phone,
      rut: customer.rut,
      status: customer.status,
      category: customer.customer_category,
      stats: {
        total_orders: customer.total_orders || 0,
        total_sales: customer.total_sales || 0,
        last_order: customer.last_order_date
      }
    }))

    // Log usage
    await logUsage({
      apiKeyId: context.apiKeyId,
      brandId: context.brandId,
      toolName: 'search_customers',
      userId: context.userId,
      success: true,
      durationMs: Date.now() - startTime,
      env
    })

    return {
      success: true,
      data: {
        count: formattedCustomers.length,
        customers: formattedCustomers
      }
    }
  } catch (error) {
    console.error('[search_customers] Error:', error)

    // Log failed usage
    await logUsage({
      apiKeyId: context.apiKeyId,
      brandId: context.brandId,
      toolName: 'search_customers',
      userId: context.userId,
      success: false,
      durationMs: Date.now() - startTime,
      env
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error searching customers'
    }
  }
}
