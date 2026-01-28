/**
 * Create Expediente Tool
 *
 * Creates a new expediente (case file/business record) in the Kntor.io ERP
 */

import { z } from 'zod'
import type { Env, MCPContext, ToolResult } from '../types'
import { logUsage } from '../utils/metering'

/**
 * Input schema for create_expediente
 */
export const CreateExpedienteInputSchema = z.object({
  expediente_nombre: z.string().min(3).max(200).describe('Name/title of the expediente'),
  expediente_tipo: z.string().min(2).max(50).describe('Type of expediente (e.g., proyecto, servicio, contrato)'),
  customer_id: z.string().uuid().optional().describe('UUID of the associated customer'),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Start date (YYYY-MM-DD)'),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('End date (YYYY-MM-DD)'),
  description: z.string().max(2000).optional().describe('MANDATORY for AI agents. You MUST include the complete customer need description here. This is the primary record - never leave empty.'),
  notes: z.string().max(1000).optional().describe('Internal notes for follow-up'),
  arrival_city: z.string().max(100).optional().describe('Destination city (e.g., "Punta Cana", "Cancún")'),
  departure_city: z.string().max(100).optional().describe('Origin city (e.g., "Santiago", "Lima")'),
  total_seats: z.number().int().min(1).max(100).optional().describe('Number of passengers')
})

export type CreateExpedienteInput = z.infer<typeof CreateExpedienteInputSchema>

/**
 * Tool definition for MCP
 */
export const createExpedienteTool = {
  name: 'create_expediente',
  description: `Create a new expediente (case file/business record) in the system.

An expediente tracks business activities and services for a customer (projects, contracts, service agreements, etc.).

WORKFLOW: After creating a customer with create_customer, use the returned customer ID to create an expediente that describes their specific need or request.

REQUIRED FIELDS:
- expediente_nombre: Name/title describing the need (e.g., "Consulta Tributaria", "Proyecto Marketing 2026")
- expediente_tipo: Type (proyecto, servicio, contrato, consulta, viaje, tramite, etc.)
- start_date: Start date in YYYY-MM-DD format (use today's date if not specified)

MANDATORY FOR AI AGENTS:
- customer_id: UUID of associated customer (returned by create_customer or search_customers)
- description: You MUST fill this with the complete customer need description. Include the full context, requirements, urgency, and all details gathered. NEVER leave empty.

OPTIONAL FIELDS:
- notes: Internal notes for follow-up

Returns the created expediente with its unique code (e.g., "PRO-2601-ABC123").`,
  inputSchema: {
    type: 'object',
    properties: {
      expediente_nombre: {
        type: 'string',
        description: 'REQUIRED. Name/title of the expediente',
        minLength: 3,
        maxLength: 200
      },
      expediente_tipo: {
        type: 'string',
        description: 'REQUIRED. Type: proyecto, servicio, contrato, consulta, viaje, etc.'
      },
      customer_id: {
        type: 'string',
        format: 'uuid',
        description: 'RECOMMENDED. UUID of the associated customer (returned by create_customer or search_customers). Always link expedientes to customers.'
      },
      start_date: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'REQUIRED. Start date in YYYY-MM-DD format (e.g., "2026-01-18")'
      },
      end_date: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Optional. End date in YYYY-MM-DD format'
      },
      description: {
        type: 'string',
        description: 'MANDATORY for AI agents. You MUST include the complete customer need description here. Include their specific request, requirements, context, urgency, and all details gathered. This is the primary record - NEVER leave empty.',
        maxLength: 2000
      },
      notes: {
        type: 'string',
        description: 'Internal notes for follow-up actions or observations',
        maxLength: 1000
      },
      arrival_city: {
        type: 'string',
        description: 'IMPORTANT for travel. Destination city/location (e.g., "Punta Cana", "Cancún")',
        maxLength: 100
      },
      departure_city: {
        type: 'string',
        description: 'Optional. Origin city/location (e.g., "Santiago", "Lima")',
        maxLength: 100
      },
      total_seats: {
        type: 'integer',
        description: 'IMPORTANT for travel. Number of passengers (adults + children + infants)',
        minimum: 1,
        maximum: 100
      }
    },
    required: ['expediente_nombre', 'expediente_tipo', 'start_date']
  }
}

