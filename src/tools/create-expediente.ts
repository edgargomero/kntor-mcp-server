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
  description: z.string().max(2000).optional().describe('Detailed description of the expediente'),
  notes: z.string().max(1000).optional().describe('Internal notes')
})

export type CreateExpedienteInput = z.infer<typeof CreateExpedienteInputSchema>

/**
 * Tool definition for MCP
 */
export const createExpedienteTool = {
  name: 'create_expediente',
  description: `Create a new expediente (case file/business record) in the system.

An expediente tracks business activities and services for a customer (projects, contracts, service agreements, etc.).

REQUIRED FIELDS:
- expediente_nombre: Name/title (e.g., "Proyecto Marketing 2026")
- expediente_tipo: Type (proyecto, servicio, contrato, consulta, viaje, etc.)
- start_date: Start date in YYYY-MM-DD format

OPTIONAL FIELDS:
- customer_id: UUID of associated customer (use search_customers first to get ID)
- end_date: End date in YYYY-MM-DD format
- description: Detailed description
- notes: Internal notes

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
        description: 'Optional. UUID of the associated customer (use search_customers to find)'
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
        description: 'Optional. Detailed description of the expediente',
        maxLength: 2000
      },
      notes: {
        type: 'string',
        description: 'Optional. Internal notes',
        maxLength: 1000
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
      departure_city: '-',
      arrival_city: '-',
      total_seats: 1,
      available_seats: 1,
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
