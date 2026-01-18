/**
 * Manage Expediente Services Tool
 *
 * Add, update, or list services within an expediente
 */

import { z } from 'zod'
import type { Env, MCPContext, ToolResult } from '../types'
import { logUsage } from '../utils/metering'

/**
 * Input schema for manage_expediente_services
 */
export const ManageExpedienteServicesInputSchema = z.object({
  action: z.enum(['list', 'add', 'update', 'remove', 'list_types']).describe('Action to perform'),
  expediente_id: z.string().uuid().optional().describe('UUID of the expediente (required for list/add/update/remove)'),
  service_id: z.string().uuid().optional().describe('UUID of the service (required for update/remove)'),
  // Fields for add/update
  service_type_id: z.string().uuid().optional().describe('UUID of the service type (use list_types to get available types)'),
  service_name: z.string().min(1).max(200).optional().describe('Name of the service'),
  service_description: z.string().max(1000).optional().describe('Description of the service'),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Service start date (YYYY-MM-DD)'),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Service end date (YYYY-MM-DD)'),
  unit_price: z.number().min(0).optional().describe('Price per unit'),
  quantity: z.number().min(1).optional().describe('Quantity (default: 1)'),
  provider_name: z.string().max(200).optional().describe('Service provider name'),
  confirmation_number: z.string().max(100).optional().describe('Booking confirmation number')
})

export type ManageExpedienteServicesInput = z.infer<typeof ManageExpedienteServicesInputSchema>

/**
 * Tool definition for MCP
 */
export const manageExpedienteServicesTool = {
  name: 'manage_expediente_services',
  description: `Manage services within an expediente (case file).

ACTIONS AND REQUIRED FIELDS:

1. action="list_types" - Get available service types for this brand
   Required: (none)
   Returns: Array of {id, code, name, description}
   TIP: Call this FIRST to know valid service_type_id values

2. action="list" - List all services in an expediente
   Required: expediente_id
   Returns: Array of services with totals

3. action="add" - Add a new service
   Required: expediente_id, service_name
   Optional: service_type_id, service_description, start_date, end_date,
             unit_price, quantity, provider_name, confirmation_number

4. action="update" - Update an existing service
   Required: service_id
   Optional: Any field you want to change

5. action="remove" - Remove a service
   Required: service_id

PRICING: If unit_price and quantity are provided, subtotal/total are calculated automatically.

WORKFLOW EXAMPLE:
1. Call with action="list_types" to see available service types
2. Call with action="add", expediente_id="...", service_name="Hotel 3 noches", unit_price=50000, quantity=3
3. Call with action="list", expediente_id="..." to verify`,
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list_types', 'list', 'add', 'update', 'remove'],
        description: 'REQUIRED. Action: list_types, list, add, update, or remove'
      },
      expediente_id: {
        type: 'string',
        format: 'uuid',
        description: 'Required for list/add. UUID of the expediente'
      },
      service_id: {
        type: 'string',
        format: 'uuid',
        description: 'Required for update/remove. UUID of the service'
      },
      service_type_id: {
        type: 'string',
        format: 'uuid',
        description: 'Optional. UUID from list_types action'
      },
      service_name: {
        type: 'string',
        description: 'Required for add. Name of the service (e.g., "Hotel Marriott 3 noches")',
        maxLength: 200
      },
      service_description: {
        type: 'string',
        description: 'Optional. Detailed description',
        maxLength: 1000
      },
      start_date: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Optional. Service start date (YYYY-MM-DD)'
      },
      end_date: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Optional. Service end date (YYYY-MM-DD)'
      },
      unit_price: {
        type: 'number',
        description: 'Optional. Price per unit (e.g., 50000)',
        minimum: 0
      },
      quantity: {
        type: 'integer',
        description: 'Optional. Quantity (default: 1)',
        minimum: 1
      },
      provider_name: {
        type: 'string',
        description: 'Optional. Provider/vendor name',
        maxLength: 200
      },
      confirmation_number: {
        type: 'string',
        description: 'Optional. Booking/reservation confirmation number',
        maxLength: 100
      }
    },
    required: ['action']
  }
}

/**
 * Helper to make REST API calls
 */
