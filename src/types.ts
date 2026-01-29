/**
 * Cloudflare Analytics Engine Dataset binding
 */
export interface AnalyticsEngineDataset {
  writeDataPoint(data: {
    blobs?: string[]
    doubles?: number[]
    indexes?: string[]
  }): void
}

/**
 * Cloudflare Worker environment bindings
 */
export interface Env {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string
  ENVIRONMENT: string
  MCP_ANALYTICS?: AnalyticsEngineDataset
}

/**
 * Field schema definition with type and format
 */
export interface FieldSchema {
  type: 'date' | 'datetime' | 'string' | 'integer' | 'email' | 'phone' | 'currency'
  format?: string        // e.g., "YYYY-MM-DD", "IATA"
  label: string          // Display name in Spanish
  required: boolean
  options?: string[]     // For select fields
  min?: number           // For integers
  max?: number
  example?: string       // Example value
}

/**
 * Service type available for the brand
 */
export interface ServiceType {
  code: string
  name: string
  category: string
  subcategory?: string | null
  description?: string | null
  /** Fields required to collect for this service type */
  required_fields?: string[]
  /** Optional fields that can be collected */
  optional_fields?: string[]
  /** Full schema definitions with types and formats */
  field_schemas?: Record<string, FieldSchema>
}

/**
 * Industry types (shared with brands.industry_type and expedientes.expediente_tipo)
 */
export type IndustryType = 'travel' | 'legal' | 'medical' | 'education' | 'other'

/**
 * Result from validate_mcp_api_key RPC
 */
export interface ApiKeyValidationResult {
  valid: boolean
  error?: string
  message?: string
  api_key_id?: string
  brand_id?: string
  brand_name?: string
  brand_domain?: string
  brand_industry_type?: IndustryType
  service_types?: ServiceType[]
  key_name?: string
  tier?: 'free' | 'starter' | 'pro' | 'enterprise'
  monthly_limit?: number
  current_usage?: number
  remaining_calls?: number
  // User info from API key creator
  user_id?: string
  user_email?: string
  user_role?: string
}

/**
 * JWT payload from Supabase auth
 */
export interface JWTPayload {
  sub: string          // user_id
  email?: string
  role: string         // 'authenticated'
  aud: string
  exp: number
  iat: number
  app_metadata?: {
    provider?: string
    providers?: string[]
  }
  user_metadata?: Record<string, unknown>
}

/**
 * Context passed through MCP tool execution
 */
export interface MCPContext {
  apiKeyId: string
  brandId: string
  brandName: string
  brandIndustryType: IndustryType
  serviceTypes: ServiceType[]
  tier: string
  userId: string       // From API key creator
  userEmail: string
  userRole: string
}

/**
 * Tool execution result
 */
export interface ToolResult {
  success: boolean
  data?: unknown
  error?: string
}
