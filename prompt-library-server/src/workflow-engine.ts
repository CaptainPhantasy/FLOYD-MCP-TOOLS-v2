/**
 * Workflow Engine Module
 *
 * Executes workflows defined as directed acyclic graphs (DAGs).
 * Implements topological sort for dependency resolution and parallel execution.
 *
 * Features:
 * - Topological sort for DAG execution order
 * - Parallel execution of independent nodes
 * - Variable substitution with dependency output
 * - Cycle detection
 * - Progress tracking and error recovery
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Prompt Library Configuration
const PROMPT_LIB_PATH = '/Volumes/Storage/Prompt Library';
const INDEX_PATH = join(PROMPT_LIB_PATH, '.promptlib', 'index.json');

// Types
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

interface WorkflowNode {
  id: string;
  prompt_id: string;
  dependencies: string[];
  variables?: Record<string, string>;
  continue_on_error?: boolean;
}

interface Workflow {
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  created_at: string;
  updated_at: string;
}

interface WorkflowExecutionOptions {
  variables?: Record<string, string>;
  parallel?: boolean;
  maxConcurrency?: number;
  timeout?: number;
  onProgress?: (completed: number, total: number, result: WorkflowNodeResult) => void;
  onNodeStart?: (node: WorkflowNode) => void;
  onNodeComplete?: (node: WorkflowNode, result: WorkflowNodeResult) => void;
  onError?: (node: WorkflowNode, error: Error) => void;
}

interface WorkflowNodeResult {
  node_id: string;
  prompt_id: string;
  prompt_name: string;
  content: string;
  variables_used: Record<string, string>;
  inputs_from: string[];
  error?: string;
  duration_ms: number;
  started_at: string;
  completed_at: string;
}

interface WorkflowExecutionResult {
  workflow_id: string;
  workflow_name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'partial';
  results: WorkflowNodeResult[];
  started_at: string;
  completed_at?: string;
  duration_ms: number;
  nodes_succeeded: number;
  nodes_failed: number;
  execution_order: string[][];
}

// ============================================================================
// WORKFLOW ENGINE CLASS
// ============================================================================

export class WorkflowEngine {
  private index: PromptIndex | null = null;

  constructor() {
    this.loadIndex();
  }

  private loadIndex(): void {
    try {
      if (existsSync(INDEX_PATH)) {
        const content = readFileSync(INDEX_PATH, 'utf-8');
        this.index = JSON.parse(content);
      }
    } catch (e) {
      console.error('Failed to load prompt index:', e);
    }
  }

  private getIndex(): PromptIndex | null {
    if (!this.index) {
      this.loadIndex();
    }
    return this.index;
  }

  private getPromptContent(prompt: Prompt): string {
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

  private stripFrontmatter(content: string): string {
    if (content.startsWith('---')) {
      const end = content.indexOf('\n---\n', 4);
      if (end !== -1) {
        return content.substring(end + 5);
      }
    }
    return content;
  }

  private findPrompt(id: string): Prompt | null {
    const index = this.getIndex();
    if (!index) return null;

    let prompt = index.prompts[id];

    // Try to match by short ID prefix
    if (!prompt) {
      const upperId = id.toUpperCase();
      for (const [pid, p] of Object.entries(index.prompts)) {
        if (pid.startsWith(upperId) || pid.split(':')[1]?.startsWith(upperId.replace(/[^a-z0-9-]/gi, ''))) {
          prompt = p;
          break;
        }
      }
    }

    return prompt || null;
  }

  private substituteVariables(
    content: string,
    variables: Record<string, string>
  ): string {
    let result = content;

    // Support {{variable}} syntax
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }

    // Support ${variable} syntax
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
    }

    return result;
  }

  /**
   * Perform topological sort on workflow nodes
   * Returns an array of arrays, where each inner array contains nodes that can be executed in parallel
   */
  public topologicalSort(nodes: WorkflowNode[]): string[][] | null {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>();

    // Initialize in-degrees and adjacency list
    for (const node of nodes) {
      inDegree.set(node.id, node.dependencies.length);
      adjList.set(node.id, []);
    }

    // Build adjacency list (reverse dependencies - who depends on me?)
    for (const node of nodes) {
      for (const dep of node.dependencies) {
        adjList.get(dep)?.push(node.id);
      }
    }

    // Kahn's algorithm with level detection
    const levels: string[][] = [];
    const visited = new Set<string>();
    let currentLevel: string[] = [];

    // Start with nodes that have no dependencies
    for (const [id, degree] of inDegree) {
      if (degree === 0) {
        currentLevel.push(id);
        visited.add(id);
      }
    }

    while (currentLevel.length > 0) {
      levels.push(currentLevel);
      const nextLevel: string[] = [];

      for (const id of currentLevel) {
        for (const neighbor of adjList.get(id) || []) {
          const newDegree = (inDegree.get(neighbor) || 0) - 1;
          inDegree.set(neighbor, newDegree);

          if (newDegree === 0 && !visited.has(neighbor)) {
            nextLevel.push(neighbor);
            visited.add(neighbor);
          }
        }
      }

      currentLevel = nextLevel;
    }

    // Check for cycle
    if (visited.size !== nodes.length) {
      return null;
    }

    return levels;
  }

  /**
   * Detect cycles in the workflow graph
   */
  public hasCycle(nodes: WorkflowNode[]): boolean {
    const nodeSet = new Set(nodes.map(n => n.id));
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (nodeId: string): boolean => {
      if (recursionStack.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;

      visited.add(nodeId);
      recursionStack.add(nodeId);

      const node = nodes.find(n => n.id === nodeId);
      if (node) {
        for (const dep of node.dependencies) {
          if (nodeSet.has(dep) && dfs(dep)) {
            return true;
          }
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const node of nodes) {
      if (dfs(node.id)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Validate a workflow before execution
   */
  public validateWorkflow(workflow: Workflow): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const index = this.getIndex();

    if (!index) {
      errors.push('Prompt index not available');
      return { valid: false, errors, warnings };
    }

    // Check that nodes are present
    if (!workflow.nodes || workflow.nodes.length === 0) {
      errors.push('Workflow must have at least one node');
    }

    // Check for duplicate node IDs
    const nodeIds = workflow.nodes.map(n => n.id);
    const uniqueIds = new Set(nodeIds);
    if (nodeIds.length !== uniqueIds.size) {
      errors.push('Duplicate node IDs detected');
    }

    // Validate each node
    const nodeSet = new Set(nodeIds);

    for (const node of workflow.nodes) {
      // Check prompt exists
      const prompt = this.findPrompt(node.prompt_id);
      if (!prompt) {
        errors.push(`Node '${node.id}': Prompt '${node.prompt_id}' not found`);
      }

      // Check dependencies exist
      for (const dep of node.dependencies) {
        if (!nodeSet.has(dep)) {
          errors.push(`Node '${node.id}': Dependency '${dep}' not found in workflow`);
        }
      }
    }

    // Check for cycles
    if (this.hasCycle(workflow.nodes)) {
      errors.push('Workflow contains circular dependencies');
    }

    // Check for self-dependencies
    for (const node of workflow.nodes) {
      if (node.dependencies.includes(node.id)) {
        errors.push(`Node '${node.id}' cannot depend on itself`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Execute a single workflow node
   */
  private async executeNode(
    node: WorkflowNode,
    globalVars: Record<string, string>,
    dependencyResults: Map<string, WorkflowNodeResult>,
    options: WorkflowExecutionOptions
  ): Promise<WorkflowNodeResult> {
    const startTime = Date.now();
    const startedAt = new Date().toISOString();

    options.onNodeStart?.(node);

    const result: WorkflowNodeResult = {
      node_id: node.id,
      prompt_id: node.prompt_id,
      prompt_name: 'Unknown',
      content: '',
      variables_used: { ...globalVars, ...node.variables },
      inputs_from: node.dependencies,
      error: undefined,
      duration_ms: 0,
      started_at: startedAt,
      completed_at: startedAt,
    };

    try {
      // Find and load prompt
      const prompt = this.findPrompt(node.prompt_id);
      if (!prompt) {
        throw new Error(`Prompt '${node.prompt_id}' not found`);
      }

      result.prompt_name = prompt.name;
      let content = this.getPromptContent(prompt);

      // Strip frontmatter
      content = this.stripFrontmatter(content);

      // Build variables from dependencies
      const dependencyVars: Record<string, string> = {};
      for (const depId of node.dependencies) {
        const depResult = dependencyResults.get(depId);
        if (depResult && !depResult.error) {
          dependencyVars[`${depId}_result`] = depResult.content;
          dependencyVars[`${depId}_output`] = depResult.content;
        }
      }

      // Merge all variables
      const mergedVars = {
        ...globalVars,
        ...dependencyVars,
        ...node.variables,
      };

      result.variables_used = mergedVars;

      // Apply variable substitution
      content = this.substituteVariables(content, mergedVars);

      result.content = content;
      result.duration_ms = Date.now() - startTime;
      result.completed_at = new Date().toISOString();

      options.onProgress?.(
        dependencyResults.size + 1,
        dependencyResults.size + 1,
        result
      );
      options.onNodeComplete?.(node, result);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.error = errorMessage;
      result.duration_ms = Date.now() - startTime;
      result.completed_at = new Date().toISOString();

      options.onError?.(node, error as Error);
    }

    return result;
  }

  /**
   * Execute nodes in parallel with concurrency limit
   */
  private async executeNodesParallel(
    nodes: WorkflowNode[],
    globalVars: Record<string, string>,
    dependencyResults: Map<string, WorkflowNodeResult>,
    options: WorkflowExecutionOptions,
    maxConcurrency: number = 4
  ): Promise<WorkflowNodeResult[]> {
    const results: WorkflowNodeResult[] = [];
    const executing: Promise<WorkflowNodeResult>[] = [];

    for (const node of nodes) {
      const promise = this.executeNode(node, globalVars, dependencyResults, options);
      executing.push(promise);

      // Wait if we've reached max concurrency
      if (executing.length >= maxConcurrency) {
        const result = await Promise.race(executing);
        results.push(result);
        // Remove the completed promise from the array
        const index = executing.indexOf(promise);
        if (index > -1) {
          executing.splice(index, 1);
        }
      }
    }

    // Wait for remaining executions
    const remaining = await Promise.all(executing);
    results.push(...remaining);

    return results;
  }

  /**
   * Execute a workflow
   */
  public async execute(
    workflow: Workflow,
    options: WorkflowExecutionOptions = {}
  ): Promise<WorkflowExecutionResult> {
    const startTime = Date.now();

    // Validate workflow first
    const validation = this.validateWorkflow(workflow);
    if (!validation.valid) {
      throw new Error(`Workflow validation failed: ${validation.errors.join(', ')}`);
    }

    // Get topological levels
    const levels = this.topologicalSort(workflow.nodes);
    if (!levels) {
      throw new Error('Workflow contains circular dependencies');
    }

    const nodeMap = new Map(workflow.nodes.map(n => [n.id, n]));
    const allResults = new Map<string, WorkflowNodeResult>();
    const executionOrder: string[][] = levels;
    const globalVars = options.variables || {};
    const parallel = options.parallel !== false;
    const maxConcurrency = options.maxConcurrency || 4;

    const result: WorkflowExecutionResult = {
      workflow_id: workflow.id,
      workflow_name: workflow.name,
      status: 'running',
      results: [],
      started_at: new Date().toISOString(),
      duration_ms: 0,
      nodes_succeeded: 0,
      nodes_failed: 0,
      execution_order: executionOrder,
    };

    try {
      // Execute each level
      for (const level of levels) {
        const nodesInLevel = level.map(id => nodeMap.get(id)!).filter(Boolean);

        let levelResults: WorkflowNodeResult[];

        if (parallel && nodesInLevel.length > 1) {
          // Execute level in parallel
          levelResults = await this.executeNodesParallel(
            nodesInLevel,
            globalVars,
            allResults,
            options,
            maxConcurrency
          );
        } else {
          // Execute level sequentially
          levelResults = [];
          for (const node of nodesInLevel) {
            const nodeResult = await this.executeNode(
              node,
              globalVars,
              allResults,
              options
            );
            levelResults.push(nodeResult);

            // Check if we should stop on error
            if (nodeResult.error && !node.continue_on_error) {
              allResults.set(node.id, nodeResult);
              throw new Error(`Node '${node.id}' failed: ${nodeResult.error}`);
            }
          }
        }

        // Store results
        for (const nodeResult of levelResults) {
          allResults.set(nodeResult.node_id, nodeResult);
        }
      }

      // Process all results
      for (const nodeResult of allResults.values()) {
        result.results.push(nodeResult);
        if (nodeResult.error) {
          result.nodes_failed++;
        } else {
          result.nodes_succeeded++;
        }
      }

      result.status = result.nodes_failed > 0 ? 'partial' : 'completed';

    } catch (error) {
      result.status = 'failed';
      // Add partial results
      for (const nodeResult of allResults.values()) {
        result.results.push(nodeResult);
      }
    }

    result.completed_at = new Date().toISOString();
    result.duration_ms = Date.now() - startTime;

    return result;
  }

  /**
   * Execute a workflow and return formatted output
   */
  public async executeWithOutput(
    workflow: Workflow,
    options: WorkflowExecutionOptions = {}
  ): Promise<{ result: WorkflowExecutionResult; output: string }> {
    const result = await this.execute(workflow, options);

    // Generate formatted output
    let output = '';

    output += '┌' + '─'.repeat(79) + '┐\n';
    output += '│' + 'Workflow Execution Results'.padEnd(79) + '│\n';
    output += '├' + '─'.repeat(79) + '┤\n';
    output += '│' + `Workflow: ${result.workflow_name}`.padEnd(79) + '│\n';
    output += '│' + `Status: ${result.status.toUpperCase()}`.padEnd(79) + '│\n';
    output += '│' + `Duration: ${result.duration_ms}ms`.padEnd(79) + '│\n';
    output += '│' + `Nodes: ${result.nodes_succeeded}/${result.results.length} succeeded`.padEnd(79) + '│\n';
    output += '└' + '─'.repeat(79) + '┘\n\n';

    // Group results by execution level
    let resultIndex = 0;
    for (const level of result.execution_order) {
      output += `┌─ Level ${result.execution_order.indexOf(level) + 1} (${level.length} nodes) ─${'─'.repeat(55)}┐\n`;

      for (const nodeId of level) {
        const nodeResult = result.results.find(r => r.node_id === nodeId);
        if (!nodeResult) continue;

        const icon = nodeResult.error ? 'FAIL' : 'DONE';
        output += `│ [${icon}] ${nodeResult.node_id}: ${nodeResult.prompt_name}\n`;
        if (nodeResult.error) {
          output += `│       Error: ${nodeResult.error}\n`;
        }
        output += `│       Duration: ${nodeResult.duration_ms}ms\n`;

        if (nodeResult.inputs_from.length > 0) {
          output += `│       Inputs: ${nodeResult.inputs_from.join(', ')}\n`;
        }
      }

      output += '└' + '─'.repeat(79) + '┘\n\n';
      resultIndex += level.length;
    }

    return { result, output };
  }

  /**
   * Preview what a workflow execution would produce (dry run)
   */
  public async preview(
    workflow: Workflow,
    variables: Record<string, string> = {}
  ): Promise<{ valid: boolean; errors: string[]; preview: string }> {
    const validation = this.validateWorkflow(workflow);
    if (!validation.valid) {
      return { ...validation, preview: '' };
    }

    const levels = this.topologicalSort(workflow.nodes);
    if (!levels) {
      return {
        valid: false,
        errors: ['Circular dependencies detected'],
        preview: '',
      };
    }

    const nodeMap = new Map(workflow.nodes.map(n => [n.id, n]));
    let preview = '';

    preview += '┌' + '─'.repeat(79) + '┐\n';
    preview += '│' + 'Workflow Execution Preview'.padEnd(79) + '│\n';
    preview += '├' + '─'.repeat(79) + '┤\n';
    preview += '│' + `Workflow: ${workflow.name}`.padEnd(79) + '│\n';
    preview += '│' + `Nodes: ${workflow.nodes.length}`.padEnd(79) + '│\n';
    preview += '│' + `Levels: ${levels.length} (parallel execution stages)`.padEnd(79) + '│\n';
    preview += '└' + '─'.repeat(79) + '┘\n\n';

    for (const level of levels) {
      const levelNum = levels.indexOf(level) + 1;
      preview += `┌─ Level ${levelNum} (${level.length} nodes, can run in parallel) ─${'─'.repeat(35)}┐\n`;

      for (const nodeId of level) {
        const node = nodeMap.get(nodeId)!;
        const prompt = this.findPrompt(node.prompt_id);
        const promptName = prompt?.name || 'Unknown';

        preview += `│\n`;
        preview += `│ Node: ${node.id}\n`;
        preview += `│   Prompt: ${node.prompt_id}\n`;
        preview += `│   Name: ${promptName}\n`;

        if (node.dependencies.length > 0) {
          preview += `│   Depends on: ${node.dependencies.join(', ')}\n`;
        } else {
          preview += `│   Depends on: (none - can start immediately)\n`;
        }

        const mergedVars = { ...variables, ...node.variables };
        const varsList = Object.keys(mergedVars).length > 0
          ? Object.entries(mergedVars).map(([k, v]) => `${k}=${v.substring(0, 20)}`).join(', ')
          : '(none)';
        preview += `│   Variables: ${varsList}\n`;
      }

      preview += '│\n';
      preview += '└' + '─'.repeat(79) + '┘\n\n';
    }

    return {
      valid: true,
      errors: [],
      preview,
    };
  }

  /**
   * Export workflow execution results to JSON
   */
  public exportResults(result: WorkflowExecutionResult): string {
    return JSON.stringify(result, null, 2);
  }

  /**
   * Import workflow execution results from JSON
   */
  public importResults(json: string): WorkflowExecutionResult {
    return JSON.parse(json);
  }

  /**
   * Generate a visual DAG representation of the workflow
   */
  public generateDAG(workflow: Workflow): string {
    let dot = 'digraph Workflow {\n';
    dot += '  rankdir=LR;\n';
    dot += '  node [shape=box, style=rounded];\n\n';

    // Add nodes
    for (const node of workflow.nodes) {
      const prompt = this.findPrompt(node.prompt_id);
      const label = prompt?.name || node.prompt_id;
      dot += `  "${node.id}" [label="${node.id}\\n${label}"];\n`;
    }

    dot += '\n';

    // Add edges
    for (const node of workflow.nodes) {
      for (const dep of node.dependencies) {
        dot += `  "${dep}" -> "${node.id}";\n`;
      }
    }

    dot += '}\n';
    return dot;
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create a simple sequential workflow from an array of prompt IDs
 */
export function createSequentialWorkflow(name: string, description: string, promptIds: string[]): Workflow {
  const nodes: WorkflowNode[] = [];
  let prevId = '';

  for (let i = 0; i < promptIds.length; i++) {
    const nodeId = `node_${i + 1}`;
    const node: WorkflowNode = {
      id: nodeId,
      prompt_id: promptIds[i],
      dependencies: prevId ? [prevId] : [],
    };

    nodes.push(node);
    prevId = nodeId;
  }

  return {
    id: `workflow_${Date.now()}`,
    name,
    description,
    nodes,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Create a parallel workflow where all prompts execute simultaneously
 */
export function createParallelWorkflow(name: string, description: string, promptIds: string[]): Workflow {
  const nodes: WorkflowNode[] = [];

  for (let i = 0; i < promptIds.length; i++) {
    const node: WorkflowNode = {
      id: `node_${i + 1}`,
      prompt_id: promptIds[i],
      dependencies: [],
    };
    nodes.push(node);
  }

  return {
    id: `workflow_${Date.now()}`,
    name,
    description,
    nodes,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Validate workflow structure
 */
export function isValidWorkflow(data: unknown): data is Workflow {
  if (typeof data !== 'object' || data === null) return false;

  const workflow = data as Record<string, unknown>;

  return (
    typeof workflow.id === 'string' &&
    typeof workflow.name === 'string' &&
    Array.isArray(workflow.nodes) &&
    workflow.nodes.every((node: unknown) =>
      typeof node === 'object' &&
      node !== null &&
      typeof (node as WorkflowNode).id === 'string' &&
      typeof (node as WorkflowNode).prompt_id === 'string' &&
      Array.isArray((node as WorkflowNode).dependencies)
    )
  );
}

// Re-export types
export type {
  Workflow,
  WorkflowNode,
  WorkflowExecutionOptions,
  WorkflowExecutionResult,
  WorkflowNodeResult,
};
