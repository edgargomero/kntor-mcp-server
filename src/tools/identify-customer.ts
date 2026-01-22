/**
 * Identify Customer Tool
 *
 * Identifies a customer by phone number, email, or RUT
 * Used by AI agents to prevent duplicate customer creation
 */

import { z } from 'zod'
import type { Env, MCPContext, ToolResult } from '../types'
import { logUsage } from '../utils/metering'

/**
 * Input schema for identify_customer
 */
export const IdentifyCustomerInputSchema = z.object({
  phone: z.string().min(8).max(20).optional().describe('Phone number to search (with or without country code)'),
  email: z.string().email().optional().describe('Email address to search'),
  rut: z.string().optional().describe('Chilean RUT/tax ID to search')
})

export type IdentifyCustomerInput = z.infer<typeof IdentifyCustomerInputSchema>

/**
 * Tool definition for MCP
 */
export const identifyCustomerTool = {
  name: 'identify_customer',
  description: `Identify an existing customer by phone, email, or RUT.

IMPORTANT: Use this tool BEFORE creating a new customer to prevent duplicates.

USE CASES:
- WhatsApp bot receives a message → identify by phone number
- Email inquiry received → identify by email
- Customer provides RUT → identify by RUT

PARAMETERS (at least one required):
- phone: Phone number (searches with partial match, ignores formatting)
- email: Email address (exact match, case insensitive)
- rut: Chilean RUT/tax ID (searches with partial match)

RETURNS:
- found: true/false - whether a customer was found
- customer: Customer data if found (id, name, email, phone, etc.)
- message: Human-readable result message

WORKFLOW EXAMPLE:
1. Customer writes via WhatsApp from +56912345678
2. Call identify_customer with phone="+56912345678"
3. If found=true → use the existing customer_id
4. If found=false → safe to create new customer with create_customer

TIP: For phone numbers, the search is flexible - it will match:
- "+56912345678"
- "56912345678"
- "912345678"
- "9 1234 5678"`,
  inputSchema: {
    type: 'object',
    properties: {
      phone: {
        type: 'string',
        description: 'Phone number to search. Flexible matching - works with or without country code, spaces, dashes',
        minLength: 8,
        maxLength: 20
      },
      email: {
        type: 'string',
        format: 'email',
        description: 'Email address to search (case insensitive)'
      },
      rut: {
        type: 'string',
        description: 'Chilean RUT/tax ID to search (e.g., "12.345.678-9" or "12345678-9")'
      }
    },
    required: []
  }
}

/**
 * Normalize phone number for flexible matching
 * Removes spaces, dashes, parentheses, and optionally leading +
 */
function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-\(\)\+]/g, '')
}

/**
 * Execute the identify_customer tool
 */
