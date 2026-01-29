/**
 * Create Expediente Tool (Enhanced)
 *
 * Creates a new expediente with optional initial service and beneficiaries.
 * Auto-detects expediente_tipo from brand's industry_type.
 */

import { z } from 'zod'
import type { Env, MCPContext, ToolResult } from '../types'
import { logUsage } from '../utils/metering'

/**
 * Beneficiary schema
 */
const BeneficiarioSchema = z.object({
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  document_type: z.enum(['dni', 'passport', 'rut', 'other']).optional().default('dni'),
  document_number: z.string().min(1).max(50),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  nationality: z.string().max(50).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(50).optional()
})

/**
 * Service data schema (flexible for different service types)
 */
const ServiceDataSchema = z.object({
  service_name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  unit_price: z.number().min(0).optional(),
  quantity: z.number().int().min(1).optional(),
  provider_name: z.string().max(200).optional(),
  confirmation_number: z.string().max(100).optional(),
  // Travel-specific fields
  departure_city: z.string().max(100).optional(),
  arrival_city: z.string().max(100).optional(),
  flight_number: z.string().max(20).optional(),
  airline: z.string().max(100).optional(),
  // Hotel-specific fields
  hotel_name: z.string().max(200).optional(),
  room_type: z.string().max(100).optional(),
  nights: z.number().int().min(1).optional()
}).optional()

/**
 * Input schema for create_expediente
 */
export const CreateExpedienteInputSchema = z.object({
  expediente_nombre: z.string().min(3).max(200).describe('Name/title of the expediente'),
  customer_id: z.string().uuid().optional().describe('UUID of the associated customer'),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Start date (YYYY-MM-DD)'),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('End date (YYYY-MM-DD)'),
  description: z.string().max(2000).optional().describe('Complete description of the customer need'),
  notes: z.string().max(1000).optional().describe('Internal notes'),
  // Service creation
  service_type_code: z.string().max(50).optional().describe('Service type code (e.g., "vuelo", "hotel", "asesoria")'),
  service_data: ServiceDataSchema.describe('Service-specific data'),
  // Beneficiaries
  beneficiarios: z.array(BeneficiarioSchema).optional().describe('Array of beneficiaries to add')
})

export type CreateExpedienteInput = z.infer<typeof CreateExpedienteInputSchema>

/**
 * Tool definition for MCP
 */