/**
 * Generate a unique expediente code
 */
function generateExpedienteCode(tipo: string): string {
  const prefix = tipo.substring(0, 3).toUpperCase()
  const year = new Date().getFullYear().toString().slice(-2)
  const month = (new Date().getMonth() + 1).toString().padStart(2, '0')
  const random = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `${prefix}-${year}${month}-${random}`
}

/**
 * Calculate duration in days
 */
function calculateDuration(startDate: string, endDate?: string): number {
  if (!endDate) return 0
  const start = new Date(startDate)
  const end = new Date(endDate)
  const diffTime = Math.abs(end.getTime() - start.getTime())
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1
}

/**
 * Execute the create_expediente tool
 */
export async function executeCreateExpediente(
  input: CreateExpedienteInput,
  context: MCPContext,
  env: Env
): Promise<ToolResult> {
  const startTime = Date.now()

  try {
    // Validate dates
    const startDate = new Date(input.start_date)
    if (isNaN(startDate.getTime())) {
      return {
        success: false,
        error: 'Invalid start_date format. Use YYYY-MM-DD'
      }
    }

    if (input.end_date) {
      const endDate = new Date(input.end_date)
      if (isNaN(endDate.getTime())) {
        return {
          success: false,
          error: 'Invalid end_date format. Use YYYY-MM-DD'
        }
      }
      if (endDate < startDate) {
        return {
          success: false,
          error: 'end_date cannot be before start_date'
        }
      }
    }

    // Generate unique expediente code
    const expedienteCodigo = generateExpedienteCode(input.expediente_tipo)
    const durationDays = calculateDuration(input.start_date, input.end_date)

    // Prepare expediente data (using departure_date for DB compatibility)
    const expedienteData = {
      expediente_codigo: expedienteCodigo,
      expediente_nombre: input.expediente_nombre,
      expediente_tipo: input.expediente_tipo,
      expediente_estado: 'activo',
      customer_id: input.customer_id || null,
      departure_date: input.start_date,
      return_date: input.end_date || null,
      duration_days: durationDays,
      departure_city: input.departure_city || '-',
      arrival_city: input.arrival_city || '-',
      total_seats: input.total_seats || 1,
      available_seats: input.total_seats || 1,
      description: input.description || null,
      notes: input.notes || null,
      brand_id: context.brandId,
      created_by: context.userId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    // Insert expediente using REST API
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/expedientes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(expedienteData)
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[create_expediente] Database error:', errorText)
      return {
        success: false,
        error: `Failed to create expediente: ${errorText}`
      }
    }

    const result = await response.json()
    const data = Array.isArray(result) ? result[0] : result

    // Log usage
    await logUsage({
      apiKeyId: context.apiKeyId,
      brandId: context.brandId,
      toolName: 'create_expediente',
      userId: context.userId,
      success: true,
      durationMs: Date.now() - startTime,
      env
    })

    return {
      success: true,
      data: {
        message: 'Expediente created successfully',
        expediente: {
          id: data.id,
          codigo: data.expediente_codigo,
          nombre: data.expediente_nombre,
          tipo: data.expediente_tipo,
          estado: data.expediente_estado,
          customer_id: data.customer_id,
          start_date: data.departure_date,
          end_date: data.return_date,
          duration_days: data.duration_days,
          arrival_city: data.arrival_city,
          departure_city: data.departure_city,
          total_seats: data.total_seats,
          description: data.description,
          created_at: data.created_at
        }
      }
    }
  } catch (error) {
    console.error('[create_expediente] Error:', error)

    // Log failed usage
    await logUsage({
      apiKeyId: context.apiKeyId,
      brandId: context.brandId,
      toolName: 'create_expediente',
      userId: context.userId,
      success: false,
      durationMs: Date.now() - startTime,
      env
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error creating expediente'
    }
  }
}
