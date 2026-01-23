# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

MCP Server for Kntor.io ERP. Enables AI agents (Claude Desktop, n8n, WhatsApp bots) to interact with the CRM/ERP system via Model Context Protocol.

- **Runtime**: Cloudflare Workers
- **Transport**: HTTP + JSON-RPC 2.0, Streamable HTTP (MCP 2025), Legacy SSE
- **Database**: Supabase PostgreSQL via REST API
- **NPM Package**: `kntor-mcp` (stdio proxy for Claude Desktop)
- **Production**: https://mcp.kntor.io

## Commands

```bash
pnpm install          # Install dependencies
pnpm run dev          # Local development (port 8787)
pnpm run deploy       # Deploy to Cloudflare Workers
pnpm run typecheck    # TypeScript type checking
wrangler tail         # View production logs
```

## Architecture

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

**Key files:**
- `src/index.ts` - Worker entry point, HTTP routing, MCP protocol handler
- `src/tools/index.ts` - Tool registry and executor
- `src/auth/api-key.ts` - API key validation via Supabase RPC
- `bin/kntor-mcp.mjs` - Stdio proxy for Claude Desktop (published to npm)

## Authentication Flow

```
API Key (x-api-key header) → validate_mcp_api_key RPC → brand_id → MCPContext → Data Isolation
```

All operations filter by `brand_id` from the validated API key. Never query without brand isolation.

## Available Tools

1. **identify_customer** - Check if customer exists by phone/email/RUT (use BEFORE create_customer)
2. **create_customer** - Create individual or company customer
3. **search_customers** - Search customers with filters
4. **create_expediente** - Create case/project for a customer
5. **manage_expediente_services** - CRUD operations on expediente services

## Gotchas

### Supabase REST API (no SDK chaining)

```typescript
// ❌ NO FUNCIONA
const { data } = await supabase.from('table').insert(data).select().single()

// ✅ CORRECTO - Use REST API directly
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

### Tool Descriptions for AI

Make required/optional fields explicit in descriptions:
```typescript
description: `REQUIRED FIELDS:
- field1: description

OPTIONAL FIELDS:
- field2: description`
```

### Brand Isolation

ALWAYS include `brand_id` in queries:
```typescript
url += `&brand_id=eq.${context.brandId}`
```

## Transport Support

The server supports multiple MCP transports:
- **Streamable HTTP** (`/mcp` with `Accept: text/event-stream`) - MCP 2025 spec
- **HTTP JSON-RPC** (`POST /mcp`) - Standard request/response
- **Legacy SSE** (`GET /sse` + `POST /messages`) - For older clients

## Environment Variables

**Worker secrets** (set via `wrangler secret put`):
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

**Local development** (`.dev.vars`):
```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

## Adding a New Tool

1. Create `src/tools/my-tool.ts` with:
   - Zod input schema
   - Tool definition (name, description, inputSchema)
   - Execute function returning `ToolResult`
2. Register in `src/tools/index.ts`:
   - Import the tool
   - Add to `tools` array
   - Add executor to `toolExecutors` map
3. Deploy: `pnpm run deploy`

## Error Codes

API key errors use codes -32001 to -32006:
- `-32001`: API key missing
- `-32002`: Invalid format (must start with `kntor_`)
- `-32003`: Invalid/not found
- `-32004`: Inactive
- `-32005`: Expired
- `-32006`: Rate limit exceeded
