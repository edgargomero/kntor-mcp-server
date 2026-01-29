/**
 * Get Brand Context Tool
 *
 * Returns the current brand context including industry type and available service types.
 * Useful for AI agents to understand what services they can create.
 */

import { z } from 'zod'
import type { Env, MCPContext, ToolResult, FieldSchema } from '../types'

// Input schema - no input required, returns context from API key
export const GetBrandContextInputSchema = z.object({}).strict()

export type GetBrandContextInput = z.infer<typeof GetBrandContextInputSchema>

/**
 * Tool definition for MCP
 */
export const getBrandContextTool = {
  name: 'get_brand_context',
  description: `Returns the current brand context including:
- Brand ID, name, and industry type (travel, legal, medical, education, other)
- Available service types with EXACT field schemas (types, formats, validation rules)
- Data collection guide specifying what data to collect per service

CRITICAL: The field_schemas define EXACT formats you MUST use:
- date fields: "YYYY-MM-DD" format (e.g., "2026-02-15")
- datetime fields: "ISO 8601" format (e.g., "2026-02-15T14:30:00")
- currency fields: integer in cents (e.g., 150000 for $1,500.00)
- phone fields: international format (e.g., "+56912345678")

Use this tool FIRST to understand what services and data formats are required.
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
    field_schemas?: Record<string, FieldSchema>
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
      optional_fields: st.optional_fields || [],
      field_schemas: st.field_schemas
    })
  }

  // Create detailed data collection guide with format specifications
  const dataCollectionGuide: Record<string, {
    name: string
    must_collect: Array<{
      field: string
      label: string
      type: string
      format?: string
      example?: string
    }>
    nice_to_have: Array<{
      field: string
      label: string
      type: string
      format?: string
      example?: string
    }>
  }> = {}

  for (const st of context.serviceTypes) {
    const schemas = st.field_schemas || {}

    const formatFieldInfo = (fieldName: string) => {
      const schema = schemas[fieldName]
      return {
        field: fieldName,
        label: schema?.label || fieldName,
        type: schema?.type || 'string',
        format: schema?.format,
        example: schema?.example
      }
    }

    dataCollectionGuide[st.code] = {
      name: st.name,
      must_collect: (st.required_fields || []).map(formatFieldInfo),
      nice_to_have: (st.optional_fields || []).map(formatFieldInfo)
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
        // Flat list with all details including field_schemas
        all: context.serviceTypes.map(st => ({
          code: st.code,
          name: st.name,
          category: st.category,
          required_fields: st.required_fields || [],
          optional_fields: st.optional_fields || [],
          field_schemas: st.field_schemas
        }))
      },
      // Guide for AI agent: what data to collect per service type with EXACT formats
      data_collection_guide: dataCollectionGuide,
      // Format reference for strict validation
      format_reference: {
        date: { format: "YYYY-MM-DD", example: "2026-02-15", description: "ISO date, stored as DATE in DB" },
        datetime: { format: "ISO 8601", example: "2026-02-15T14:30:00", description: "Full timestamp" },
        currency: { format: "integer (cents)", example: "150000 = $1,500.00", description: "Always in smallest unit" },
        phone: { format: "+XXXXXXXXXXX", example: "+56912345678", description: "International format with country code" },
        email: { format: "email", example: "juan@example.com", description: "Valid email address" },
        integer: { format: "number", example: "2", description: "Whole number, no decimals" }
      },
      hints: {
        expediente_tipo: `Use "${context.brandIndustryType}" (auto-assigned from brand)`,
        service_type_code: "MUST be one of the codes listed in service_types.all",
        data_collection: "Check data_collection_guide[service_code] for EXACT field formats",
        validation: "ALWAYS validate data against format_reference before sending to API"
      }
    }
  }
}
