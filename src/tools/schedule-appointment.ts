/**
 * MCP Tool: schedule_appointment
 *
 * Schedules a new appointment in the system
 * Creates entry in reservo_appointments table (synced with Reservo.cl)
 */

import { z } from 'zod'
import type { Env, MCPContext, ToolResult } from '../types'
import { createUserClient, validateJWT } from '../auth/jwt'
import { withMetering } from '../utils/metering'
import { createServiceClient } from '../utils/supabase'

/**
 * Input schema for schedule_appointment tool
 */
export const ScheduleAppointmentInputSchema = z.object({
  jwt: z.string().describe('User JWT token for authentication'),
  patient_id: z.string().uuid().describe('Patient UUID'),
  professional_id: z.string().uuid().describe('Professional UUID'),
  service_id: z.string().uuid().optional().describe('Service/treatment UUID (optional)'),
  appointment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM format'),
  duration_minutes: z.number().min(15).max(480).default(60).describe('Duration in minutes (15-480)'),
  notes: z.string().max(500).optional().describe('Appointment notes')
})

export type ScheduleAppointmentInput = z.infer<typeof ScheduleAppointmentInputSchema>

/**
 * Tool definition for MCP
 */
export const scheduleAppointmentTool = {
  name: 'schedule_appointment',
  description: `Schedule a new appointment for a patient with a professional.

Before scheduling, you should:
1. Use get_availability to verify the professional is available on the requested date/time
2. Confirm the patient exists in the system

The appointment will be created in 'scheduled' status.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      jwt: {
        type: 'string',
        description: 'User JWT token from Supabase authentication'
      },
      patient_id: {
        type: 'string',
        description: 'UUID of the patient'
      },
      professional_id: {
        type: 'string',
        description: 'UUID of the professional'
      },
      service_id: {
        type: 'string',
        description: 'UUID of the service/treatment (optional)'
      },
      appointment_date: {
        type: 'string',
        description: 'Appointment date (YYYY-MM-DD format)',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$'
      },
      start_time: {
        type: 'string',
        description: 'Start time (HH:MM format, 24-hour)',
        pattern: '^\\d{2}:\\d{2}$'
      },
      duration_minutes: {
        type: 'integer',
        description: 'Appointment duration in minutes (default: 60)',
        minimum: 15,
        maximum: 480
      },
      notes: {
        type: 'string',
        description: 'Optional appointment notes',
        maxLength: 500
      }
    },
    required: ['jwt', 'patient_id', 'professional_id', 'appointment_date', 'start_time']
  }
}

/**
 * Calculate end time from start time and duration
 */
function calculateEndTime(startTime: string, durationMinutes: number): string {
  const [hours, minutes] = startTime.split(':').map(Number)
  const totalMinutes = hours * 60 + minutes + durationMinutes
  const endHours = Math.floor(totalMinutes / 60) % 24
  const endMinutes = totalMinutes % 60
  return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`
}

/**
 * Execute the schedule_appointment tool
 */
export async function executeScheduleAppointment(
  input: ScheduleAppointmentInput,
  context: MCPContext,
  env: Env
): Promise<ToolResult> {
  return withMetering(context, 'schedule_appointment', env, async () => {
    // Validate JWT
    const jwtPayload = await validateJWT(input.jwt, env)
    if (!jwtPayload) {
      return {
        success: false,
        error: 'Invalid or expired JWT token'
      }
    }

    // Create user client for RBAC-protected operations
    const userClient = createUserClient(input.jwt, env)
    const serviceClient = createServiceClient(env)

    // 1. Verify professional exists and belongs to brand
    const { data: professionals, error: profError } = await userClient.from('pie_professionals').select(
      'id,full_name,profession_type',
      {
        eq: [
          { column: 'id', value: input.professional_id },
          { column: 'brand_id', value: context.brandId }
        ],
        limit: 1
      }
    )

    if (profError || !professionals || professionals.length === 0) {
      return {
        success: false,
        error: 'Professional not found or access denied'
      }
    }

    const professional = professionals[0] as { id: string; full_name: string; profession_type: string }

    // 2. Check professional availability on the date
    const { data: availability, error: availError } = await userClient.rpc<{
      is_available: boolean
      day_schedule: { slots: number } | null
    }>(
      'get_professional_availability_on_date',
      {
        p_professional_id: input.professional_id,
        p_date: input.appointment_date
      }
    )

    if (availError) {
      return {
        success: false,
        error: `Failed to check availability: ${availError}`
      }
    }

    if (!availability?.is_available) {
      return {
        success: false,
        error: `Professional ${professional.full_name} is not available on ${input.appointment_date}`
      }
    }

    // 3. Check for conflicting appointments (same professional, same time)
    const endTime = calculateEndTime(input.start_time, input.duration_minutes || 60)

    // Query existing appointments using service client to check conflicts
    const conflictCheckResponse = await fetch(
      `${env.SUPABASE_URL}/rest/v1/reservo_appointments?` +
        `professional_id=eq.${input.professional_id}&` +
        `appointment_date=eq.${input.appointment_date}&` +
        `start_time=lt.${endTime}&` +
        `end_time=gt.${input.start_time}&` +
        `status=neq.cancelled&` +
        `select=id,start_time,end_time`,
      {
        headers: {
          'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
        }
      }
    )

    if (conflictCheckResponse.ok) {
      const conflicts = await conflictCheckResponse.json()
      if (conflicts && conflicts.length > 0) {
        return {
          success: false,
          error: `Time slot conflict: Professional already has an appointment from ${conflicts[0].start_time} to ${conflicts[0].end_time}`
        }
      }
    }

    // 4. Create the appointment
    const appointmentId = crypto.randomUUID()
    const appointmentData = {
      id: appointmentId,
      brand_id: context.brandId,
      patient_id: input.patient_id,
      professional_id: input.professional_id,
      service_id: input.service_id || null,
      appointment_date: input.appointment_date,
      start_time: input.start_time,
      end_time: endTime,
      duration_minutes: input.duration_minutes || 60,
      status: 'scheduled',
      notes: input.notes || null,
      source: 'mcp_api',
      created_by: jwtPayload.sub,
      created_at: new Date().toISOString()
    }

    const { data: newAppointment, error: createError } = await serviceClient
      .from('reservo_appointments')
      .insert(appointmentData)

    if (createError) {
      // If table doesn't exist or other error, try alternative
      console.error('Failed to create appointment:', createError)
      return {
        success: false,
        error: `Failed to create appointment: ${createError}`
      }
    }

    // 5. Log activity (fire and forget)
    try {
      await serviceClient.rpc('log_activity', {
        p_brand_id: context.brandId,
        p_user_id: jwtPayload.sub,
        p_entity_type: 'appointment',
        p_entity_id: appointmentId,
        p_activity_type: 'created',
        p_title: 'Appointment scheduled via MCP API',
        p_metadata: {
          professional_name: professional.full_name,
          date: input.appointment_date,
          time: input.start_time,
          duration: input.duration_minutes || 60,
          source: 'mcp_api'
        }
      })
    } catch {
      // Activity logging is non-critical
      console.warn('Failed to log activity')
    }

    return {
      success: true,
      data: {
        appointment_id: appointmentId,
        professional: {
          id: professional.id,
          name: professional.full_name,
          type: professional.profession_type
        },
        patient_id: input.patient_id,
        date: input.appointment_date,
        start_time: input.start_time,
        end_time: endTime,
        duration_minutes: input.duration_minutes || 60,
        status: 'scheduled',
        message: `Appointment scheduled successfully for ${input.appointment_date} at ${input.start_time}`
      }
    }
  })
}
