/**
 * Get Brand Context Tool
 *
 * Returns the current brand context including industry type and available service types.
 * Useful for AI agents to understand what services they can create.
 */

import { z } from 'zod'
import type { Env, MCPContext, ToolResult } from '../types'

// Input schema - no input required, returns context from API key
export const GetBrandContextInputSchema = z.object({}).strict()

export type GetBrandContextInput = z.infer<typeof GetBrandContextInputSchema>

/**
 * Tool definition for MCP
 */
export const getBrandContextTool = {
  name: 'get_brand_context',
  description: `Returns the current brand context including:
- Brand ID, name, and domain
- Industry type (travel, legal, medical, education, other)
- Available service types that can be used when creating expedientes

Use this tool to understand what services you can create for this brand.
No input parameters required - context comes from your API key.`,
  inputSchema: {
    type: 'object' as const,
    properties: {},
    required: [] as string[]
  }
}

/**
 * Execute the tool
 */
export async function executeGetBrandContext(
  _input: GetBrandContextInput,
  context: MCPContext,
  _env: Env
): Promise<ToolResult> {
  // Group service types by category for better readability
  const servicesByCategory: Record<string, Array<{ code: string; name: string; subcategory?: string | null }>> = {}

  for (const st of context.serviceTypes) {
    const category = st.category || 'other'
    if (!servicesByCategory[category]) {
      servicesByCategory[category] = []
    }
    servicesByCategory[category].push({
      code: st.code,
      name: st.name,
      subcategory: st.subcategory
    })
  }

  return {
    success: true,
    data: {
      brand: {
        id: context.brandId,
        name: context.brandName,
        industry_type: context.brandIndustryType
      },
      service_types: {
        total_count: context.serviceTypes.length,
        by_category: servicesByCategory,
        // Also provide flat list for easy reference
        all: context.serviceTypes.map(st => ({
          code: st.code,
          name: st.name,
          category: st.category
        }))
      },
      hint: `When creating expedientes for this brand, use expediente_tipo="${context.brandIndustryType}" and service_type_code from the available service types.`
    }
  }
}
