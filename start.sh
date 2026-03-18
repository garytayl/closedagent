#!/usr/bin/env bash
set -euo pipefail

echo "Starting MCP server from /mcp-server"
cd /workspace/mcp-server

npm run build
npm run start
