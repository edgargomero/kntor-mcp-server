# Kntor MCP Server

Model Context Protocol (MCP) server for Kntor.io Healthcare ERP. Allows AI agents (Claude, n8n, WhatsApp bots) to interact with the ERP system.

## Claude Desktop Setup

### Option 1: Using npx (Recommended)

Add to your Claude Desktop config (`%APPDATA%\Claude\claude_desktop_config.json` on Windows, `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "kntor-erp": {
      "command": "npx",
      "args": ["-y", "kntor-mcp"],
      "env": {
        "KNTOR_API_KEY": "kntor_your_api_key_here"
      }
    }
  }
}
```

### Option 2: Using local installation

```json
{
  "mcpServers": {
    "kntor-erp": {
      "command": "node",
      "args": ["C:\\path\\to\\kntor-mcp-server\\bin\\kntor-mcp.mjs"],
      "env": {
        "KNTOR_API_KEY": "kntor_your_api_key_here"
      }
    }
  }
}
```

After saving the config, restart Claude Desktop.

## Server Development

```bash
# Install dependencies
pnpm install

# Set up secrets
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put SUPABASE_SERVICE_ROLE_KEY

# Run locally
pnpm run dev

# Deploy
pnpm run deploy
```

## Authentication

The server uses a 3-layer authentication model:

1. **API Key** (`x-api-key` header) - Identifies the brand/tenant
2. **JWT** (in tool calls) - Identifies the user, preserves `auth.uid()`
3. **RBAC** - Verifies permissions before executing

### Getting an API Key

API keys are created by brand admins in the Kntor.io dashboard:
1. Go to Settings → MCP Integration
2. Click "Create API Key"
3. Save the key (shown only once)

## Available Tools

### `get_availability`
Check professional availability for appointment scheduling.

```json
{
  "method": "tools/call",
  "params": {
    "name": "get_availability",
    "arguments": {
      "jwt": "eyJhbGciOiJS...",
      "date": "2025-01-20",
      "professional_id": "uuid-optional",
      "profession_type": "psychologist"
    }
  }
}
```

### `schedule_appointment`
Schedule a new appointment.

```json
{
  "method": "tools/call",
  "params": {
    "name": "schedule_appointment",
    "arguments": {
      "jwt": "eyJhbGciOiJS...",
      "patient_id": "patient-uuid",
      "professional_id": "prof-uuid",
      "appointment_date": "2025-01-20",
      "start_time": "10:00",
      "duration_minutes": 60
    }
  }
}
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check |
| `/health` | GET | Health check |
| `/mcp` | POST | MCP JSON-RPC endpoint |
| `/messages` | POST | MCP JSON-RPC endpoint (alias) |

## Example Request

```bash
curl -X POST https://mcp.kntor.io/mcp \
  -H "Content-Type: application/json" \
  -H "x-api-key: kntor_your_api_key_here" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'
```

## Pricing Tiers

| Tier | Monthly Limit | Price |
|------|--------------|-------|
| free | 100 calls | $0 |
| starter | 1,000 calls | $29/mo |
| pro | 10,000 calls | $99/mo |
| enterprise | Unlimited | Custom |

## Development

```bash
# Type check
pnpm run typecheck

# Run locally
pnpm run dev

# Deploy to production
pnpm run deploy
```

## Architecture

```
mcp-server/
├── src/
│   ├── index.ts           # Worker entry point
│   ├── types.ts           # TypeScript types
│   ├── auth/
│   │   ├── api-key.ts     # API key validation
│   │   └── jwt.ts         # JWT validation + user client
│   ├── tools/
│   │   ├── index.ts       # Tool registry
│   │   ├── get-availability.ts
│   │   └── schedule-appointment.ts
│   └── utils/
│       ├── supabase.ts    # Supabase client factory
│       └── metering.ts    # Usage logging
├── wrangler.toml          # Cloudflare config
└── package.json
```