interface RestResponse<T = unknown> {
  data: T | null
  error: string | null
}

async function restFetch<T>(
  env: Env,
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
    body?: Record<string, unknown>
  } = {}
): Promise<RestResponse<T>> {
  const { method = 'GET', body } = options
  const headers: Record<string, string> = {
    'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
  }

  if (body) {
    headers['Content-Type'] = 'application/json'
    headers['Prefer'] = 'return=representation'
  }

  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    })

    if (!response.ok) {
      const errorText = await response.text()
      return { data: null, error: errorText }
    }

    if (method === 'DELETE') {
      return { data: null, error: null }
    }

    const data = await response.json()
    return { data, error: null }
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * List available service types for the brand
 */
async function listServiceTypes(
  env: Env,
  brandId: string
): Promise<ToolResult> {
  const path = `service_types?select=id,code,name,description,is_active&brand_id=eq.${brandId}&is_active=eq.true&order=sort_order.asc`
  const { data, error } = await restFetch<Record<string, unknown>[]>(env, path)

  if (error) {
    return {
      success: false,
      error: `Failed to list service types: ${error}`
    }
  }

  return {
    success: true,
    data: {
      count: (data || []).length,
      service_types: data || []
    }
  }
}

/**
 * List services in an expediente
 */
async function listServices(
  env: Env,
  expedienteId: string,
  brandId: string
): Promise<ToolResult> {
  const columns = 'id,service_name,service_description,start_date,end_date,unit_price,quantity,subtotal,total,provider_name,confirmation_number,service_status,sort_order,created_at'
  const path = `expediente_servicios?select=${columns}&expediente_id=eq.${expedienteId}&brand_id=eq.${brandId}&order=sort_order.asc`
  const { data, error } = await restFetch<Record<string, unknown>[]>(env, path)

  if (error) {
    return {
      success: false,
      error: `Failed to list services: ${error}`
    }
  }

  // Calculate totals
  const totalAmount = (data || []).reduce((sum, svc) => sum + (Number(svc.total) || 0), 0)

  return {
    success: true,
    data: {
      count: (data || []).length,
      total_amount: totalAmount,
      services: data || []
    }
  }
}

/**
 * Add a service to an expediente
 */
async function addService(
  env: Env,
  input: ManageExpedienteServicesInput,
  brandId: string,
  userId: string
): Promise<ToolResult> {
  if (!input.service_name) {
    return {
      success: false,
      error: 'service_name is required for adding a service'
    }
  }

  const quantity = input.quantity || 1
  const unitPrice = input.unit_price || 0
  const subtotal = unitPrice * quantity
  const total = subtotal

  // Get next sort order
  const sortPath = `expediente_servicios?select=sort_order&expediente_id=eq.${input.expediente_id}&order=sort_order.desc&limit=1`
  const { data: existingServices } = await restFetch<Record<string, unknown>[]>(env, sortPath)

  const nextSortOrder = existingServices && existingServices.length > 0
    ? (Number(existingServices[0].sort_order) || 0) + 1
    : 1

  const serviceData = {
    brand_id: brandId,
    expediente_id: input.expediente_id,
    service_type_id: input.service_type_id || null,
    service_name: input.service_name,
    service_description: input.service_description || null,
    start_date: input.start_date || null,
    end_date: input.end_date || null,
    unit_price: unitPrice,
    quantity: quantity,
    subtotal: subtotal,
    total: total,
    provider_name: input.provider_name || null,
    confirmation_number: input.confirmation_number || null,
    service_status: 'pending',
    sort_order: nextSortOrder,
    created_by: userId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }

  const { data, error } = await restFetch<Record<string, unknown>[]>(env, 'expediente_servicios', {
    method: 'POST',
    body: serviceData
  })

  if (error) {
    return {
      success: false,
      error: `Failed to add service: ${error}`
    }
  }

  return {
    success: true,
    data: {
      message: 'Service added successfully',
      service: Array.isArray(data) ? data[0] : data
    }
  }
}

/**
 * Update a service
 */
