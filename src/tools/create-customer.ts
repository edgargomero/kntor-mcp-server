/**
 * Create Customer Tool
 *
 * Creates a new customer in the Kntor.io ERP
 */

import { z } from 'zod'
import type { Env, MCPContext, ToolResult } from '../types'
import { logUsage } from '../utils/metering'

/**
 * Input schema for create_customer
 */
export const CreateCustomerInputSchema = z.object({
  customer_type: z.enum(['individual', 'company']).describe('Type of customer'),
  first_name: z.string().min(1).max(100).optional().describe('First name (required for individuals)'),
  last_name: z.string().min(1).max(100).optional().describe('Last name (required for individuals)'),
  company_name: z.string().min(1).max(200).optional().describe('Company name (required for companies)'),
  email: z.string().email().optional().describe('Email address'),
  phone: z.string().min(8).max(20).optional().describe('Phone number'),
  rut: z.string().max(20).optional().describe('Chilean RUT/tax ID'),
  tax_id: z.string().max(50).optional().describe('Tax identification number'),
  notes: z.string().max(1000).optional().describe('MANDATORY for AI agents. Always save customer needs, requirements, and conversation summary here. Never leave empty.')
})

export type CreateCustomerInput = z.infer<typeof CreateCustomerInputSchema>

/**
 * Tool definition for MCP
 */
export const createCustomerTool = {
  name: 'create_customer',
  description: `Create a new customer (client) in the system. The customer is automatically added to the sales funnel at the "Lead" stage.

IMPORTANT: After creating a customer, you should create an expediente (case file) with the customer's needs using create_expediente with the returned customer ID.

REQUIRED FIELDS by customer_type:
- If customer_type="individual": MUST provide first_name AND last_name
- If customer_type="company": MUST provide company_name

MANDATORY FOR AI AGENTS:
- notes: You MUST fill this field with a summary of the customer's needs, requirements, and conversation context. NEVER leave empty.

OPTIONAL FIELDS:
- email: Email address
- phone: Phone number (min 8 chars)
- rut: Chilean RUT/tax ID (e.g., "12.345.678-9")
- tax_id: Tax identification number

Returns the created customer with their unique customer_code, ID (use for create_expediente), and funnel information.`,
  inputSchema: {
    type: 'object',
    properties: {
      customer_type: {
        type: 'string',
        enum: ['individual', 'company'],
        description: 'REQUIRED. Type of customer: "individual" for persons, "company" for businesses'
      },
      first_name: {
        type: 'string',
        description: 'REQUIRED for individual. Person\'s first name',
        maxLength: 100
      },
      last_name: {
        type: 'string',
        description: 'REQUIRED for individual. Person\'s last name',
        maxLength: 100
      },
      company_name: {
        type: 'string',
        description: 'REQUIRED for company. Business/company name',
        maxLength: 200
      },
      email: {
        type: 'string',
        format: 'email',
        description: 'Optional. Contact email address'
      },
      phone: {
        type: 'string',
        description: 'Optional. Phone number (8-20 characters)'
      },
      rut: {
        type: 'string',
        description: 'Optional. Chilean RUT/tax ID (e.g., "12.345.678-9")'
      },
      tax_id: {
        type: 'string',
        description: 'Optional. Tax identification number for other countries'
      },
      notes: {
        type: 'string',
        description: 'MANDATORY for AI agents. You MUST save the customer needs, requirements, and conversation summary here. Include what services they need, their situation, and relevant details. NEVER leave this empty when using AI to create customers.',
        maxLength: 1000
      }
    },
    required: ['customer_type']
  }
}

/**
 * Generate a unique customer code
 */
function generateCustomerCode(customerType: string): string {
  const prefix = customerType === 'company' ? 'EMP' : 'CLI'
  const timestamp = Date.now().toString(36).toUpperCase()
  const random = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `${prefix}-${timestamp}-${random}`
}

/**
 * Execute the create_customer tool
 */
