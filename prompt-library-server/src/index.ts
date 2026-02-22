#!/usr/bin/env node

/**
 * MCP Prompt Library Server
 *
 * Frictionless access to 117+ prompts directly in Claude Code, Cline, Cursor, and other AI IDEs.
 *
 * Transports:
 * - stdio: For MCP clients (Claude Code, Cline, Cursor)
 * - HTTP: For web applications and REST API access
 *
 * Tools:
 * - list_prompts: List all prompts with metadata, filterable by category
 * - get_prompt: Get full prompt content by ID
 * - search_prompts: Search by name, tag, role, or description
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { HttpServer } from './http-server.js';

// Prompt Library Configuration
const PROMPT_LIB_PATH = '/Volumes/Storage/Prompt Library';
const INDEX_PATH = join(PROMPT_LIB_PATH, '.promptlib', 'index.json');

// Environment configuration
const HTTP_PORT = parseInt(process.env.HTTP_PORT || '3000', 10);
const ENABLE_HTTP = process.env.ENABLE_HTTP === 'true' || process.env.HTTP_MODE === 'true';

// Types for the prompt index
interface PromptMetadata {
  type?: string;
  role?: string;
  tags?: string;
  tags_list?: string[];
  priority?: string;
  when_to_use?: string;
  description?: string;
  title?: string;
}

interface Prompt {
  id: string;
  file_id: string;
  name: string;
  path: string;
  category: string;
  metadata: PromptMetadata;
  preview: string;
}

interface PromptIndex {
  version: string;
  last_updated: string;
  categories: Record<string, { path: string; description: string }>;
  prompts: Record<string, Prompt>;
  tags: Record<string, string[]>;
  stats: { total: number; by_category: Record<string, number> };
}

// Load the prompt index
function loadIndex(): PromptIndex | null {
  try {
    if (existsSync(INDEX_PATH)) {
      const content = readFileSync(INDEX_PATH, 'utf-8');
      return JSON.parse(content);
    }
  } catch (e) {
    // Return null if index doesn't exist or can't be parsed
  }
  return null;
}

// Get prompt content by ID
function getPromptContent(prompt: Prompt): string {
  try {
    const fullPath = join(PROMPT_LIB_PATH, prompt.path);
    if (existsSync(fullPath)) {
      return readFileSync(fullPath, 'utf-8');
    }
  } catch (e) {
    // Return empty string if file can't be read
  }
  return '';
}

// Tool definitions
const TOOL_DEFINITIONS = [
  {
    name: 'list_prompts',
    description: 'List all prompts in the library with pagination. Returns ID, name, category, role for each prompt.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['autonomous', 'legacyai', 'skills', 'templates', 'reference'],
          description: 'Optional category filter (default: show all)'
        },
        page: {
          type: 'number',
          description: 'Page number (default: 1)',
          default: 1
        },
        page_size: {
          type: 'number',
          description: 'Results per page (default: 20)',
          default: 20
        },
        format: {
          type: 'string',
          enum: ['table', 'json'],
          description: 'Output format (default: table)',
          default: 'table'
        }
      }
    }
  },
  {
    name: 'get_prompt',
    description: 'Get the full content of a specific prompt by ID. Accepts short IDs like A01, L01, S01 or full IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Prompt ID (e.g., A01, L05, S12, T01) or full ID'
        },
        include_frontmatter: {
          type: 'boolean',
          description: 'Include YAML frontmatter in output (default: false)',
          default: false
        }
      },
      required: ['id']
    }
  },
  {
    name: 'search_prompts',
    description: 'Search prompts by name, tag, role, or description. Returns matching prompts with full metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (searches name, role, tags, description)'
        },
        tag: {
          type: 'string',
          description: 'Filter by specific tag'
        },
        type: {
          type: 'string',
          description: 'Filter by type (agent, skill, etc.)'
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default: 20)',
          default: 20
        }
      }
    }
  },
  {
    name: 'list_chains',
    description: 'List all saved prompt chains. Chains are sequences of prompts executed in order.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'list_workflows',
    description: 'List all saved workflows. Workflows are DAGs of prompts with dependency resolution.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

// Create server
const server = new Server(
  {
    name: 'prompt-library-server',
    version: '2.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool handlers
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const argsTyped = args || {};
  const index = loadIndex();

  if (!index) {
    return {
      content: [{
        type: 'text',
        text: 'Error: Prompt Library index not found. Please run: cd "/Volumes/Storage/Prompt Library" && python3 promptlib.py --sync'
      }],
      isError: true
    };
  }

  try {
    switch (name) {
      case 'list_prompts': {
        const category = argsTyped.category as string;
        const format = argsTyped.format as string || 'table';
        const page = (argsTyped.page as number) || 1;
        const pageSize = (argsTyped.page_size as number) || 20;

        const allPrompts = Object.values(index.prompts).filter(p =>
          !category || p.category === category
        );

        const totalPages = Math.ceil(allPrompts.length / pageSize);
        const startIndex = (page - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const paginatedPrompts = allPrompts.slice(startIndex, endIndex);

        if (format === 'json') {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                total: allPrompts.length,
                page: page,
                pages: totalPages,
                page_size: pageSize,
                category: category || 'all',
                prompts: paginatedPrompts.map(p => ({
                  id: p.id,
                  name: p.name,
                  category: p.category,
                  role: p.metadata.role || '',
                  tags: p.metadata.tags_list || []
                }))
              }, null, 2)
            }]
          };
        }

        // Geometric box-drawing table with pagination
        const sortedPrompts = paginatedPrompts.sort((a, b) => a.id.localeCompare(b.id));
        const w = { id: 30, name: 28, cat: 11, role: 25 };

        const truncate = (str: string, n: number): string =>
          str.length > n ? str.substring(0, n - 1) + '…' : str.padEnd(n);

        const line = (left: string, mid: string, right: string) =>
          left + '─'.repeat(w.id) + mid + '─'.repeat(w.name) + mid + '─'.repeat(w.cat) + mid + '─'.repeat(w.role) + right + '\n';

        const row = (...cells: string[]) =>
          '│' + cells.map((c, i) => truncate(c, [w.id, w.name, w.cat, w.role][i])).join('│') + '│\n';

        let output = '\n';
        output += line('┌', '┬', '┐');
        output += row('ID', 'Name', 'Category', 'Role');
        output += line('├', '┼', '┤');

        for (const p of sortedPrompts) {
          output += row(p.id, p.name, p.category, p.metadata.role || '-');
        }

        output += line('└', '┴', '┘');

        // Pagination footer
        const startRow = startIndex + 1;
        const endRow = Math.min(endIndex, allPrompts.length);
        output += `\n  Page ${page}/${totalPages}  |  Rows ${startRow}-${endRow} of ${allPrompts.length}\n`;
        if (page > 1) output += `  "page": ${page - 1} ← prev  `;
        if (page < totalPages) output += `  "page": ${page + 1} → next`;
        output += '\n';

        return {
          content: [{ type: 'text', text: output }]
        };
      }

      case 'get_prompt': {
        const id = (argsTyped.id as string).toUpperCase();
        const includeFrontmatter = argsTyped.include_frontmatter as boolean ?? false;

        // Find prompt by ID
        let prompt = index.prompts[id];

        // Try to match by short ID prefix
        if (!prompt) {
          for (const [pid, p] of Object.entries(index.prompts)) {
            if (pid.startsWith(id) || pid.split(':')[1]?.startsWith(id.replace(/[^a-z0-9-]/gi, ''))) {
              prompt = p;
              break;
            }
          }
        }

        if (!prompt) {
          return {
            content: [{
              type: 'text',
              text: `Error: Prompt '${id}' not found. Use list_prompts to see available prompts.`
            }],
            isError: true
          };
        }

        let content = getPromptContent(prompt);

        // Strip frontmatter if requested
        if (!includeFrontmatter && content.startsWith('---')) {
          const end = content.indexOf('\n---\n', 4);
          if (end !== -1) {
            content = content.substring(end + 5);
          }
        }

        let output = '\n';
        // Fixed width header box
        const boxWidth = 79;
        const pad = (str: string, width: number): string => str.length > width ? str.substring(0, width - 1) + '…' : str.padEnd(width);
        output += '┌' + '─'.repeat(boxWidth - 2) + '┐\n';
        output += '│' + pad(prompt.name, boxWidth - 2) + '│\n';
        output += '├' + '─'.repeat(boxWidth - 2) + '┤\n';
        output += '│' + pad('ID: ' + prompt.id, boxWidth - 2) + '│\n';
        output += '│' + pad('Category: ' + prompt.category, boxWidth - 2) + '│\n';
        output += '│' + pad('File: ' + prompt.path, boxWidth - 2) + '│\n';
        output += '└' + '─'.repeat(boxWidth - 2) + '┘\n\n';
        output += content;

        return {
          content: [{ type: 'text', text: output }]
        };
      }

      case 'search_prompts': {
        const query = (argsTyped.query as string || '').toLowerCase();
        const tagFilter = (argsTyped.tag as string || '').toLowerCase();
        const typeFilter = (argsTyped.type as string || '').toLowerCase();
        const limit = (argsTyped.limit as number) || 20;

        const results: Prompt[] = [];

        for (const prompt of Object.values(index.prompts)) {
          const metadata = prompt.metadata;

          // Tag filter
          if (tagFilter) {
            const tags = metadata.tags_list || [];
            if (!tags.some(t => t.toLowerCase().includes(tagFilter))) {
              continue;
            }
          }

          // Type filter
          if (typeFilter && metadata.type?.toLowerCase() !== typeFilter) {
            continue;
          }

          // Query search
          if (query) {
            const searchable = [
              prompt.name,
              metadata.role || '',
              metadata.description || '',
              metadata.when_to_use || '',
              metadata.tags || '',
              prompt.id
            ].join(' ').toLowerCase();

            if (!searchable.includes(query)) {
              continue;
            }
          }

          results.push(prompt);
        }

        const limited = results.slice(0, limit);

        // Geometric alignment - fixed widths
        const w = { id: 30, name: 28, cat: 11, tags: 20 };

        const truncate = (str: string, n: number): string =>
          str.length > n ? str.substring(0, n - 1) + '…' : str.padEnd(n);

        const line = (left: string, mid: string, right: string) =>
          left + '─'.repeat(w.id) + mid + '─'.repeat(w.name) + mid + '─'.repeat(w.cat) + mid + '─'.repeat(w.tags) + right + '\n';

        const row = (...cells: string[]) =>
          '│' + cells.map((c, i) => truncate(c, [w.id, w.name, w.cat, w.tags][i])).join('│') + '│\n';

        let output = '\n';
        output += line('┌', '┬', '┐');
        output += row('ID', 'Name', 'Category', 'Tags');
        output += line('├', '┼', '┤');

        for (const p of limited) {
          const tags = (p.metadata.tags_list || []).slice(0, 2).join(', ');
          output += row(p.id, p.name, p.category, tags || '-');
        }

        output += line('└', '┴', '┘');

        if (results.length > limit) {
          output += `\n...and ${results.length - limit} more results (use --limit to show more)\n`;
        }
        output += `\nFound: ${results.length} results\n`;

        return {
          content: [{ type: 'text', text: output }]
        };
      }

      case 'list_chains': {
        const { readFileSync, existsSync } = await import('fs');
        const { join } = await import('path');
        const CHAINS_PATH = join(PROMPT_LIB_PATH, '.promptlib', 'chains.json');

        if (!existsSync(CHAINS_PATH)) {
          return {
            content: [{
              type: 'text',
              text: 'No chains found. Use the HTTP API to create chains:\n  POST /api/chains\n\nExample body:\n{\n  "name": "My Chain",\n  "description": "A sequence of prompts",\n  "steps": [\n    {"prompt_id": "A1", "order": 1},\n    {"prompt_id": "A2", "order": 2}\n  ]\n}'
            }]
          };
        }

        const chainsData = readFileSync(CHAINS_PATH, 'utf-8');
        const chains = JSON.parse(chainsData);

        if (Object.keys(chains).length === 0) {
          return {
            content: [{ type: 'text', text: 'No chains configured.' }]
          };
        }

        const w = { id: 40, name: 25, steps: 10 };
        const truncate = (str: string, n: number): string =>
          str.length > n ? str.substring(0, n - 1) + '…' : str.padEnd(n);
        const line = (left: string, mid: string, right: string) =>
          left + '─'.repeat(w.id) + mid + '─'.repeat(w.name) + mid + '─'.repeat(w.steps) + right + '\n';
        const row = (...cells: string[]) =>
          '│' + cells.map((c, i) => truncate(c, [w.id, w.name, w.steps][i])).join('│') + '│\n';

        let output = '\n';
        output += line('┌', '┬', '┐');
        output += row('ID', 'Name', 'Steps');
        output += line('├', '┼', '┤');

        for (const chain of Object.values(chains) as any[]) {
          output += row(chain.id, chain.name, String(chain.steps.length));
        }

        output += line('└', '┴', '┘');
        output += `\nTotal: ${Object.keys(chains).length} chain(s)\n`;

        return {
          content: [{ type: 'text', text: output }]
        };
      }

      case 'list_workflows': {
        const { readFileSync, existsSync } = await import('fs');
        const { join } = await import('path');
        const WORKFLOWS_PATH = join(PROMPT_LIB_PATH, '.promptlib', 'workflows.json');

        if (!existsSync(WORKFLOWS_PATH)) {
          return {
            content: [{
              type: 'text',
              text: 'No workflows found. Use the HTTP API to create workflows:\n  POST /api/workflows\n\nExample body:\n{\n  "name": "My Workflow",\n  "nodes": [\n    {"id": "node1", "prompt_id": "A1", "dependencies": []},\n    {"id": "node2", "prompt_id": "A2", "dependencies": ["node1"]}\n  ]\n}'
            }]
          };
        }

        const workflowsData = readFileSync(WORKFLOWS_PATH, 'utf-8');
        const workflows = JSON.parse(workflowsData);

        if (Object.keys(workflows).length === 0) {
          return {
            content: [{ type: 'text', text: 'No workflows configured.' }]
          };
        }

        const w = { id: 40, name: 25, nodes: 10 };
        const truncate = (str: string, n: number): string =>
          str.length > n ? str.substring(0, n - 1) + '…' : str.padEnd(n);
        const line = (left: string, mid: string, right: string) =>
          left + '─'.repeat(w.id) + mid + '─'.repeat(w.name) + mid + '─'.repeat(w.nodes) + right + '\n';
        const row = (...cells: string[]) =>
          '│' + cells.map((c, i) => truncate(c, [w.id, w.name, w.nodes][i])).join('│') + '│\n';

        let output = '\n';
        output += line('┌', '┬', '┐');
        output += row('ID', 'Name', 'Nodes');
        output += line('├', '┼', '┤');

        for (const workflow of Object.values(workflows) as any[]) {
          output += row(workflow.id, workflow.name, String(workflow.nodes.length));
        }

        output += line('└', '┴', '┘');
        output += `\nTotal: ${Object.keys(workflows).length} workflow(s)\n`;

        return {
          content: [{ type: 'text', text: output }]
        };
      }

      default:
        throw new Error('Unknown tool: ' + name);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: errorMessage }) }],
      isError: true
    };
  }
});

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOL_DEFINITIONS
  };
});

// Start server
async function main() {
  const promises: Promise<void>[] = [];

  // Always start stdio transport for MCP
  const stdioTransport = new StdioServerTransport();
  promises.push(server.connect(stdioTransport));

  // Optionally start HTTP server
  if (ENABLE_HTTP) {
    const httpServer = new HttpServer(HTTP_PORT);
    promises.push(httpServer.start());
  }

  await Promise.all(promises);

  console.error('MCP Prompt Library Server running');
  console.error('Reading from:', PROMPT_LIB_PATH);

  if (ENABLE_HTTP) {
    console.error(`HTTP Server: http://localhost:${HTTP_PORT}`);
    console.error(`WebSocket: ws://localhost:${HTTP_PORT}/api/ws`);
  }
}

main().catch(console.error);
