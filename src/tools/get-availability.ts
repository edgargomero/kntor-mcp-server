/**
 * MCP Tool: get_availability
 *
 * Checks professional availability for appointment scheduling
 * Uses existing RPCs: get_professional_availability_on_date, get_available_professionals_on_date
 */

import { z } from 'zod'
import type { Env, MCPContext, ToolResult } from '../types'
import { createUserClient, validateJWT } from '../auth/jwt'
import { withMetering } from '../utils/metering'

/**
 * Input schema for get_availability tool
 */
export const GetAvailabilityInputSchema = z.object({
  jwt: z.string().describe('User JWT token for authentication'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format'),
  professional_id: z.string().uuid().optional().describe('Specific professional ID (optional)'),
  profession_type: z.string().optional().describe('Filter by profession type (e.g., psychologist, speech_therapist)')
})

export type GetAvailabilityInput = z.infer<typeof GetAvailabilityInputSchema>

/**
 * Day schedule structure from the database
 */
interface DaySchedule {
  slots: number
  full_day: boolean
  start_time?: string
  end_time?: string
}

/**
 * Result when checking specific professional availability
 */
interface ProfessionalAvailabilityResult {
  is_available: boolean
  availability_period_id: string | null
  start_date: string | null
  end_date: string | null
  available_days: string[] | null
  schedule: Record<string, DaySchedule> | null
  day_schedule: DaySchedule | null
  reason: string | null
  notes: string | null
}

/**
 * Result when listing available professionals
 */
interface AvailableProfessional {
  professional_id: string
  full_name: string
  rut: string
  profession_type: string
  professional_title: string | null
  phone: string | null
  availability_period_id: string
  available_days: string[]
  day_schedule: DaySchedule
  start_date: string
  end_date: string | null
}

/**
 * Tool definition for MCP
 */
export const getAvailabilityTool = {
  name: 'get_availability',
  description: `Check professional availability for a specific date.

If professional_id is provided: Returns detailed availability for that professional.
If professional_id is NOT provided: Returns list of all available professionals on that date.

Use profession_type to filter by specialty (e.g., 'psychologist', 'speech_therapist', 'occupational_therapist').`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      jwt: {
        type: 'string',
        description: 'User JWT token from Supabase authentication'
      },
      date: {
        type: 'string',
        description: 'Date to check availability (YYYY-MM-DD format)',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$'
      },
      professional_id: {
        type: 'string',
        description: 'UUID of specific professional to check (optional)'
      },
      profession_type: {
        type: 'string',
        description: 'Filter by profession type (optional)'
      }
    },
    required: ['jwt', 'date']
  }
}

/**
 * Execute the get_availability tool
 */
export async function executeGetAvailability(
  input: GetAvailabilityInput,
  context: MCPContext,
  env: Env
): Promise<ToolResult> {
  return withMetering(context, 'get_availability', env, async () => {
    // Validate JWT
    const jwtPayload = await validateJWT(input.jwt, env)
    if (!jwtPayload) {
      return {
        success: false,
        error: 'Invalid or expired JWT token'
      }
    }

    // Create user client (preserves auth.uid() for RBAC)
    const supabase = createUserClient(input.jwt, env)

    // Check if requesting specific professional or list
    if (input.professional_id) {
      // Get specific professional availability
      const { data, error } = await supabase.rpc<ProfessionalAvailabilityResult>(
        'get_professional_availability_on_date',
        {
          p_professional_id: input.professional_id,
          p_date: input.date
        }
      )

      if (error) {
        return {
          success: false,
          error: `Failed to check availability: ${error}`
        }
      }

      return {
        success: true,
        data: {
          type: 'single_professional',
          professional_id: input.professional_id,
          date: input.date,
          availability: data
        }
      }
    } else {
      // Get list of available professionals
      const { data, error } = await supabase.rpc<AvailableProfessional[]>(
        'get_available_professionals_on_date',
        {
          p_brand_id: context.brandId,
          p_date: input.date,
          p_profession_type: input.profession_type || null
        }
      )

      if (error) {
        return {
          success: false,
          error: `Failed to get available professionals: ${error}`
        }
      }

      return {
        success: true,
        data: {
          type: 'available_professionals',
          date: input.date,
          profession_type: input.profession_type || 'all',
          count: data?.length || 0,
          professionals: data || []
        }
      }
    }
  })
}
