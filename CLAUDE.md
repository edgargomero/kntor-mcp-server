# CLAUDE.md - Kntor MCP Server

**#memorize** MCP Server para Kntor.io ERP. Permite a agentes IA (Claude Desktop, n8n, WhatsApp bots) interactuar con el sistema CRM/ERP.

---

## Stack Tecnologico

- **Runtime**: Cloudflare Workers (Edge Computing)
- **Transport**: HTTP + JSON-RPC 2.0 (MCP Protocol)
- **Database**: Supabase PostgreSQL (via REST API)
- **NPM Package**: `kntor-mcp` (stdio proxy para Claude Desktop)
- **Domain**: https://mcp.kntor.io

---

## Arquitectura

```
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ Claude Desktop  │   │  n8n Workflow   │   │  WhatsApp Bot   │
│    (stdio)      │   │   (HTTP)        │   │   (HTTP)        │
└────────┬────────┘   └────────┬────────┘   └────────┬────────┘
         │                     │                     │
         ▼                     │                     │
┌─────────────────┐            │                     │
│  kntor-mcp      │            │                     │
│  (npm package)  │            │                     │
│  stdio → HTTP   │            │                     │
└────────┬────────┘            │                     │
         └─────────────────────┼─────────────────────┘
                               ▼
                 ┌─────────────────────────────┐
                 │   MCP Server (CF Worker)    │
                 │       mcp.kntor.io          │
                 ├─────────────────────────────┤
                 │  API Key Authentication     │
                 │  Brand Isolation (RBAC)     │
                 │  Usage Metering             │
                 └──────────────┬──────────────┘
                                ▼
                    ┌────────────────────┐
                    │  Supabase (RLS)    │
                    └────────────────────┘
```

---

## Tools Disponibles

### 1. search_customers
Buscar clientes en el sistema.

```json
{
  "query": "Juan",           // Opcional: texto de busqueda
  "customer_type": "individual", // Opcional: individual | company
  "status": "active",        // Opcional: active | inactive | lead | prospect
  "limit": 20                // Opcional: max resultados (1-50)
}
```

### 2. create_customer
Crear un nuevo cliente.

**Para individuos** (REQUERIDO: first_name, last_name):
```json
{
  "customer_type": "individual",
  "first_name": "Juan",
  "last_name": "Perez",
  "email": "juan@example.com",
  "phone": "+56912345678",
  "rut": "12.345.678-9"
}
```

**Para empresas** (REQUERIDO: company_name):
```json
{
  "customer_type": "company",
  "company_name": "Mi Empresa SpA",
  "email": "contacto@empresa.cl",
  "phone": "+56212345678",
  "tax_id": "76.123.456-7"
}
```

### 3. create_expediente
Crear un expediente (caso/proyecto) para un cliente.

```json
{
  "expediente_nombre": "Proyecto Marketing 2026",  // REQUERIDO
  "expediente_tipo": "proyecto",                   // REQUERIDO
  "start_date": "2026-01-18",                      // REQUERIDO (YYYY-MM-DD)
  "customer_id": "uuid-del-cliente",               // Opcional
  "end_date": "2026-03-31",                        // Opcional
  "description": "Descripcion del proyecto",      // Opcional
  "notes": "Notas internas"                        // Opcional
}
```

### 4. manage_expediente_services
Gestionar servicios dentro de un expediente.

**Acciones disponibles:**
- `list_types` - Listar tipos de servicio disponibles
- `list` - Listar servicios de un expediente
- `add` - Agregar servicio
- `update` - Actualizar servicio
- `remove` - Eliminar servicio

```json
// Listar tipos de servicio (llamar primero)
{ "action": "list_types" }

// Agregar servicio
{
  "action": "add",
  "expediente_id": "uuid-del-expediente",
  "service_name": "Hotel 3 noches",
  "unit_price": 50000,
  "quantity": 3
}
```

---

## Autenticacion

### Flujo de API Key

1. **API Key** (header `x-api-key: kntor_xxx`) identifica el brand
2. **RPC `validate_mcp_api_key`** valida y retorna `brand_id`
3. **Todas las operaciones** filtran por `brand_id` automaticamente

```
API Key → validate_mcp_api_key() → brand_id → MCPContext → Data Isolation
```

### Brand Isolation

Cada API key esta asociada a un brand. Los datos NUNCA se mezclan entre brands:

```typescript
// Todas las queries incluyen brand_id
const customerData = {
  ...input,
  brand_id: context.brandId,  // Del API key
  created_by: context.userId
}
```

---

## Comandos de Desarrollo

