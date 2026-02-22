/**
 * Chain Executor Module
 *
 * Executes chains of prompts sequentially with variable substitution.
 * Provides progress tracking and error recovery.
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

interface ChainStep {
  prompt_id: string;
  order: number;
  variables?: Record<string, string>;
  continue_on_error?: boolean;
}

interface Chain {
  id: string;
  name: string;
  description?: string;
  steps: ChainStep[];
  created_at: string;
  updated_at: string;
}

interface ChainExecutionOptions {
  variables?: Record<string, string>;
  timeout?: number;
  onProgress?: (step: number, total: number, result: ChainStepResult) => void;
  onStepStart?: (step: ChainStep) => void;
  onStepComplete?: (step: ChainStep, result: ChainStepResult) => void;
  onError?: (step: ChainStep, error: Error) => void;
}

interface ChainStepResult {
  step: number;
  prompt_id: string;
  prompt_name: string;
  content: string;
  variables_used: Record<string, string>;
  error?: string;
  duration_ms: number;
}

interface ChainExecutionResult {
  chain_id: string;
  chain_name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'partial';
  results: ChainStepResult[];
  started_at: string;
  completed_at?: string;
  duration_ms: number;
  steps_succeeded: number;
  steps_failed: number;
}

// ============================================================================
// CHAIN EXECUTOR CLASS
// ============================================================================

export class ChainExecutor {
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
   * Validate a chain before execution
   */
  public validateChain(chain: Chain): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const index = this.getIndex();

    if (!index) {
      errors.push('Prompt index not available');
      return { valid: false, errors };
    }

    // Check that steps are present
    if (!chain.steps || chain.steps.length === 0) {
      errors.push('Chain must have at least one step');
    }

    // Check for duplicate order values
    const orders = chain.steps.map(s => s.order);
    const uniqueOrders = new Set(orders);
    if (orders.length !== uniqueOrders.size) {
      errors.push('Duplicate step order values detected');
    }

    // Validate each step
    for (const step of chain.steps) {
      const prompt = this.findPrompt(step.prompt_id);
      if (!prompt) {
        errors.push(`Step ${step.order}: Prompt '${step.prompt_id}' not found`);
      }

      if (step.order <= 0) {
        errors.push(`Step order must be positive, got ${step.order}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Execute a chain sequentially
   */
  public async execute(
    chain: Chain,
    options: ChainExecutionOptions = {}
  ): Promise<ChainExecutionResult> {
    const startTime = Date.now();
    const index = this.getIndex();

    // Validate chain first
    const validation = this.validateChain(chain);
    if (!validation.valid) {
      throw new Error(`Chain validation failed: ${validation.errors.join(', ')}`);
    }

    // Sort steps by order
    const sortedSteps = [...chain.steps].sort((a, b) => a.order - b.order);

    const result: ChainExecutionResult = {
      chain_id: chain.id,
      chain_name: chain.name,
      status: 'running',
      results: [],
      started_at: new Date().toISOString(),
      duration_ms: 0,
      steps_succeeded: 0,
      steps_failed: 0,
    };

    // Merge global and step-specific variables
    const globalVars = options.variables || {};

    try {
      for (const step of sortedSteps) {
        const stepStartTime = Date.now();

        // Notify step start
        options.onStepStart?.(step);

        const stepResult: ChainStepResult = {
          step: step.order,
          prompt_id: step.prompt_id,
          prompt_name: 'Unknown',
          content: '',
          variables_used: { ...globalVars, ...step.variables },
          duration_ms: 0,
        };

        try {
          // Find and load prompt
          const prompt = this.findPrompt(step.prompt_id);
          if (!prompt) {
            throw new Error(`Prompt '${step.prompt_id}' not found`);
          }

          stepResult.prompt_name = prompt.name;
          let content = this.getPromptContent(prompt);

          // Strip frontmatter
          content = this.stripFrontmatter(content);

          // Apply variable substitution
          const mergedVars = { ...globalVars, ...step.variables };
          content = this.substituteVariables(content, mergedVars);

          stepResult.content = content;
          stepResult.duration_ms = Date.now() - stepStartTime;
          result.steps_succeeded++;

          // Notify progress
          options.onProgress?.(step.order, sortedSteps.length, stepResult);
          options.onStepComplete?.(step, stepResult);

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          stepResult.error = errorMessage;
          stepResult.duration_ms = Date.now() - stepStartTime;
          result.steps_failed++;

          // Notify error
          options.onError?.(step, error as Error);

          // Check if we should continue
          if (!step.continue_on_error) {
            result.results.push(stepResult);
            result.status = 'failed';
            throw error;
          }
        }

        result.results.push(stepResult);
      }

      // All steps completed
      result.status = result.steps_failed > 0 ? 'partial' : 'completed';

    } catch (error) {
      result.status = 'failed';
      // Error is already recorded in step result
    }

    result.completed_at = new Date().toISOString();
    result.duration_ms = Date.now() - startTime;

    return result;
  }

  /**
   * Execute a chain and return formatted output
   */
  public async executeWithOutput(
    chain: Chain,
    options: ChainExecutionOptions = {}
  ): Promise<{ result: ChainExecutionResult; output: string }> {
    const result = await this.execute(chain, options);

    // Generate formatted output
    let output = '';
    output += '┌' + '─'.repeat(79) + '┐\n';
    output += '│' + 'Chain Execution Results'.padEnd(79) + '│\n';
    output += '├' + '─'.repeat(79) + '┤\n';
    output += '│' + `Chain: ${result.chain_name}`.padEnd(79) + '│\n';
    output += '│' + `Status: ${result.status.toUpperCase()}`.padEnd(79) + '│\n';
    output += '│' + `Duration: ${result.duration_ms}ms`.padEnd(79) + '│\n';
    output += '│' + `Steps: ${result.steps_succeeded}/${result.results.length} succeeded`.padEnd(79) + '│\n';
    output += '└' + '─'.repeat(79) + '┘\n\n';

    for (const stepResult of result.results) {
      const icon = stepResult.error ? 'FAIL' : 'DONE';
      output += `┌─ Step ${stepResult.step} [${icon}] ─${'─'.repeat(60)}┐\n`;
      output += `│ Prompt: ${stepResult.prompt_id} - ${stepResult.prompt_name}\n`;
      output += `│ Duration: ${stepResult.duration_ms}ms\n`;

      if (stepResult.error) {
        output += `│ Error: ${stepResult.error}\n`;
      } else {
        const preview = stepResult.content.substring(0, 200);
        output += `│ Content: ${preview}${stepResult.content.length > 200 ? '...' : ''}\n`;
      }

      output += '└' + '─'.repeat(79) + '┘\n\n';
    }

    return { result, output };
  }

  /**
   * Preview what a chain execution would produce (dry run)
   */
  public async preview(
    chain: Chain,
    variables: Record<string, string> = {}
  ): Promise<{ valid: boolean; errors: string[]; preview: string }> {
    const validation = this.validateChain(chain);
    if (!validation.valid) {
      return { ...validation, preview: '' };
    }

    const sortedSteps = [...chain.steps].sort((a, b) => a.order - b.order);
    let preview = '';

    preview += '┌' + '─'.repeat(79) + '┐\n';
    preview += '│' + 'Chain Execution Preview'.padEnd(79) + '│\n';
    preview += '├' + '─'.repeat(79) + '┤\n';
    preview += '│' + `Chain: ${chain.name}`.padEnd(79) + '│\n';
    preview += '│' + `Steps: ${chain.steps.length}`.padEnd(79) + '│\n';
    preview += '└' + '─'.repeat(79) + '┘\n\n';

    for (const step of sortedSteps) {
      const prompt = this.findPrompt(step.prompt_id);
      const promptName = prompt?.name || 'Unknown';
      const mergedVars = { ...variables, ...step.variables };
      const varsList = Object.keys(mergedVars).length > 0
        ? Object.entries(mergedVars).map(([k, v]) => `${k}=${v.substring(0, 20)}`).join(', ')
        : '(none)';

      preview += `┌─ Step ${step.order} ─${'─'.repeat(65)}┐\n`;
      preview += `│ Prompt: ${step.prompt_id}\n`;
      preview += `│ Name: ${promptName}\n`;
      preview += `│ Variables: ${varsList}\n`;
      preview += '└' + '─'.repeat(79) + '┘\n';
    }

    return {
      valid: true,
      errors: [],
      preview,
    };
  }

  /**
   * Export chain execution results to JSON
   */
  public exportResults(result: ChainExecutionResult): string {
    return JSON.stringify(result, null, 2);
  }

  /**
   * Import chain execution results from JSON
   */
  public importResults(json: string): ChainExecutionResult {
    return JSON.parse(json);
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create a simple chain from an array of prompt IDs
 */
export function createSimpleChain(name: string, description: string, promptIds: string[]): Chain {
  return {
    id: `chain_${Date.now()}`,
    name,
    description,
    steps: promptIds.map((prompt_id, index) => ({
      prompt_id,
      order: index + 1,
    })),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Validate chain structure
 */
export function isValidChain(data: unknown): data is Chain {
  if (typeof data !== 'object' || data === null) return false;

  const chain = data as Record<string, unknown>;

  return (
    typeof chain.id === 'string' &&
    typeof chain.name === 'string' &&
    Array.isArray(chain.steps) &&
    chain.steps.every((step: unknown) =>
      typeof step === 'object' &&
      step !== null &&
      typeof (step as ChainStep).prompt_id === 'string' &&
      typeof (step as ChainStep).order === 'number'
    )
  );
}

// Re-export types
export type {
  Chain,
  ChainStep,
  ChainExecutionOptions,
  ChainExecutionResult,
  ChainStepResult,
};
