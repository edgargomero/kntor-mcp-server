#!/bin/bash
# MCP Server Deployment Script
# Run this from the mcp-server directory

echo "=== Kntor MCP Server Deployment ==="

# 1. Install dependencies
echo "Installing dependencies..."
pnpm install

# 2. Type check
echo "Type checking..."
pnpm run typecheck

# 3. Configure secrets (only needed once)
echo ""
echo "Configuring secrets..."
echo "If you haven't set secrets yet, run:"
echo "  wrangler secret put SUPABASE_URL"
echo "  wrangler secret put SUPABASE_ANON_KEY"
echo "  wrangler secret put SUPABASE_SERVICE_ROLE_KEY"
echo ""

# 4. Deploy
echo "Deploying to Cloudflare Workers..."
pnpm run deploy

echo ""
echo "=== Deployment Complete ==="
echo "Your MCP server should be available at: https://kntor-mcp-server.<your-subdomain>.workers.dev"
echo ""
echo "To set up custom domain (mcp.kntor.io):"
echo "  1. Go to Cloudflare Dashboard > Workers & Pages > kntor-mcp-server"
echo "  2. Settings > Triggers > Custom Domains"
echo "  3. Add 'mcp.kntor.io'"
