/**
 * Update Funnel Stage Tool
 *
 * Moves a customer to a different stage in the sales funnel by stage name.
 * Useful for AI agents to update customer status (e.g., "Lead" -> "Contactado")
 */

import { z } from 'zod'
import type { Env, MCPContext, ToolResult } from '../types'
import { logUsage } from '../utils/metering'

/**
 * Input schema for update_funnel_stage
 */
export const UpdateFunnelStageInputSchema = z.object({
  customer_id: z.string().uuid().describe('UUID of the customer to move'),
  stage_name: z.string().min(2).max(50).describe('Name of the target stage (e.g., "Contactado", "Calificado", "Propuesta")')
})

export type UpdateFunnelStageInput = z.infer<typeof UpdateFunnelStageInputSchema>

/**
 * Tool definition for MCP
 */
export const updateFunnelStageTool = {
  name: 'update_funnel_stage',
  description: `Move a customer to a different stage in the sales funnel.

USE CASE: After identifying or creating a customer, move them to reflect their current status in the sales process.

COMMON STAGES (in order):
- "Lead" - Initial contact, just entered the system
- "Contactado" - Customer has been contacted/responded
- "Calificado" - Customer need has been qualified
- "Propuesta" - Proposal sent
- "Negociacion" - In negotiation
- "Ganado" - Deal won (customer converted)
- "Perdido" - Deal lost

WORKFLOW EXAMPLE:
1. Customer writes via WhatsApp asking for a quote
2. Use identify_customer to find them (or create_customer if new)
3. Use update_funnel_stage to move to "Contactado" (they've made contact)
4. Create expediente with their request
5. Later, when sending proposal, move to "Propuesta"

PARAMETERS:
- customer_id: UUID of the customer (from identify_customer or create_customer)
- stage_name: Target stage name (case insensitive, e.g., "Contactado")

RETURNS:
- success: true/false
- old_stage: Previous stage name
- new_stage: New stage name
- customer_id: The customer UUID`,
  inputSchema: {
    type: 'object',
    properties: {
      customer_id: {
        type: 'string',
        format: 'uuid',
        description: 'REQUIRED. UUID of the customer to move'
      },
      stage_name: {
        type: 'string',
        description: 'REQUIRED. Target stage name (e.g., "Contactado", "Calificado")',
        minLength: 2,
        maxLength: 50
      }
    },
    required: ['customer_id', 'stage_name']
  }
}

/**
 * Execute the update_funnel_stage tool
 */