export async function executeCreateCustomer(
  input: CreateCustomerInput,
  context: MCPContext,
  env: Env
): Promise<ToolResult> {
  const startTime = Date.now()

  try {
    // Validate required fields based on customer type
    if (input.customer_type === 'individual') {
      if (!input.first_name || !input.last_name) {
        return {
          success: false,
          error: 'first_name and last_name are required for individual customers'
        }
      }
    } else if (input.customer_type === 'company') {
      if (!input.company_name) {
        return {
          success: false,
          error: 'company_name is required for company customers'
        }
      }
    }

    // Generate unique customer code
    const customerCode = generateCustomerCode(input.customer_type)

    // Prepare customer data (brand_id ensures isolation, created_by for audit)
    const customerData = {
      customer_code: customerCode,
      customer_type: input.customer_type,
      first_name: input.first_name || null,
      last_name: input.last_name || null,
      company_name: input.company_name || null,
      email: input.email || null,
      phone: input.phone || null,
      rut: input.rut || null,
      tax_id: input.tax_id || null,
      notes: input.notes || null,
      brand_id: context.brandId,
      created_by: context.userId,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    // Insert customer using REST API directly
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/customers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(customerData)
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[create_customer] Database error:', errorText)
      return {
        success: false,
        error: `Failed to create customer: ${errorText}`
      }
    }

    const result = await response.json()
    const data = Array.isArray(result) ? result[0] : result

    // Add customer to default funnel at Lead stage
    let funnelInfo: { added: boolean; stage?: string; funnel_name?: string; error?: string } = { added: false }

    try {
      // 1. Get default funnel for this brand
      const funnelRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/sales_funnels?brand_id=eq.${context.brandId}&is_default=eq.true&select=id,name&limit=1`,
        {
          headers: {
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
          }
        }
      )

      if (funnelRes.ok) {
        const funnels = await funnelRes.json()
        if (funnels && funnels.length > 0) {
          const funnel = funnels[0]

          // 2. Get first stage (Lead) of the funnel - position=0
          const stageRes = await fetch(
            `${env.SUPABASE_URL}/rest/v1/funnel_stages?funnel_id=eq.${funnel.id}&position=eq.0&select=id,name&limit=1`,
            {
              headers: {
                'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
              }
            }
          )

          if (stageRes.ok) {
            const stages = await stageRes.json()
            if (stages && stages.length > 0) {
              const leadStage = stages[0]

              // 3. Call RPC to add customer to funnel
              const rpcRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/add_customer_to_funnel`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                  'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
                },
                body: JSON.stringify({
                  p_customer_id: data.id,
                  p_funnel_id: funnel.id,
                  p_stage_id: leadStage.id,
                  p_deal_value: null,
                  p_expected_close_date: null,
                  p_notes: input.notes || null
                })
              })

              if (rpcRes.ok) {
                funnelInfo = {
                  added: true,
                  stage: leadStage.name,
                  funnel_name: funnel.name
                }
              } else {
                const rpcError = await rpcRes.text()
                console.error('[create_customer] Failed to add to funnel:', rpcError)
                funnelInfo = { added: false, error: 'Failed to add to funnel' }
              }
            }
          }
        }
      }
    } catch (funnelError) {
      console.error('[create_customer] Funnel integration error:', funnelError)
      funnelInfo = { added: false, error: 'Funnel integration error' }
    }

    // Log usage
    await logUsage({
      apiKeyId: context.apiKeyId,
      brandId: context.brandId,
      toolName: 'create_customer',
      userId: context.userId,
      success: true,
      durationMs: Date.now() - startTime,
      env
    })

    return {
      success: true,
      data: {
        message: 'Customer created successfully',
        customer: data,
        funnel: funnelInfo
      }
    }
  } catch (error) {
    console.error('[create_customer] Error:', error)

    // Log failed usage
    await logUsage({
      apiKeyId: context.apiKeyId,
      brandId: context.brandId,
      toolName: 'create_customer',
      userId: context.userId,
      success: false,
      durationMs: Date.now() - startTime,
      env
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error creating customer'
    }
  }
}
