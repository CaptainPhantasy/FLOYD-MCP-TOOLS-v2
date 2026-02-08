#!/usr/bin/env node

/**
 * MCP Gemini Tools Server
 *
 * Three specialized tools for solo developers:
 * - dependency_hologram: Visualize hidden coupling between files/modules
 * - failure_to_test_transmuter: Convert runtime failures into permanent regression tests
 * - trace_replay_debugger: Create standalone tests from execution traces
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper to find files
function findFiles(dir: string, pattern: RegExp, maxDepth = 10): string[] {
  const results: string[] = [];

  function scan(currentDir: string, depth = 0) {
    if (depth > maxDepth) return;

    try {
      const entries = readdirSync(currentDir);
      for (const entry of entries) {
        const fullPath = join(currentDir, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory() && !entry.startsWith('.') && entry !== 'node_modules') {
          scan(fullPath, depth + 1);
        } else if (stat.isFile() && pattern.test(entry)) {
          results.push(fullPath);
        }
      }
    } catch (e) {
      // Skip directories we can't read
    }
  }

  scan(dir);
  return results;
}

// Helper to extract imports from a file
function extractImports(filePath: string): { imports: string[]; stringLiterals: string[] } {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const imports: string[] = [];
    const stringLiterals: string[] = [];

    // Extract import statements - simpler patterns
    const importPatterns = [
      /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
      /import\s+['"]([^'"]+)['"]/g
    ];
    for (const pattern of importPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        if (!imports.includes(match[1])) {
          imports.push(match[1]);
        }
      }
    }

    // Extract require statements
    const requireRegex = /require\(['"]([^'"]+)['"]\)/g;
    let match;
    while ((match = requireRegex.exec(content)) !== null) {
      if (!imports.includes(match[1])) {
        imports.push(match[1]);
      }
    }

    // Extract string literals (potential config keys, API endpoints)
    const stringRegex = /["']([A-Za-z_][A-Za-z0-9_]*(?:\.|\/)[A-Za-z0-9_\/\.-]*)["']/g;
    while ((match = stringRegex.exec(content)) !== null) {
      const str = match[1];
      // Filter for likely config keys or API-like strings
      if (str.includes('.') || str.includes('/') || str.length > 5) {
        stringLiterals.push(str);
      }
    }

    return { imports, stringLiterals };
  } catch (e) {
    return { imports: [], stringLiterals: [] };
  }
}

// Tool definitions
const TOOL_DEFINITIONS = [
  {
    name: 'dependency_hologram',
    description: 'Quantifies and visualizes coupling between files/modules, revealing hidden dependencies',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'File or directory to analyze'
        },
        depth: {
          type: 'number',
          description: 'Dependency depth to traverse',
          default: 5
        },
        include_hidden: {
          type: 'boolean',
          description: 'Include string literal and config dependencies',
          default: true
        },
        output_format: {
          type: 'string',
          enum: ['text', 'json', 'dot'],
          default: 'text'
        }
      },
      required: ['target']
    }
  },
  {
    name: 'failure_to_test_transmuter',
    description: 'Converts runtime failures into permanent regression tests',
    inputSchema: {
      type: 'object',
      properties: {
        crash_data: {
          type: 'object',
          description: 'Crash context (stack trace, error, input)'
        },
        test_framework: {
          type: 'string',
          enum: ['jest', 'vitest', 'mocha', 'pytest'],
          default: 'jest'
        },
        output_path: {
          type: 'string',
          description: 'Where to write the test file'
        }
      }
    }
  },
  {
    name: 'trace_replay_debugger',
    description: 'Creates standalone Jest tests from execution traces to reproduce bugs exactly',
    inputSchema: {
      type: 'object',
      properties: {
        trace_data: {
          type: 'object',
          description: 'Captured execution trace'
        },
        test_name: {
          type: 'string',
          description: 'Name for the generated test'
        },
        output_path: {
          type: 'string',
          description: 'Where to write the test'
        }
      }
    }
  }
];

// Create server
const server = new Server(
  {
    name: 'gemini-tools-server',
    version: '1.0.0',
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

  try {
    switch (name) {
      case 'dependency_hologram': {
        const target = argsTyped.target as string;
        const depth = (argsTyped.depth as number) || 5;
        const includeHidden = argsTyped.include_hidden as boolean ?? true;
        const outputFormat = argsTyped.output_format as string || 'text';

        const targetPath = resolve(process.cwd(), target);
        const isDirectory = statSync(targetPath).isDirectory();

        const filesToAnalyze = isDirectory
          ? findFiles(targetPath, /\.(ts|js|tsx|jsx|json)$/, depth)
          : [targetPath];

        const results: any[] = [];

        for (const filePath of filesToAnalyze) {
          const relativePath = filePath.replace(process.cwd() + '/', '');
          const { imports, stringLiterals } = extractImports(filePath);

          // Calculate coupling metrics
          const incoming = 0; // Would require monorepo analysis
          const outgoing = imports.length;
          const hiddenCount = stringLiterals.length;
          const couplingWeight = Math.min(((incoming + outgoing) * 3) + (hiddenCount * 5), 100);

          results.push({
            file: relativePath,
            coupling_weight: couplingWeight,
            incoming_coupling: incoming,
            outgoing_coupling: outgoing,
            hidden_dependencies: stringLiterals.slice(0, 10)
          });
        }

        if (outputFormat === 'json') {
          return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
          };
        }

        if (outputFormat === 'dot') {
          let dot = 'digraph DependencyHologram {\n';
          dot += '  rankdir=LR;\n  node [shape=box];\n';
          for (const r of results) {
            const node = '"' + r.file.replace(/[^a-zA-Z0-9]/g, '_') + '"';
            dot += '  ' + node + ' [label="' + r.file + '\\nCoupling: ' + r.coupling_weight + '%"];\n';
          }
          dot += '}\n';
          return { content: [{ type: 'text', text: dot }] };
        }

        // Default text format
        let output = '╔══════════════════════════════════════════════════════════════════╗\n';
        output += '║               DEPENDENCY HOLOGRAM                           ║\n';
        output += '╠══════════════════════════════════════════════════════════════════╣\n';

        for (const r of results) {
          const weight = r.coupling_weight;
          const bar = '█'.repeat(Math.floor(weight / 5)) + '░'.repeat(20 - Math.floor(weight / 5));

          output += '║  ' + r.file.substring(0, 50).padEnd(50) + '                      ║\n';
          output += '║  Coupling Weight: ' + bar + ' ' + weight.toString().padStart(3) + '%              ║\n';
          output += '║  Outgoing: ' + r.outgoing_coupling + ' | Hidden: ' + r.hidden_dependencies.length + '            ║\n';

          if (r.hidden_dependencies.length > 0) {
            output += '║  Hidden Deps: ' + r.hidden_dependencies.slice(0, 3).join(', ') + (r.hidden_dependencies.length > 3 ? '...' : '') + '           ║\n';
          }
          output += '╟───────────────────────────────────────────────────────────────╢\n';
        }
        output += '╚══════════════════════════════════════════════════════════════════╝\n';

        return { content: [{ type: 'text', text: output }] };
      }

      case 'failure_to_test_transmuter': {
        const crashData = argsTyped.crash_data as any;
        const framework = (argsTyped.test_framework as string) || 'jest';

        if (!crashData) {
          return {
            content: [{
              type: 'text',
              text: 'Error: crash_data is required. Provide the crash context including error message, stack trace, and input state.'
            }],
            isError: true
          };
        }

        const error = crashData.error_message || 'Unknown Error';
        const file = crashData.file_path || 'unknown';
        const line = crashData.line_number || 0;
        const functionName = crashData.function_name || 'function';

        let testCode = '';

        if (framework === 'jest' || framework === 'vitest') {
          testCode = '/**\n';
          testCode += ' * Auto-generated regression test from crash\n';
          testCode += ' * Generated: ' + new Date().toISOString() + '\n';
          testCode += ' * Error: ' + error + '\n';
          testCode += ' */\n\n';
          testCode += "import { " + functionName + " } from '../" + file.split('/').slice(-2).join('/') + "';\n\n";
          testCode += "describe('Bug Regression: " + error.substring(0, 50) + "', () => {\n";
          testCode += "  it('should not throw the error that occurred during production', async () => {\n";
          testCode += '    // Reconstruction of input state that caused the crash\n';
          testCode += '    const crashInput = ' + JSON.stringify(crashData.input_state || null, null, 2) + ';\n\n';
          testCode += '    // Setup environment state at time of crash\n';
          const envEntries = Object.entries(crashData.environment || {});
          if (envEntries.length > 0) {
            testCode += envEntries.map(([k, v]) =>
              '    process.env.' + k + ' = ' + JSON.stringify(v) + ';'
            ).join('\n');
            testCode += '\n';
          }
          testCode += '    // This should reproduce the exact failure\n';
          testCode += '    expect(async () => {\n';
          testCode += '      ' + (functionName ? 'await ' + functionName + '(crashInput);' : '// Function call to reproduce') + '\n';
          testCode += "    }).rejects.toThrow('" + error + "');\n";
          testCode += '  });\n';
          testCode += '});\n';
        } else if (framework === 'mocha') {
          testCode = '/**\n';
          testCode += ' * Auto-generated regression test from crash\n';
          testCode += ' * Generated: ' + new Date().toISOString() + '\n';
          testCode += ' * Error: ' + error + '\n';
          testCode += ' */\n\n';
          testCode += "import { expect } from 'chai';\n";
          testCode += "import { " + functionName + " } from '../" + file.split('/').slice(-2).join('/') + "';\n\n";
          testCode += "describe('Bug Regression: " + error.substring(0, 50) + "', () => {\n";
          testCode += "  it('should not throw the error that occurred during production', async () => {\n";
          testCode += '    const crashInput = ' + JSON.stringify(crashData.input_state || null, null, 2) + ';\n\n';
          testCode += '    // Setup environment\n';
          const envEntries = Object.entries(crashData.environment || {});
          if (envEntries.length > 0) {
            testCode += envEntries.map(([k, v]) =>
              '    process.env.' + k + ' = ' + JSON.stringify(v) + ';'
            ).join('\n');
            testCode += '\n';
          }
          testCode += '    // This should reproduce the exact failure\n';
          testCode += '    try {\n';
          testCode += '      ' + (functionName ? 'await ' + functionName + '(crashInput);' : '// Function call') + '\n';
          testCode += "      throw new Error('Expected error was not thrown');\n";
          testCode += '    } catch (err) {\n';
          testCode += "      expect(err.message).to.include('" + error + "');\n";
          testCode += '    }\n';
          testCode += '  });\n';
          testCode += '});\n';
        } else if (framework === 'pytest') {
          // Use escaped triple quotes for Python
          testCode = '"""\n';
          testCode += 'Auto-generated regression test from crash\n';
          testCode += 'Generated: ' + new Date().toISOString() + '\n';
          testCode += 'Error: ' + error + '\n';
          testCode += '"""\n\n';
          testCode += 'import pytest\n';
          testCode += 'import os\n\n';
          const moduleName = file.replace(/\//g, '.').replace('.ts', '').replace('.js', '');
          testCode += 'from ' + moduleName + ' import ' + functionName + '\n\n';
          const testName = 'test_regression_' + error.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_error';
          testCode += 'def ' + testName + '():\n';
          testCode += '    """Regression test for: ' + error + '"""\n';
          testCode += '    # Setup environment\n';
          const envEntries = Object.entries(crashData.environment || {});
          if (envEntries.length > 0) {
            testCode += envEntries.map(([k, v]) =>
              "    os.environ[\"" + k + "\"] = " + JSON.stringify(v)
            ).join('\n');
            testCode += '\n';
          }
          testCode += '    crash_input = ' + JSON.stringify(crashData.input_state || {}, null, 2) + '\n\n';
          testCode += '    # This should reproduce the exact failure\n';
          testCode += '    with pytest.raises(Exception) as exc_info:\n';
          testCode += '        ' + (functionName ? functionName + '(crash_input)' : '# Function call') + '\n\n';
          testCode += "    assert exc_info.match(r'.*' + error + '.*')\n";
        }

        const outputPath = argsTyped.output_path || 'regression_' + Date.now() + '.' + (framework === 'jest' ? 'test.ts' : framework === 'mocha' ? 'test.js' : 'py');

        return {
          content: [
            { type: 'text', text: 'Generated test for error: ' + error },
            { type: 'text', text: 'Framework: ' + framework },
            { type: 'text', text: 'Output path: ' + outputPath },
            { type: 'text', text: '\n--- Test Code ---\n' },
            { type: 'text', text: testCode }
          ]
        };
      }

      case 'trace_replay_debugger': {
        const traceData = argsTyped.trace_data as any;
        const testName = argsTyped.test_name as string || 'replay_test';
        const outputPath = argsTyped.output_path || 'replay_' + Date.now() + '.test.ts';

        if (!traceData) {
          return {
            content: [{
              type: 'text',
              text: 'Error: trace_data is required. Provide the execution trace including call stack, input/output state, and error details.'
            }],
            isError: true
          };
        }

        const callStack = traceData.call_stack || [];
        const functionName = callStack[0]?.function_name || 'function';
        const filePath = callStack[0]?.file_path || 'module';
        const importPath = filePath.split('/').slice(-2).join('/');
        const errorMessage = traceData.error?.error_message || 'Error';

        // Build test code step by step to avoid template literal nesting issues
        let testCode = '/**\n';
        testCode += ' * Execution Replay Test\n';
        testCode += ' * Generated: ' + new Date().toISOString() + '\n';
        testCode += ' * Trace ID: ' + (traceData.trace_id || 'unknown') + '\n';
        testCode += ' */\n\n';
        testCode += "import { " + functionName + " } from './" + importPath + "';\n\n";
        testCode += "describe('" + testName + ": Execution Replay', () => {\n";
        testCode += "  it('reproduces the exact execution state', async () => {\n";
        testCode += '    // Reconstruct input state from trace\n';
        testCode += '    const inputState = ' + JSON.stringify(traceData.input_state || {}, null, 2) + ';\n\n';
        testCode += '    // Reconstruct environment from trace\n';
        const envLines = Object.entries(traceData.environment || {})
          .filter(([k]) => k.startsWith('process.env.'))
          .map(([k, v]) => '    process.env["' + k.slice(12) + '"] = ' + JSON.stringify(v) + ';');
        if (envLines.length > 0) {
          testCode += envLines.join('\n') + '\n';
        } else {
          testCode += '    // No environment variables to set\n';
        }
        testCode += '\n';
        testCode += '    // Execute the original function call\n';
        const inputKeys = Object.keys(traceData.input_state || {});
        testCode += '    const result = ' + functionName + '(' + inputKeys.join(', ') + ');\n\n';
        testCode += '    // Validate the error matches (if there was one)\n';
        if (traceData.error) {
          testCode += "    await expect(result).rejects.toThrow('" + errorMessage + "');\n";
        } else {
          testCode += '    const expectedOutput = ' + JSON.stringify(traceData.output_state || {}, null, 2) + ';\n';
          testCode += '    await expect(result).toEqual(expectedOutput);\n';
        }
        testCode += '  });\n';
        testCode += '});\n';

        return {
          content: [
            { type: 'text', text: 'Generated replay test: ' + testName },
            { type: 'text', text: 'Trace ID: ' + (traceData.trace_id || 'unknown') },
            { type: 'text', text: 'Timestamp: ' + (traceData.timestamp || new Date().toISOString()) },
            { type: 'text', text: 'Output path: ' + outputPath },
            { type: 'text', text: '\n--- Test Code ---\n' },
            { type: 'text', text: testCode }
          ]
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
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP Gemini Tools Server running');
}

main().catch(console.error);