export async function executeUpdateFunnelStage(
  input: UpdateFunnelStageInput,
  context: MCPContext,
  env: Env
): Promise<ToolResult> {
  const startTime = Date.now()

  try {
    // Step 1: Get the customer's current funnel position
    const positionResponse = await fetch(
      `${env.SUPABASE_URL}/rest/v1/customer_funnel_positions?select=id,stage_id,funnel_id,funnel_stages(id,name)&customer_id=eq.${input.customer_id}&limit=1`,
      {
        headers: {
          'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
        }
      }
    )

    if (!positionResponse.ok) {
      const errorText = await positionResponse.text()
      console.error('[update_funnel_stage] Error fetching position:', errorText)
      return {
        success: false,
        error: `Failed to fetch customer funnel position: ${errorText}`
      }
    }

    const positionData = await positionResponse.json()

    // If customer not in funnel, we need to add them first
    if (!Array.isArray(positionData) || positionData.length === 0) {
      // Get default funnel for the brand
      const funnelResponse = await fetch(
        `${env.SUPABASE_URL}/rest/v1/sales_funnels?select=id&brand_id=eq.${context.brandId}&is_default=eq.true&is_active=eq.true&limit=1`,
        {
          headers: {
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
          }
        }
      )

      if (!funnelResponse.ok) {
        return {
          success: false,
          error: 'Customer not in funnel and no default funnel found'
        }
      }

      const funnelData = await funnelResponse.json()
      if (!Array.isArray(funnelData) || funnelData.length === 0) {
        return {
          success: false,
          error: 'No default funnel configured for this brand'
        }
      }

      const funnelId = funnelData[0].id

      // Get target stage by name
      const stageResponse = await fetch(
        `${env.SUPABASE_URL}/rest/v1/funnel_stages?select=id,name&funnel_id=eq.${funnelId}&name=ilike.${encodeURIComponent(input.stage_name)}&is_active=eq.true&limit=1`,
        {
          headers: {
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
          }
        }
      )

      if (!stageResponse.ok) {
        return {
          success: false,
          error: 'Failed to find target stage'
        }
      }

      const stageData = await stageResponse.json()
      if (!Array.isArray(stageData) || stageData.length === 0) {
        return {
          success: false,
          error: `Stage "${input.stage_name}" not found in funnel`
        }
      }

      const targetStageId = stageData[0].id
      const targetStageName = stageData[0].name

      // Add customer to funnel at target stage using RPC
      const addResponse = await fetch(
        `${env.SUPABASE_URL}/rest/v1/rpc/add_customer_to_funnel`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
          },
          body: JSON.stringify({
            p_customer_id: input.customer_id,
            p_funnel_id: funnelId,
            p_stage_id: targetStageId
          })
        }
      )

      if (!addResponse.ok) {
        const errorText = await addResponse.text()
        return {
          success: false,
          error: `Failed to add customer to funnel: ${errorText}`
        }
      }

      const addResult = await addResponse.json()

      // Log usage
      await logUsage({
        apiKeyId: context.apiKeyId,
        brandId: context.brandId,
        toolName: 'update_funnel_stage',
        userId: context.userId,
        success: true,
        durationMs: Date.now() - startTime,
        env
      })

      return {
        success: true,
        data: {
          message: `Customer added to funnel at stage "${targetStageName}"`,
          old_stage: null,
          new_stage: targetStageName,
          customer_id: input.customer_id,
          position_id: addResult.position_id
        }
      }
    }

    // Customer is in funnel - move them to new stage
    const currentPosition = positionData[0]
    const currentStageName = currentPosition.funnel_stages?.name || 'Unknown'
    const funnelId = currentPosition.funnel_id
    const positionId = currentPosition.id

    // Get target stage by name in the same funnel
    const stageResponse = await fetch(
      `${env.SUPABASE_URL}/rest/v1/funnel_stages?select=id,name&funnel_id=eq.${funnelId}&name=ilike.${encodeURIComponent(input.stage_name)}&is_active=eq.true&limit=1`,
      {
        headers: {
          'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
        }
      }
    )

    if (!stageResponse.ok) {
      return {
        success: false,
        error: 'Failed to find target stage'
      }
    }

    const stageData = await stageResponse.json()
    if (!Array.isArray(stageData) || stageData.length === 0) {
      return {
        success: false,
        error: `Stage "${input.stage_name}" not found in funnel`
      }
    }

    const targetStageId = stageData[0].id
    const targetStageName = stageData[0].name

    // Check if already in target stage
    if (currentPosition.stage_id === targetStageId) {
      return {
        success: true,
        data: {
          message: `Customer already in stage "${targetStageName}"`,
          old_stage: currentStageName,
          new_stage: targetStageName,
          customer_id: input.customer_id,
          no_change: true
        }
      }
    }

    // Move customer using RPC
    const moveResponse = await fetch(
      `${env.SUPABASE_URL}/rest/v1/rpc/move_customer_in_funnel`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({
          p_position_id: positionId,
          p_new_stage_id: targetStageId,
          p_new_position: 0,
          p_user_id: context.userId
        })
      }
    )

    if (!moveResponse.ok) {
      const errorText = await moveResponse.text()
      return {
        success: false,
        error: `Failed to move customer: ${errorText}`
      }
    }

    const moveResult = await moveResponse.json()

    if (!moveResult.success) {
      return {
        success: false,
        error: moveResult.error || 'Unknown error moving customer'
      }
    }

    // Log usage
    await logUsage({
      apiKeyId: context.apiKeyId,
      brandId: context.brandId,
      toolName: 'update_funnel_stage',
      userId: context.userId,
      success: true,
      durationMs: Date.now() - startTime,
      env
    })

    return {
      success: true,
      data: {
        message: `Customer moved from "${currentStageName}" to "${targetStageName}"`,
        old_stage: currentStageName,
        new_stage: targetStageName,
        customer_id: input.customer_id
      }
    }
  } catch (error) {
    console.error('[update_funnel_stage] Error:', error)

    // Log failed usage
    await logUsage({
      apiKeyId: context.apiKeyId,
      brandId: context.brandId,
      toolName: 'update_funnel_stage',
      userId: context.userId,
      success: false,
      durationMs: Date.now() - startTime,
      env
    })

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error updating funnel stage'
    }
  }
}