export const createExpedienteTool = {
  name: 'create_expediente',
  description: `Create a new expediente (case file) with optional service and beneficiaries.

The system automatically detects the expediente type from the brand's industry (travel, legal, medical, education, other).

REQUIRED FIELDS:
- expediente_nombre: Descriptive name (e.g., "Viaje Rio Febrero 2026", "Asesoría Tributaria")
- customer_id: UUID of the customer (from identify_customer or create_customer)
- start_date: Start date in YYYY-MM-DD format
- description: IMPORTANT - Full description of the customer's need

OPTIONAL - CREATE SERVICE:
- service_type_code: Code of the service type (call manage_expediente_services with action="list_types" first to see available codes)
- service_data: Object with service details:
  - service_name: Name of this specific service
  - start_date, end_date: Service dates
  - unit_price, quantity: Pricing
  - Travel: departure_city, arrival_city, flight_number, airline
  - Hotel: hotel_name, room_type, nights
  - provider_name, confirmation_number

OPTIONAL - ADD BENEFICIARIES:
- beneficiarios: Array of people involved:
  - first_name, last_name (required)
  - document_type: "dni", "passport", "rut", "other"
  - document_number (required)
  - birth_date, nationality, email, phone

EXAMPLE:
{
  "expediente_nombre": "Viaje Rio de Janeiro Feb 2026",
  "customer_id": "uuid-here",
  "start_date": "2026-02-01",
  "end_date": "2026-02-15",
  "description": "Viaje familiar a Rio. 2 adultos, vuelo + hotel todo incluido.",
  "service_type_code": "vuelo",
  "service_data": {
    "service_name": "Vuelo Santiago - Rio ida y vuelta",
    "departure_city": "Santiago",
    "arrival_city": "Rio de Janeiro",
    "unit_price": 450000,
    "quantity": 2
  },
  "beneficiarios": [
    {"first_name": "Juan", "last_name": "Pérez", "document_number": "12345678-9"},
    {"first_name": "María", "last_name": "González", "document_number": "98765432-1"}
  ]
}`,
  inputSchema: {
    type: 'object',
    properties: {
      expediente_nombre: {
        type: 'string',
        description: 'REQUIRED. Descriptive name of the expediente',
        minLength: 3,
        maxLength: 200
      },
      customer_id: {
        type: 'string',
        format: 'uuid',
        description: 'REQUIRED. UUID of the customer'
      },
      start_date: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'REQUIRED. Start date (YYYY-MM-DD)'
      },
      end_date: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'Optional. End date (YYYY-MM-DD)'
      },
      description: {
        type: 'string',
        description: 'IMPORTANT. Full description of customer need',
        maxLength: 2000
      },
      notes: {
        type: 'string',
        description: 'Internal notes',
        maxLength: 1000
      },
      service_type_code: {
        type: 'string',
        description: 'Optional. Service type code to create initial service'
      },
      service_data: {
        type: 'object',
        description: 'Optional. Service details (name, dates, pricing, etc.)',
        properties: {
          service_name: { type: 'string' },
          description: { type: 'string' },
          start_date: { type: 'string' },
          end_date: { type: 'string' },
          unit_price: { type: 'number' },
          quantity: { type: 'integer' },
          provider_name: { type: 'string' },
          confirmation_number: { type: 'string' },
          departure_city: { type: 'string' },
          arrival_city: { type: 'string' },
          flight_number: { type: 'string' },
          airline: { type: 'string' },
          hotel_name: { type: 'string' },
          room_type: { type: 'string' },
          nights: { type: 'integer' }
        }
      },
      beneficiarios: {
        type: 'array',
        description: 'Optional. Array of beneficiaries',
        items: {
          type: 'object',
          properties: {
            first_name: { type: 'string' },
            last_name: { type: 'string' },
            document_type: { type: 'string', enum: ['dni', 'passport', 'rut', 'other'] },
            document_number: { type: 'string' },
            birth_date: { type: 'string' },
            nationality: { type: 'string' },
            email: { type: 'string' },
            phone: { type: 'string' }
          },
          required: ['first_name', 'last_name', 'document_number']
        }
      }
    },
    required: ['expediente_nombre', 'start_date']
  }
}

/**
 * Generate a unique expediente code
 */
function generateExpedienteCode(tipo: string): string {
  const prefixMap: Record<string, string> = {
    travel: 'VIA',
    legal: 'LEG',
    medical: 'MED',
    education: 'EDU',
    other: 'EXP'
  }
  const prefix = prefixMap[tipo] || 'EXP'
  const year = new Date().getFullYear().toString().slice(-2)
  const month = (new Date().getMonth() + 1).toString().padStart(2, '0')
  const random = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `${prefix}-${year}${month}-${random}`
}

/**
 * Fetch brand's industry type
 */
async function getBrandIndustryType(brandId: string, env: Env): Promise<string> {
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/brands?select=industry_type&id=eq.${brandId}&limit=1`,
    {
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
      }
    }
  )

  if (!response.ok) {
    console.error('[create_expediente] Failed to fetch brand:', await response.text())
    return 'other'
  }

  const data = await response.json() as Array<{ industry_type?: string }>
  return data?.[0]?.industry_type || 'other'
}

/**
 * Find service type by code
 */
async function findServiceTypeByCode(
  brandId: string,
  code: string,
  env: Env
): Promise<{ id: string; name: string } | null> {
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/service_types?select=id,name&brand_id=eq.${brandId}&code=eq.${code}&is_active=eq.true&limit=1`,
    {
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
      }
    }
  )

  if (!response.ok) return null

  const data = await response.json() as Array<{ id: string; name: string }>
  return data?.[0] || null
}

