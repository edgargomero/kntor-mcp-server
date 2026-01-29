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
  // Group service types by category with full field info
  const servicesByCategory: Record<string, Array<{
    code: string
    name: string
    subcategory?: string | null
    required_fields: string[]
    optional_fields: string[]
  }>> = {}

  for (const st of context.serviceTypes) {
    const category = st.category || 'other'
    if (!servicesByCategory[category]) {
      servicesByCategory[category] = []
    }
    servicesByCategory[category].push({
      code: st.code,
      name: st.name,
      subcategory: st.subcategory,
      required_fields: st.required_fields || [],
      optional_fields: st.optional_fields || []
    })
  }

  // Create a quick reference for data collection per service
  const dataCollectionGuide: Record<string, {
    name: string
    must_collect: string[]
    nice_to_have: string[]
  }> = {}

  for (const st of context.serviceTypes) {
    dataCollectionGuide[st.code] = {
      name: st.name,
      must_collect: st.required_fields || [],
      nice_to_have: st.optional_fields || []
    }
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
        // Flat list with all details
        all: context.serviceTypes.map(st => ({
          code: st.code,
          name: st.name,
          category: st.category,
          required_fields: st.required_fields || [],
          optional_fields: st.optional_fields || []
        }))
      },
      // Guide for AI agent: what data to collect per service type
      data_collection_guide: dataCollectionGuide,
      hints: {
        expediente_tipo: `Use "${context.brandIndustryType}" (auto-assigned from brand)`,
        service_type_code: "MUST be one of the codes listed in service_types.all",
        data_collection: "Check data_collection_guide[service_code] to know what fields to ask the customer"
      }
    }
  }
}
