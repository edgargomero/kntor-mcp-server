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
  description: `Identify an existing customer by phone, email, or RUT. Returns full context including funnel stage and open expedientes.

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
- customer: Customer data if found (id, name, email, phone, status, etc.)
- funnel: Current sales funnel stage (stage_name, stage_type, days_in_stage, deal_value)
- expedientes: List of open/active expedientes for this customer
- message: Human-readable result message

FUNNEL STAGES indicate where the customer is in the sales process:
- Lead → Contactado → Calificado → Propuesta → Negociación → Ganado/Perdido
- stage_type: "normal" (in progress), "won" (converted), "lost" (not converted)

Use this context to personalize your conversation:
- New lead: Focus on understanding their needs
- In proposal stage: They're evaluating, answer questions about services
- Won customer: They're a client, focus on service delivery
- Has open expedientes: Reference their existing cases

WORKFLOW EXAMPLE:
1. Customer writes via WhatsApp from +56912345678
2. Call identify_customer with phone="+56912345678"
3. If found=true → greet by name, check funnel stage and expedientes
4. If found=false → safe to create new customer with create_customer`,
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

      // Fetch funnel position and expedientes in parallel
      const [funnelResponse, expedientesResponse] = await Promise.all([
        // Get funnel position
        fetch(`${env.SUPABASE_URL}/rest/v1/customer_funnel_positions?select=id,deal_value,entered_stage_at,expected_close_date,notes,funnel_id,stage_id,funnel_stages(id,name,stage_type,color,position),sales_funnels(id,name)&customer_id=eq.${customer.id}&limit=1`, {
          headers: {
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
          }
        }),
        // Get open expedientes
        fetch(`${env.SUPABASE_URL}/rest/v1/expedientes?select=id,expediente_codigo,expediente_nombre,expediente_tipo,expediente_estado,departure_date,description,notes&customer_id=eq.${customer.id}&expediente_estado=in.(activo,pendiente,en_progreso)&order=created_at.desc&limit=5`, {
          headers: {
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
          }
        })
      ])

      // Parse funnel data
      let funnelContext = null
      if (funnelResponse.ok) {
        const funnelData = await funnelResponse.json()
        if (Array.isArray(funnelData) && funnelData.length > 0) {
          const position = funnelData[0]
          const stage = position.funnel_stages
          const funnel = position.sales_funnels
          const daysInStage = position.entered_stage_at
            ? Math.floor((Date.now() - new Date(position.entered_stage_at).getTime()) / (1000 * 60 * 60 * 24))
            : 0

          funnelContext = {
            funnel_name: funnel?.name || null,
            stage_name: stage?.name || null,
            stage_type: stage?.stage_type || 'normal',
            stage_color: stage?.color || null,
            stage_position: stage?.position || null,
            deal_value: position.deal_value,
            days_in_stage: daysInStage,
            entered_stage_at: position.entered_stage_at,
            expected_close_date: position.expected_close_date,
            notes: position.notes
          }
        }
      }

      // Parse expedientes data
      let openExpedientes: Array<{
        id: string
        codigo: string
        nombre: string
        tipo: string
        estado: string
        fecha_inicio: string
        descripcion: string | null
      }> = []
      if (expedientesResponse.ok) {
        const expedientesData = await expedientesResponse.json()
        if (Array.isArray(expedientesData)) {
          openExpedientes = expedientesData.map(exp => ({
            id: exp.id,
            codigo: exp.expediente_codigo,
            nombre: exp.expediente_nombre,
            tipo: exp.expediente_tipo,
            estado: exp.expediente_estado,
            fecha_inicio: exp.departure_date,
            descripcion: exp.description
          }))
        }
      }

      // Build action hint based on context
      let actionHint = 'Use the customer.id for creating expedientes or other operations'
      if (funnelContext) {
        if (funnelContext.stage_type === 'won') {
          actionHint = 'This is an active customer (won). Focus on service delivery and satisfaction.'
        } else if (funnelContext.stage_type === 'lost') {
          actionHint = 'This customer was lost previously. Be welcoming if they return.'
        } else if (funnelContext.stage_name) {
          actionHint = `Customer is in "${funnelContext.stage_name}" stage (${funnelContext.days_in_stage} days). Continue the sales process.`
        }
      }
      if (openExpedientes.length > 0) {
        actionHint += ` Has ${openExpedientes.length} open expediente(s) - check if inquiry relates to existing case.`
      }

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
          funnel: funnelContext,
          expedientes: openExpedientes,
          action_hint: actionHint
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