export async function executeIdentifyCustomer(
  input: IdentifyCustomerInput,
  context: MCPContext,
  env: Env
): Promise<ToolResult> {
  const startTime = Date.now()

  try {
    // Validate at least one search parameter is provided
    if (!input.phone && !input.email && !input.rut) {
      return {
        success: false,
        error: 'At least one search parameter required: phone, email, or rut'
      }
    }

    // Build search conditions
    const conditions: string[] = []

    if (input.phone) {
      // Normalize phone for flexible matching
      const normalizedPhone = normalizePhone(input.phone)
      // Search for phone containing the normalized digits (handles different formats)
      // Also try with common country codes removed
      const phoneVariants = [
        normalizedPhone,
        normalizedPhone.replace(/^56/, ''), // Remove Chile code
        normalizedPhone.replace(/^1/, ''),  // Remove US code
      ].filter(p => p.length >= 8)

      const phoneConditions = phoneVariants.map(p => `phone.ilike.*${p}*`).join(',')
      conditions.push(`or(${phoneConditions})`)
    }

    if (input.email) {
      conditions.push(`email.ilike.${encodeURIComponent(input.email)}`)
    }

    if (input.rut) {
      // Normalize RUT (remove dots and spaces)
      const normalizedRut = input.rut.replace(/[\.\s]/g, '')
      conditions.push(`rut.ilike.*${encodeURIComponent(normalizedRut)}*`)
    }

    // Build URL - search with OR logic across all provided parameters
    const columns = 'id,customer_code,customer_type,first_name,last_name,company_name,email,phone,rut,status,customer_category,total_orders,total_sales,last_order_date,created_at'
    let url = `${env.SUPABASE_URL}/rest/v1/customers?select=${columns}`
    url += `&brand_id=eq.${context.brandId}`

    // If multiple conditions, use OR logic
    if (conditions.length > 1) {
      url += `&or=(${conditions.join(',')})`
    } else if (conditions.length === 1) {
      // Single condition - handle differently based on type
      if (input.phone) {
        const normalizedPhone = normalizePhone(input.phone)
        const phoneVariants = [
          normalizedPhone,
          normalizedPhone.replace(/^56/, ''),
          normalizedPhone.replace(/^1/, ''),
        ].filter(p => p.length >= 8)
        const phoneConditions = phoneVariants.map(p => `phone.ilike.*${p}*`).join(',')
        url += `&or=(${phoneConditions})`
      } else if (input.email) {
        url += `&email=ilike.${encodeURIComponent(input.email)}`
      } else if (input.rut) {
        const normalizedRut = input.rut.replace(/[\.\s]/g, '')
        url += `&rut=ilike.*${encodeURIComponent(normalizedRut)}*`
      }
    }

    // Limit to first match, ordered by most recently active
    url += `&order=last_order_date.desc.nullslast,created_at.desc`
    url += `&limit=1`

    const response = await fetch(url, {
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[identify_customer] Database error:', errorText)
      return {
        success: false,
        error: `Failed to search customer: ${errorText}`
      }
    }

    const data = await response.json()
    const customer = Array.isArray(data) && data.length > 0 ? data[0] : null

    // Log usage
    await logUsage({
      apiKeyId: context.apiKeyId,
      brandId: context.brandId,
      toolName: 'identify_customer',
      userId: context.userId,
      success: true,
      durationMs: Date.now() - startTime,
      env
    })

    if (customer) {
      // Customer found
      const customerName = customer.customer_type === 'company'
        ? customer.company_name
        : `${customer.first_name || ''} ${customer.last_name || ''}`.trim()

      return {
        success: true,
        data: {
          found: true,
          message: `Customer found: ${customerName} (${customer.customer_code})`,
          customer: {
            id: customer.id,
            customer_code: customer.customer_code,
            type: customer.customer_type,
            name: customerName,
            first_name: customer.first_name,
            last_name: customer.last_name,
            company_name: customer.company_name,
            email: customer.email,
            phone: customer.phone,
            rut: customer.rut,
            status: customer.status,
            category: customer.customer_category,
            stats: {
              total_orders: customer.total_orders || 0,
              total_sales: customer.total_sales || 0,
              last_order: customer.last_order_date
            },
            created_at: customer.created_at
          },
          action_hint: 'Use the customer.id for creating expedientes or other operations'
        }
      }
    } else {
      // Customer not found
      const searchedBy = [
        input.phone ? `phone: ${input.phone}` : null,
        input.email ? `email: ${input.email}` : null,
        input.rut ? `rut: ${input.rut}` : null
      ].filter(Boolean).join(', ')

      return {
        success: true,
        data: {
          found: false,
          message: `No customer found with ${searchedBy}`,
          customer: null,
          action_hint: 'You can safely create a new customer using create_customer tool'
        }
      }
    }
  } catch (error) {
    console.error('[identify_customer] Error:', error)

    // Log failed usage
    await logUsage({
      apiKeyId: context.apiKeyId,
      brandId: context.brandId,
      toolName: 'identify_customer',
      userId: context.userId,
      success: false,
      durationMs: Date.now() - startTime,
      env
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error identifying customer'
    }
  }
}
