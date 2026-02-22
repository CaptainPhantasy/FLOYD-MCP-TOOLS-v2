# Prompt Library Server

MCP Prompt Library Server - Frictionless access to 117+ prompts for Claude Code, Cline, Cursor, and other AI IDEs.

## Overview

The Prompt Library Server is a Node.js backend that provides:

- **MCP Transport**: stdio transport for MCP-compatible AI IDEs
- **HTTP API**: REST API for web applications
- **WebSocket**: Real-time updates for connected clients
- **Authentication**: JWT-based user authentication
- **Workflow Engine**: DAG-based workflow execution
- **Chain Executor**: Sequential prompt chain execution
- **GLM Proxy**: Secure proxy for GLM-4.7 Coding API

## Features

```
+----------------------+----------------------------------------------------------+
| Feature              | Description                                              |
+----------------------+----------------------------------------------------------+
| MCP Protocol         | Full Model Context Protocol support                      |
| HTTP REST API        | Complete REST API for web clients                       |
| WebSocket            | Real-time broadcast of updates                          |
| Authentication       | JWT-based auth with refresh tokens                      |
| Prompt Library       | 117+ curated prompts across 5 categories                |
| Chains               | Sequential prompt execution with variables               |
| Workflows            | DAG-based parallel execution                            |
| GLM Integration      | AI-powered workflow generation                          |
| Rate Limiting        | Per-IP and per-endpoint rate limits                     |
| Usage Analytics      | Track prompt usage and execution trends                  |
+----------------------+----------------------------------------------------------+
```

## Quick Start

### Prerequisites

- Node.js 18+ or 20+
- GLM-4.7 Coding API key (for workflow generation)

### Installation

```bash
# Clone repository
git clone <repository-url> prompt-library-server
cd prompt-library-server

# Install dependencies
npm install

# Build TypeScript
npm run build

# Configure environment
cp .env.example .env
# Edit .env with your configuration
```

### Configuration

Create a `.env` file:

```bash
# GLM-4.7 Coding API Key
GLM_CODING_API_KEY=your_api_key_here

# Server Configuration
PORT=3000
ENABLE_HTTP=true

# CORS Configuration
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173

# Rate Limiting
RATE_LIMIT_GENERAL=100
RATE_LIMIT_GLM=20

# Node Environment
NODE_ENV=production
```

### Running

```bash
# Start HTTP server
npm run start:http

# Start with stdio (MCP mode)
npm start

# Watch mode for development
npm run watch
```

## MCP Tools

When connected via stdio, the server provides the following MCP tools:

### list_prompts

List all prompts with pagination and filtering.

```json
{
  "category": "autonomous",
  "page": 1,
  "page_size": 20,
  "format": "table"
}
```

### get_prompt

Get full content of a specific prompt.

```json
{
  "id": "A01",
  "include_frontmatter": false
}
```

### search_prompts

Search prompts by name, tag, role, or description.

```json
{
  "query": "agent",
  "tag": "claude",
  "limit": 20
}
```

### list_chains

List all saved prompt chains.

### list_workflows

List all saved workflows.

## API Endpoints

### Authentication

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/register` | POST | Register new user |
| `/api/auth/login` | POST | Login with credentials |
| `/api/auth/logout` | POST | Logout current session |
| `/api/auth/refresh` | POST | Refresh access token |
| `/api/auth/me` | GET | Get current user |
| `/api/auth/check` | GET | Check session validity |

### Prompts

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/prompts` | GET | List prompts with pagination |
| `/api/prompts/categories` | GET | List all categories |
| `/api/prompts/tags` | GET | List all tags |
| `/api/prompts/trending` | GET | Get trending prompts |
| `/api/prompts/:id` | GET | Get single prompt |
| `/api/prompts` | POST | Create new prompt |
| `/api/prompts/:id` | PUT | Update prompt |
| `/api/prompts/:id` | DELETE | Delete prompt |

### Chains

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chains` | GET | List chains |
| `/api/chains/:id` | GET | Get single chain |
| `/api/chains` | POST | Create chain |
| `/api/chains/:id` | PUT | Update chain |
| `/api/chains/:id` | DELETE | Delete chain |
| `/api/chains/:id/run` | POST | Execute chain |

### Workflows

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/workflows` | GET | List workflows |
| `/api/workflows/:id` | GET | Get single workflow |
| `/api/workflows` | POST | Create workflow |
| `/api/workflows/:id` | PUT | Update workflow |
| `/api/workflows/:id` | DELETE | Delete workflow |
| `/api/workflows/:id/run` | POST | Execute workflow |

### Executions

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/executions/trend` | GET | Get execution trend data |
| `/api/executions` | GET | Get execution history |

### GLM Proxy

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/proxy/glm/generate` | POST | Generate workflow with AI |
| `/api/proxy/glm/status` | GET | Check GLM availability |

## Project Structure

```
prompt-library-server/
├── src/
│   ├── index.ts           # MCP server entry point
│   ├── http-server.ts     # Express HTTP server
│   ├── auth.ts            # Authentication module
│   ├── auth-routes.ts     # Auth endpoints
│   ├── auth-middleware.ts # Auth middleware
│   ├── auth-schemas.ts    # Zod validation schemas
│   ├── chain-executor.ts  # Chain execution engine
│   ├── workflow-engine.ts # Workflow execution engine
│   └── dist/              # Compiled JavaScript
├── .env.example           # Environment template
├── package.json           # Dependencies
└── tsconfig.json          # TypeScript config
```

## Development

### Scripts

```bash
npm run build    # Compile TypeScript
npm run watch    # Watch mode
npm start        # Start server
npm run start:http  # Start HTTP server
```

### Testing

```bash
# Run tests (if configured)
npm test
```

### Adding New Endpoints

1. Add route handler in `http-server.ts`
2. Add Zod schema for validation (if needed)
3. Update documentation

### Adding New MCP Tools

1. Add tool definition to `TOOL_DEFINITIONS` in `index.ts`
2. Add handler in `CallToolRequestSchema` handler
3. Test with MCP client

## Deployment

### Production Build

```bash
npm run build
NODE_ENV=production ENABLE_HTTP=true node dist/index.js
```

### Process Manager

Using PM2:

```bash
npm install -g pm2
pm2 start dist/index.js --name prompt-library --env production
pm2 save
pm2 startup
```

Using systemd:

Create `/etc/systemd/system/prompt-library.service`:

```ini
[Unit]
Description=Prompt Library Server
After=network.target

[Service]
Type=simple
User=promptlib
WorkingDirectory=/opt/prompt-library-server
Environment="NODE_ENV=production"
Environment="ENABLE_HTTP=true"
ExecStart=/usr/bin/node /opt/prompt-library-server/dist/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## Architecture

For detailed architecture documentation, see the frontend documentation at:

```
/Volumes/Storage/Prompt Library/prompt-orchestrator-skel/docs/ARCHITECTURE.md
```

## Security

- Passwords hashed with bcryptjs
- JWT tokens for authentication
- HTTP-only cookies for refresh tokens
- CORS protection
- Rate limiting per IP
- Input validation with Zod

## Troubleshooting

### "Prompt Library index not found"

Ensure your prompt library path is correct and the index exists:

```bash
ls -la "/Volumes/Storage/Prompt Library/.promptlib/index.json"
```

### "GLM API not configured"

Set `GLM_CODING_API_KEY` in your `.env` file.

### Port already in use

Change the `PORT` in `.env` or stop the process using port 3000.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

---

**Version**: 2.0.0
**Last Updated**: 2026-02-09