/**
 * Create or find beneficiary
 */
async function createOrFindBeneficiary(
  brandId: string,
  beneficiary: z.infer<typeof BeneficiarioSchema>,
  userId: string,
  env: Env
): Promise<{ id: string; created: boolean } | null> {
  // First, try to find existing by document_number
  const findResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/beneficiarios?select=id&brand_id=eq.${brandId}&document_number=eq.${encodeURIComponent(beneficiary.document_number)}&limit=1`,
    {
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
      }
    }
  )

  if (findResponse.ok) {
    const existing = await findResponse.json() as Array<{ id: string }>
    if (existing?.[0]?.id) {
      return { id: existing[0].id, created: false }
    }
  }

  // Create new beneficiary
  const createResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/beneficiarios`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        brand_id: brandId,
        first_name: beneficiary.first_name,
        last_name: beneficiary.last_name,
        document_type: beneficiary.document_type || 'dni',
        document_number: beneficiary.document_number,
        birth_date: beneficiary.birth_date || null,
        nationality: beneficiary.nationality || null,
        email: beneficiary.email || null,
        phone: beneficiary.phone || null,
        created_by: userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    }
  )

  if (!createResponse.ok) {
    console.error('[create_expediente] Failed to create beneficiary:', await createResponse.text())
    return null
  }

  const created = await createResponse.json() as Array<{ id: string }> | { id: string }
  return { id: Array.isArray(created) ? created[0].id : created.id, created: true }
}

/**
 * Link beneficiary to expediente
 */