```bash
# Instalar dependencias
pnpm install

# Desarrollo local
pnpm run dev

# Deploy a produccion
pnpm run deploy
# o simplemente push a main (auto-deploy via Git)
git push origin main

# Ver logs
wrangler tail
```

---

## Estructura del Proyecto

```
kntor-mcp-server/
├── bin/
│   └── kntor-mcp.mjs      # Stdio proxy para Claude Desktop (npm)
├── src/
│   ├── index.ts           # Entry point (Cloudflare Worker)
│   ├── server.ts          # MCP server config + tool registry
│   ├── types.ts           # TypeScript types
│   ├── auth/
│   │   └── api-key.ts     # Validacion API key
│   ├── tools/
│   │   ├── search-customers.ts
│   │   ├── create-customer.ts
│   │   ├── create-expediente.ts
│   │   └── manage-expediente-services.ts
│   └── utils/
│       ├── supabase.ts    # Client factory
│       └── metering.ts    # Usage logging
├── wrangler.toml          # Cloudflare config
└── package.json
```

---

## Uso con Claude Desktop

### Configuracion (claude_desktop_config.json)

```json
{
  "mcpServers": {
    "kntor-erp": {
      "command": "npx",
      "args": ["-y", "kntor-mcp"],
      "env": {
        "KNTOR_API_KEY": "kntor_tu_api_key_aqui"
      }
    }
  }
}
```

### Test Rapido

```bash
# Verificar que el package funciona
KNTOR_API_KEY=kntor_xxx npx -y kntor-mcp

# Deberia mostrar mensaje de conexion o error de API key
```

---

## Variables de Entorno

### Worker (wrangler.toml secrets)

```bash
# Configurar secrets
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

### Desarrollo Local (.dev.vars)

```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

---

## Tablas de Base de Datos

### mcp_api_keys
```sql
CREATE TABLE mcp_api_keys (
  id UUID PRIMARY KEY,
  brand_id UUID REFERENCES brands(id),
  key_hash TEXT NOT NULL,        -- SHA256 del API key
  key_prefix TEXT NOT NULL,      -- kntor_xxxxxxxx
  name TEXT NOT NULL,            -- "WhatsApp Bot", "n8n"
  tier TEXT DEFAULT 'free',      -- free|starter|pro|enterprise
  monthly_limit INTEGER DEFAULT 100,
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);
```

### mcp_usage
```sql
CREATE TABLE mcp_usage (
  id UUID PRIMARY KEY,
  api_key_id UUID REFERENCES mcp_api_keys(id),
  brand_id UUID REFERENCES brands(id),
  tool_name TEXT NOT NULL,
  user_id UUID,
  success BOOLEAN,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ
);
```

---

## Endpoints

- **Health**: `GET https://mcp.kntor.io/health`
- **MCP**: `POST https://mcp.kntor.io/mcp` (JSON-RPC 2.0)

### Ejemplo Request

```bash
curl -X POST https://mcp.kntor.io/mcp \
  -H "x-api-key: kntor_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "id": 1
  }'
```

---

## Gotchas

### 1. Supabase REST API (NO SDK chainable)

```typescript
// ❌ NO FUNCIONA (createServiceClient no soporta chains)
const { data } = await supabase.from('table').insert(data).select().single()

// ✅ CORRECTO (REST API directo)
const response = await fetch(`${env.SUPABASE_URL}/rest/v1/table`, {
  method: 'POST',
  headers: {
    'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Prefer': 'return=representation'
  },
  body: JSON.stringify(data)
})
```

### 2. Tool Descriptions para AI

Las descripciones deben ser explicitas sobre campos requeridos:
```typescript
description: `REQUIRED FIELDS:
- field1: descripcion
- field2: descripcion

OPTIONAL FIELDS:
- field3: descripcion`
```

### 3. Brand Isolation

SIEMPRE incluir `brand_id` del context en queries:
```typescript
.eq('brand_id', context.brandId)
```

---

## NPM Package

- **Nombre**: `kntor-mcp`
- **Version**: 1.0.0
- **Instalacion**: `npx -y kntor-mcp`
- **Repositorio**: https://github.com/edgargomero/kntor-mcp-server

El package es un stdio proxy que traduce el protocolo stdio de Claude Desktop a HTTP contra mcp.kntor.io.

---

## Links

- **Produccion**: https://mcp.kntor.io
- **NPM**: https://www.npmjs.com/package/kntor-mcp
- **GitHub**: https://github.com/edgargomero/kntor-mcp-server
- **Kntor.io App**: https://kntor.io
