/**
 * MCP Tools Registry
 *
 * Central registry of all available MCP tools for Kntor.io ERP
 */

import type { Env, MCPContext, ToolResult } from '../types'

// Import tools
import {
  createCustomerTool,
  executeCreateCustomer,
  CreateCustomerInputSchema,
  type CreateCustomerInput
} from './create-customer'

import {
  searchCustomersTool,
  executeSearchCustomers,
  SearchCustomersInputSchema,
  type SearchCustomersInput
} from './search-customers'

import {
  createExpedienteTool,
  executeCreateExpediente,
  CreateExpedienteInputSchema,
  type CreateExpedienteInput
} from './create-expediente'

import {
  manageExpedienteServicesTool,
  executeManageExpedienteServices,
  ManageExpedienteServicesInputSchema,
  type ManageExpedienteServicesInput
} from './manage-expediente-services'

import {
  identifyCustomerTool,
  executeIdentifyCustomer,
  IdentifyCustomerInputSchema,
  type IdentifyCustomerInput
} from './identify-customer'

import {
  updateFunnelStageTool,
  executeUpdateFunnelStage,
  UpdateFunnelStageInputSchema,
  type UpdateFunnelStageInput
} from './update-funnel-stage'

/**
 * All available tools
 */
export const tools = [
  identifyCustomerTool,  // First - use this to check before creating
  createCustomerTool,
  updateFunnelStageTool, // Move customer in sales funnel
  searchCustomersTool,
  createExpedienteTool,
  manageExpedienteServicesTool
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
  identify_customer: async (input, context, env) => {
    const parsed = IdentifyCustomerInputSchema.parse(input)
    return executeIdentifyCustomer(parsed, context, env)
  },
  create_customer: async (input, context, env) => {
    const parsed = CreateCustomerInputSchema.parse(input)
    return executeCreateCustomer(parsed, context, env)
  },
  update_funnel_stage: async (input, context, env) => {
    const parsed = UpdateFunnelStageInputSchema.parse(input)
    return executeUpdateFunnelStage(parsed, context, env)
  },
  search_customers: async (input, context, env) => {
    const parsed = SearchCustomersInputSchema.parse(input)
    return executeSearchCustomers(parsed, context, env)
  },
  create_expediente: async (input, context, env) => {
    const parsed = CreateExpedienteInputSchema.parse(input)
    return executeCreateExpediente(parsed, context, env)
  },
  manage_expediente_services: async (input, context, env) => {
    const parsed = ManageExpedienteServicesInputSchema.parse(input)
    return executeManageExpedienteServices(parsed, context, env)
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
export type {
  IdentifyCustomerInput,
  CreateCustomerInput,
  UpdateFunnelStageInput,
  SearchCustomersInput,
  CreateExpedienteInput,
  ManageExpedienteServicesInput
}