async function linkBeneficiaryToExpediente(
  brandId: string,
  expedienteId: string,
  beneficiaryId: string,
  userId: string,
  env: Env
): Promise<boolean> {
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/expediente_beneficiarios`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        brand_id: brandId,
        expediente_id: expedienteId,
        beneficiario_id: beneficiaryId,
        passenger_status: 'pending',
        payment_status: 'pending',
        unit_price: 0,
        paid_amount: 0,
        created_by: userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    }
  )

  return response.ok
}

/**
 * Create service in expediente
 */
async function createService(
  brandId: string,
  expedienteId: string,
  serviceTypeId: string | null,
  serviceData: z.infer<typeof ServiceDataSchema>,
  userId: string,
  env: Env
): Promise<{ id: string } | null> {
  const quantity = serviceData?.quantity || 1
  const unitPrice = serviceData?.unit_price || 0
  const subtotal = unitPrice * quantity

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/expediente_servicios`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        brand_id: brandId,
        expediente_id: expedienteId,
        service_type_id: serviceTypeId,
        service_name: serviceData?.service_name || 'Servicio',
        service_description: serviceData?.description || null,
        start_date: serviceData?.start_date || null,
        end_date: serviceData?.end_date || null,
        unit_price: unitPrice,
        quantity: quantity,
        subtotal: subtotal,
        total: subtotal,
        provider_name: serviceData?.provider_name || null,
        confirmation_number: serviceData?.confirmation_number || null,
        service_status: 'pending',
        sort_order: 1,
        // Store extra data in metadata if needed
        metadata: {
          departure_city: serviceData?.departure_city,
          arrival_city: serviceData?.arrival_city,
          flight_number: serviceData?.flight_number,
          airline: serviceData?.airline,
          hotel_name: serviceData?.hotel_name,
          room_type: serviceData?.room_type,
          nights: serviceData?.nights
        },
        created_by: userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    }
  )

  if (!response.ok) {
    console.error('[create_expediente] Failed to create service:', await response.text())
    return null
  }

  const created = await response.json() as Array<{ id: string }> | { id: string }
  return { id: Array.isArray(created) ? created[0].id : created.id }
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
      return { success: false, error: 'Invalid start_date format. Use YYYY-MM-DD' }
    }

    if (input.end_date) {
      const endDate = new Date(input.end_date)
      if (isNaN(endDate.getTime())) {
        return { success: false, error: 'Invalid end_date format. Use YYYY-MM-DD' }
      }
      if (endDate < startDate) {
        return { success: false, error: 'end_date cannot be before start_date' }
      }
    }

    // 1. Get brand's industry type (auto-detect expediente_tipo)
    const industryType = await getBrandIndustryType(context.brandId, env)
    console.log(`[create_expediente] Brand industry type: ${industryType}`)

    // 2. Generate unique expediente code
    const expedienteCodigo = generateExpedienteCode(industryType)

    // 3. Create expediente
    const expedienteData = {
      expediente_codigo: expedienteCodigo,
      expediente_nombre: input.expediente_nombre,
      expediente_tipo: industryType,
      expediente_estado: 'abierto',
      customer_id: input.customer_id || null,
      departure_date: input.start_date,
      return_date: input.end_date || null,
      departure_city: input.service_data?.departure_city || '-',
      arrival_city: input.service_data?.arrival_city || '-',
      total_seats: input.beneficiarios?.length || 1,
      available_seats: input.beneficiarios?.length || 1,
      description: input.description || null,
      notes: input.notes || null,
      brand_id: context.brandId,
      created_by: context.userId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    const expedienteResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/expedientes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(expedienteData)
    })

    if (!expedienteResponse.ok) {
      const errorText = await expedienteResponse.text()
      console.error('[create_expediente] Database error:', errorText)
      return { success: false, error: `Failed to create expediente: ${errorText}` }
    }

    const expedienteResult = await expedienteResponse.json()
    const expediente = Array.isArray(expedienteResult) ? expedienteResult[0] : expedienteResult

    // 4. Create service if service_type_code provided
    let createdService = null
    if (input.service_type_code) {
      const serviceType = await findServiceTypeByCode(context.brandId, input.service_type_code, env)
      createdService = await createService(
        context.brandId,
        expediente.id,
        serviceType?.id || null,
        input.service_data || {},
        context.userId,
        env
      )
    }

    // 5. Create beneficiaries if provided
    const createdBeneficiarios: Array<{ id: string; name: string; created: boolean; linked: boolean }> = []
    if (input.beneficiarios && input.beneficiarios.length > 0) {
      for (const beneficiary of input.beneficiarios) {
        const result = await createOrFindBeneficiary(
          context.brandId,
          beneficiary,
          context.userId,
          env
        )
        if (result) {
          const linked = await linkBeneficiaryToExpediente(
            context.brandId,
            expediente.id,
            result.id,
            context.userId,
            env
          )
          createdBeneficiarios.push({
            id: result.id,
            name: `${beneficiary.first_name} ${beneficiary.last_name}`,
            created: result.created,
            linked
          })
        }
      }
    }

    // Log usage
    await logUsage({
      context,
      toolName: 'create_expediente',
      success: true,
      durationMs: Date.now() - startTime
    }, env)

    return {
      success: true,
      data: {
        message: 'Expediente created successfully',
        expediente: {
          id: expediente.id,
          codigo: expediente.expediente_codigo,
          nombre: expediente.expediente_nombre,
          tipo: expediente.expediente_tipo,
          estado: expediente.expediente_estado,
          customer_id: expediente.customer_id,
          start_date: expediente.departure_date,
          end_date: expediente.return_date,
          description: expediente.description
        },
        service: createdService ? {
          id: createdService.id,
          message: 'Service created and linked'
        } : null,
        beneficiarios: createdBeneficiarios.length > 0 ? {
          count: createdBeneficiarios.length,
          items: createdBeneficiarios
        } : null,
        next_steps: [
          createdService ? null : 'Use manage_expediente_services to add services',
          createdBeneficiarios.length === 0 ? 'Add beneficiaries using dedicated tool' : null,
          'Update service prices and details as needed'
        ].filter(Boolean)
      }
    }
  } catch (error) {
    console.error('[create_expediente] Error:', error)

    await logUsage({
      context,
      toolName: 'create_expediente',
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      durationMs: Date.now() - startTime
    }, env)

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error creating expediente'
    }
  }
}