async function updateService(
  env: Env,
  input: ManageExpedienteServicesInput,
  brandId: string
): Promise<ToolResult> {
  if (!input.service_id) {
    return {
      success: false,
      error: 'service_id is required for updating a service'
    }
  }

  // Build update object with only provided fields
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  }

  if (input.service_name !== undefined) updateData.service_name = input.service_name
  if (input.service_description !== undefined) updateData.service_description = input.service_description
  if (input.start_date !== undefined) updateData.start_date = input.start_date
  if (input.end_date !== undefined) updateData.end_date = input.end_date
  if (input.provider_name !== undefined) updateData.provider_name = input.provider_name
  if (input.confirmation_number !== undefined) updateData.confirmation_number = input.confirmation_number

  // Recalculate totals if price or quantity changed
  if (input.unit_price !== undefined || input.quantity !== undefined) {
    // Get current values
    const currentPath = `expediente_servicios?select=unit_price,quantity&id=eq.${input.service_id}&limit=1`
    const { data: currentData } = await restFetch<Record<string, unknown>[]>(env, currentPath)
    const current = currentData?.[0]

    const unitPrice = input.unit_price ?? Number(current?.unit_price) ?? 0
    const quantity = input.quantity ?? Number(current?.quantity) ?? 1
    const subtotal = unitPrice * quantity

    updateData.unit_price = unitPrice
    updateData.quantity = quantity
    updateData.subtotal = subtotal
    updateData.total = subtotal
  }

  const updatePath = `expediente_servicios?id=eq.${input.service_id}&brand_id=eq.${brandId}`
  const { data, error } = await restFetch<Record<string, unknown>[]>(env, updatePath, {
    method: 'PATCH',
    body: updateData
  })

  if (error) {
    return {
      success: false,
      error: `Failed to update service: ${error}`
    }
  }

  return {
    success: true,
    data: {
      message: 'Service updated successfully',
      service: Array.isArray(data) ? data[0] : data
    }
  }
}

/**
 * Remove a service
 */
async function removeService(
  env: Env,
  serviceId: string,
  brandId: string
): Promise<ToolResult> {
  const deletePath = `expediente_servicios?id=eq.${serviceId}&brand_id=eq.${brandId}`
  const { error } = await restFetch(env, deletePath, { method: 'DELETE' })

  if (error) {
    return {
      success: false,
      error: `Failed to remove service: ${error}`
    }
  }

  return {
    success: true,
    data: {
      message: 'Service removed successfully',
      service_id: serviceId
    }
  }
}

/**
 * Execute the manage_expediente_services tool
 */
export async function executeManageExpedienteServices(
  input: ManageExpedienteServicesInput,
  context: MCPContext,
  env: Env
): Promise<ToolResult> {
  const startTime = Date.now()

  try {
    let result: ToolResult

    switch (input.action) {
      case 'list_types':
        result = await listServiceTypes(env, context.brandId)
        break
      case 'list':
        if (!input.expediente_id) {
          result = { success: false, error: 'expediente_id is required for list action' }
        } else {
          result = await listServices(env, input.expediente_id, context.brandId)
        }
        break
      case 'add':
        if (!input.expediente_id) {
          result = { success: false, error: 'expediente_id is required for add action' }
        } else {
          result = await addService(env, input, context.brandId, context.userId)
        }
        break
      case 'update':
        result = await updateService(env, input, context.brandId)
        break
      case 'remove':
        if (!input.service_id) {
          result = {
            success: false,
            error: 'service_id is required for removing a service'
          }
        } else {
          result = await removeService(env, input.service_id, context.brandId)
        }
        break
      default:
        result = {
          success: false,
          error: `Unknown action: ${input.action}`
        }
    }

    // Log usage
    await logUsage({
      apiKeyId: context.apiKeyId,
      brandId: context.brandId,
      toolName: 'manage_expediente_services',
      userId: context.userId,
      success: result.success,
      durationMs: Date.now() - startTime,
      env
    })

    return result
  } catch (error) {
    console.error('[manage_expediente_services] Error:', error)

    // Log failed usage
    await logUsage({
      apiKeyId: context.apiKeyId,
      brandId: context.brandId,
      toolName: 'manage_expediente_services',
      userId: context.userId,
      success: false,
      durationMs: Date.now() - startTime,
      env
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error managing services'
    }
  }
}
