/**
 * Floyd HTTP MCP Server
 *
 * Enables Floyd instances to communicate with each other via HTTP.
 * Supports calling Desktop Web, Mobile, and other Floyd instances.
 *
 * @module floyd-http-server
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

/**
 * Known Floyd instance endpoints
 * Users can override these in tool calls
 */
const FLOYD_ENDPOINTS = {
  desktop: 'http://localhost:3001',
  desktopNgrok: 'https://crm-ai-pro-test.ngrok-free.app',
  mobile: 'https://floyd-mobile.ngrok-free.app',
} as const;

/**
 * Parse URL to extract hostname for validation
 */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Make HTTP request using fetch (Node 18+)
 */
async function makeRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<{ success: boolean; status: number; data: string; headers: Record<string, string> }> {
  const { method = 'GET', headers = {}, body } = options;

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body,
    });

    const responseText = await response.text();
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      success: response.ok,
      status: response.status,
      data: responseText,
      headers: responseHeaders,
    };
  } catch (error) {
    return {
      success: false,
      status: 0,
      data: error instanceof Error ? error.message : String(error),
      headers: {},
    };
  }
}

// ============================================================================
// MCP SERVER SETUP
// ============================================================================

const server = new Server(
  {
    name: 'floyd-http-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// ============================================================================
// TOOL HANDLERS
// ============================================================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'http_get',
        description: 'Make HTTP GET request to a URL. Useful for calling other Floyd instances or web APIs.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'URL to request. Can use shortcuts: "desktop", "desktopNgrok", "mobile", or full URL',
            },
            headers: {
              type: 'object',
              description: 'Optional HTTP headers',
              additionalProperties: { type: 'string' },
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'http_post',
        description: 'Make HTTP POST request to a URL. Useful for sending messages to Floyd Desktop or other instances.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'URL to request. Can use shortcuts: "desktop", "desktopNgrok", "mobile", or full URL',
            },
            body: {
              type: 'object',
              description: 'JSON body to send',
            },
            headers: {
              type: 'object',
              description: 'Optional HTTP headers',
              additionalProperties: { type: 'string' },
            },
          },
          required: ['url', 'body'],
        },
      },
      {
        name: 'floyd_call_desktop',
        description: 'Send a chat message to Floyd Desktop Web instance at localhost:3001',
        inputSchema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'Message to send to Floyd Desktop',
            },
            sessionId: {
              type: 'string',
              description: 'Optional session ID to continue existing conversation',
            },
          },
          required: ['message'],
        },
      },
      {
        name: 'floyd_call_desktop_remote',
        description: 'Send a chat message to Floyd Desktop via ngrok tunnel (remote access)',
        inputSchema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'Message to send to Floyd Desktop',
            },
            sessionId: {
              type: 'string',
              description: 'Optional session ID to continue existing conversation',
            },
          },
          required: ['message'],
        },
      },
      {
        name: 'floyd_desktop_health',
        description: 'Check if Floyd Desktop is running and accessible',
        inputSchema: {
          type: 'object',
          properties: {
            remote: {
              type: 'boolean',
              description: 'Use ngrok tunnel (true) or localhost (false, default)',
            },
          },
        },
      },
      {
        name: 'floyd_list_endpoints',
        description: 'List known Floyd instance endpoints',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'supercache_bridge',
        description: 'Bridge messages between Floyd instances via SUPERCACHE. Store a message for another instance to retrieve.',
        inputSchema: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Cache key (e.g., "desktop:message:pending", "cli:response:123")',
            },
            value: {
              type: 'string',
              description: 'Message content to store',
            },
            tier: {
              type: 'string',
              description: 'SUPERCACHE tier: project, reasoning, or vault (default: project)',
              enum: ['project', 'reasoning', 'vault'],
            },
            ttl: {
              type: 'number',
              description: 'Time to live in seconds (default: 3600 = 1 hour)',
            },
          },
          required: ['key', 'value'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'http_get': {
        const urlArg = (args as { url: string }).url;
        const headers = (args as { headers?: Record<string, string> }).headers || {};

        // Resolve URL shortcuts
        let url = urlArg;
        if (urlArg in FLOYD_ENDPOINTS) {
          url = FLOYD_ENDPOINTS[urlArg as keyof typeof FLOYD_ENDPOINTS];
        }

        if (!isValidUrl(url)) {
          throw new Error(`Invalid URL: ${url}`);
        }

        const result = await makeRequest(url, { method: 'GET', headers });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'http_post': {
        const urlArg = (args as { url: string }).url;
        const body = (args as { body: Record<string, unknown> }).body;
        const headers = (args as { headers?: Record<string, string> }).headers || {};

        // Resolve URL shortcuts
        let url = urlArg;
        if (urlArg in FLOYD_ENDPOINTS) {
          url = FLOYD_ENDPOINTS[urlArg as keyof typeof FLOYD_ENDPOINTS];
        }

        if (!isValidUrl(url)) {
          throw new Error(`Invalid URL: ${url}`);
        }

        const result = await makeRequest(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'floyd_call_desktop': {
        const { message, sessionId } = args as { message: string; sessionId?: string };
        const url = FLOYD_ENDPOINTS.desktop + '/api/chat';

        const result = await makeRequest(url, {
          method: 'POST',
          body: JSON.stringify({ sessionId, message }),
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'floyd_call_desktop_remote': {
        const { message, sessionId } = args as { message: string; sessionId?: string };
        const url = FLOYD_ENDPOINTS.desktopNgrok + '/api/chat';

        const result = await makeRequest(url, {
          method: 'POST',
          body: JSON.stringify({ sessionId, message }),
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'floyd_desktop_health': {
        const remote = (args as { remote?: boolean }).remote || false;
        const baseUrl = remote ? FLOYD_ENDPOINTS.desktopNgrok : FLOYD_ENDPOINTS.desktop;
        const url = baseUrl + '/api/health';

        const result = await makeRequest(url);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'floyd_list_endpoints': {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(FLOYD_ENDPOINTS, null, 2),
            },
          ],
        };
      }

      case 'supercache_bridge': {
        const { key, value, tier = 'project', ttl = 3600 } = args as {
          key: string;
          value: string;
          tier?: 'project' | 'reasoning' | 'vault';
          ttl?: number;
        };

        // This is a placeholder - actual SUPERCACHE operations should use floyd-supercache-server
        // This tool serves as a documentation bridge for users
        return {
          content: [
            {
              type: 'text',
              text: `SUPERCACHE Bridge: Use floyd-supercache-server tools directly.

Recommended workflow:
1. Store message: Use cache_store with key="${key}"
2. Retrieve: Other instance uses cache_retrieve with key="${key}"

Example:
- CLI Floyd: cache_store(key="${key}", value="${value}", tier="${tier}", ttl=${ttl})
- Desktop Floyd: cache_retrieve(key="${key}")

To use SUPERCACHE, ensure floyd-supercache-server is running and configured.`,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        },
      ],
      isError: true,
    };
  }
});

// ============================================================================
// STARTUP
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log startup (goes to stderr, not MCP stdout)
  console.error('[Floyd HTTP Server] Started on stdio');
  console.error('[Floyd HTTP Server] Available tools: http_get, http_post, floyd_call_desktop, floyd_call_desktop_remote, floyd_desktop_health, floyd_list_endpoints, supercache_bridge');
}

main().catch((error) => {
  console.error('[Floyd HTTP Server] Fatal error:', error);
  process.exit(1);
});
