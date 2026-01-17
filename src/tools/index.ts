/**
 * MCP Tools Registry
 *
 * Central registry of all available MCP tools
 */

import type { Env, MCPContext, ToolResult } from '../types'

// Import tools
import {
  getAvailabilityTool,
  executeGetAvailability,
  GetAvailabilityInputSchema,
  type GetAvailabilityInput
} from './get-availability'

import {
  scheduleAppointmentTool,
  executeScheduleAppointment,
  ScheduleAppointmentInputSchema,
  type ScheduleAppointmentInput
} from './schedule-appointment'

/**
 * All available tools
 */
export const tools = [
  getAvailabilityTool,
  scheduleAppointmentTool
]

/**
 * Tool executor type
 */
type ToolExecutor = (
  input: unknown,
  context: MCPContext,
  env: Env
) => Promise<ToolResult>

/**
 * Map of tool names to their executors
 */
const toolExecutors: Record<string, ToolExecutor> = {
  get_availability: async (input, context, env) => {
    const parsed = GetAvailabilityInputSchema.parse(input)
    return executeGetAvailability(parsed, context, env)
  },
  schedule_appointment: async (input, context, env) => {
    const parsed = ScheduleAppointmentInputSchema.parse(input)
    return executeScheduleAppointment(parsed, context, env)
  }
}

/**
 * Execute a tool by name
 */
export async function executeTool(
  toolName: string,
  input: unknown,
  context: MCPContext,
  env: Env
): Promise<ToolResult> {
  const executor = toolExecutors[toolName]

  if (!executor) {
    return {
      success: false,
      error: `Unknown tool: ${toolName}. Available tools: ${Object.keys(toolExecutors).join(', ')}`
    }
  }

  try {
    return await executor(input, context, env)
  } catch (error) {
    // Handle Zod validation errors
    if (error instanceof Error && error.name === 'ZodError') {
      return {
        success: false,
        error: `Invalid input: ${error.message}`
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }
  }
}

// Re-export types
export type { GetAvailabilityInput, ScheduleAppointmentInput }
