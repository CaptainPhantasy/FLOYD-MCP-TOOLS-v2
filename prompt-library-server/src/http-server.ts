/**
 * HTTP Server for Prompt Library
 *
 * Express-based REST API with WebSocket support for live updates.
 * Provides dual transport alongside MCP stdio interface.
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync, readFileSync as fsReadFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import cookieParser from 'cookie-parser';
import os from 'os';
import multer, { FileFilterCallback } from 'multer';

// Authentication imports
import { createAuthRouter } from './auth-routes.js';
import { authenticate, optionalAuth } from './auth-middleware.js';

// Logging imports
import { logger, requestLoggingMiddleware, log, logError, logApiError } from './logger.js';

// ============================================================================
// GLM-4.7 CODING API CONFIGURATION
// ============================================================================

const GLM_CODING_API_URL = 'https://api.z.ai/api/coding/paas/v4/chat/completions';
const GLM_API_KEY = process.env.GLM_CODING_API_KEY || '';

interface GLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GLMRequest {
  model: string;
  messages: GLMMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
}

interface GLMChoice {
  index: number;
  message: {
    role: string;
    content: string;
    reasoning_content?: string;
  };
  finish_reason: string;
}

interface GLMResponse {
  id: string;
  created: number;
  model: string;
  choices: GLMChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ============================================================================
// GLM API RATE LIMITER (Separate from general rate limiter)
// ============================================================================

class GLMRateLimiter {
  private requests: Map<string, number[]> = new Map();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(windowMs: number = 60000, maxRequests: number = 20) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  check(identifier: string): boolean {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let requests = this.requests.get(identifier) || [];
    requests = requests.filter(t => t > windowStart);

    if (requests.length >= this.maxRequests) {
      return false;
    }

    requests.push(now);
    this.requests.set(identifier, requests);
    return true;
  }

  reset(identifier: string): void {
    this.requests.delete(identifier);
  }
}

// Prompt Library Configuration
const PROMPT_LIB_PATH = '/Volumes/Storage/Prompt Library';
const INDEX_PATH = join(PROMPT_LIB_PATH, '.promptlib', 'index.json');
const FAVORITES_PATH = join(PROMPT_LIB_PATH, '.promptlib', 'favorites.json');
const CHAINS_PATH = join(PROMPT_LIB_PATH, '.promptlib', 'chains.json');
const WORKFLOWS_PATH = join(PROMPT_LIB_PATH, '.promptlib', 'workflows.json');
const USAGE_PATH = join(PROMPT_LIB_PATH, '.promptlib', 'usage.json');
const EXECUTIONS_PATH = join(PROMPT_LIB_PATH, '.promptlib', 'executions.json');

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
  created?: string;
  updated?: string;
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

interface Chain {
  id: string;
  name: string;
  description?: string;
  steps: ChainStep[];
  created_at: string;
  updated_at: string;
  last_run?: string;
}

interface ChainStep {
  prompt_id: string;
  order: number;
  variables?: Record<string, string>;
}

interface ChainExecutionResult {
  chain_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  results: Array<{
    step: number;
    prompt_id: string;
    content: string;
    error?: string;
  }>;
  started_at: string;
  completed_at?: string;
}

interface WorkflowNode {
  id: string;
  prompt_id: string;
  dependencies: string[];
  variables?: Record<string, string>;
}

interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

interface Workflow {
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges?: WorkflowEdge[];
  created_at: string;
  updated_at: string;
}

interface WorkflowExecutionResult {
  workflow_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  results: Array<{
    node_id: string;
    prompt_id: string;
    content: string;
    error?: string;
  }>;
  started_at: string;
  completed_at?: string;
}

// Favorites store
interface FavoritesStore {
  prompts: string[];
}

// Usage store for tracking prompt usage
interface UsageStore {
  prompts: Record<string, {
    name: string;
    count: number;
    first_used: string;
    last_used: string;
  }>;
  last_updated: string;
}

// Execution history store
interface ExecutionRecord {
  id: string;
  type: 'chain' | 'workflow';
  target_id: string;
  target_name: string;
  status: 'completed' | 'failed' | 'partial';
  started_at: string;
  completed_at: string;
  duration_ms: number;
  steps_total: number;
  steps_completed: number;
}

interface ExecutionsStore {
  executions: ExecutionRecord[];
  last_updated: string;
}

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const PaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(1000).default(20),
  category: z.enum(['autonomous', 'legacyai', 'skills', 'templates', 'reference', 'all']).optional(),
  tag: z.string().optional(),
});

const PromptIdSchema = z.object({
  id: z.string().min(1),
});

const SearchQuerySchema = z.object({
  q: z.string().optional(),
  tag: z.string().optional(),
  type: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const CreateChainSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  steps: z.array(z.object({
    prompt_id: z.string().min(1),
    order: z.number().int().positive(),
    variables: z.record(z.string()).optional(),
  })).min(1),
});

const CreateWorkflowSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  nodes: z.array(z.object({
    id: z.string().min(1),
    prompt_id: z.string().min(1),
    dependencies: z.array(z.string()).default([]),
    variables: z.record(z.string()).optional(),
  })).min(1),
  edges: z.array(z.object({
    id: z.string().min(1),
    source: z.string().min(1),
    target: z.string().min(1),
    label: z.string().optional(),
  })).optional(),
});

const RunChainSchema = z.object({
  variables: z.record(z.string()).optional(),
});

const RunWorkflowSchema = z.object({
  variables: z.record(z.string()).optional(),
});

const TrendingQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).default(10),
  category: z.enum(['autonomous', 'legacyai', 'skills', 'templates', 'reference', 'all']).optional(),
});

const ExecutionsTrendSchema = z.object({
  days: z.coerce.number().int().positive().max(365).default(7),
});

const SyncFavoritesSchema = z.object({
  prompts: z.array(z.string()).min(0),
});

const PromptCreateSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().default(''),
  content: z.string().min(1, 'Content is required'),
  category: z.enum(['autonomous', 'legacyai', 'skills', 'templates', 'reference']),
  tags: z.array(z.string()).default([]),
  role: z.string().optional(),
});

const PromptUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  content: z.string().min(1).optional(),
  category: z.enum(['autonomous', 'legacyai', 'skills', 'templates', 'reference']).optional(),
  tags: z.array(z.string()).optional(),
  role: z.string().optional(),
});

// Schema for bulk prompt creation
const BulkPromptCreateSchema = z.array(z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().default(''),
  content: z.string().min(1, 'Content is required'),
  category: z.enum(['autonomous', 'legacyai', 'skills', 'templates', 'reference']),
  tags: z.array(z.string()).default([]),
  role: z.string().optional(),
}));

// ============================================================================
// IMPORT PARSER CONFIGURATION
// ============================================================================

/**
 * System prompt for GLM-4.7 import parsing
 */
const IMPORT_PARSER_SYSTEM = `You are a prompt parsing expert. Extract structured data from text files.

For each file, extract:
- name: Short, descriptive title (max 60 chars)
- description: Brief summary of what the prompt does (max 200 chars)
- content: The full prompt text (cleaned, preserving formatting)
- category: One of: autonomous, legacyai, skills, templates, reference
- tags: Relevant keywords (max 5 tags)

Return ONLY a valid JSON array with this exact structure:
[
  {
    "name": "string",
    "description": "string",
    "content": "string",
    "category": "autonomous|legacyai|skills|templates|reference",
    "tags": ["tag1", "tag2"]
  }
]

Category logic:
- autonomous: Self-generating, recursive, or agentic prompts
- legacyai: Prompts about legacy AI systems or team building
- skills: Practical skill-based prompts (coding, writing, analysis)
- templates: Reusable patterns or frameworks
- reference: Documentation, guides, or reference material

Important:
- Return ONLY the JSON array, no other text
- If a file doesn't contain a usable prompt, skip it (don't include an entry)
- Preserve code blocks, markdown formatting, and special characters in content
- Extract meaningful names from the file content or filename
- Generate clear, concise descriptions`;

/**
 * File size limits and constraints
 */
const MAX_FILE_SIZE = 100 * 1024; // 100KB
const MAX_FILES_PER_IMPORT = 10;
const ALLOWED_EXTENSIONS = ['.txt', '.md', '.markdown', '.json', '.prompt'];

// ============================================================================
// DATA ACCESS LAYER
// ============================================================================

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

/**
 * Save the index file
 */
function saveIndex(index: PromptIndex): void {
  try {
    const dir = join(PROMPT_LIB_PATH, '.promptlib');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
  } catch (e) {
    logError(e as Error, { context: 'saveIndex' });
    throw e;
  }
}

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

function loadFavorites(): FavoritesStore {
  try {
    if (existsSync(FAVORITES_PATH)) {
      const content = readFileSync(FAVORITES_PATH, 'utf-8');
      return JSON.parse(content);
    }
  } catch (e) {
    // Return default if file doesn't exist
  }
  return { prompts: [] };
}

function saveFavorites(favorites: FavoritesStore): void {
  try {
    const dir = join(PROMPT_LIB_PATH, '.promptlib');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(FAVORITES_PATH, JSON.stringify(favorites, null, 2));
  } catch (e) {
    logError(e as Error, { context: 'saveFavorites' });
  }
}

function loadChains(): Record<string, Chain> {
  try {
    if (existsSync(CHAINS_PATH)) {
      const content = readFileSync(CHAINS_PATH, 'utf-8');
      return JSON.parse(content);
    }
  } catch (e) {
    // Return empty object
  }
  return {};
}

function saveChains(chains: Record<string, Chain>): void {
  try {
    const dir = join(PROMPT_LIB_PATH, '.promptlib');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(CHAINS_PATH, JSON.stringify(chains, null, 2));
  } catch (e) {
    logError(e as Error, { context: 'saveChains' });
  }
}

function loadWorkflows(): Record<string, Workflow> {
  try {
    if (existsSync(WORKFLOWS_PATH)) {
      const content = readFileSync(WORKFLOWS_PATH, 'utf-8');
      return JSON.parse(content);
    }
  } catch (e) {
    // Return empty object
  }
  return {};
}

function saveWorkflows(workflows: Record<string, Workflow>): void {
  try {
    const dir = join(PROMPT_LIB_PATH, '.promptlib');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(WORKFLOWS_PATH, JSON.stringify(workflows, null, 2));
  } catch (e) {
    logError(e as Error, { context: 'saveWorkflows' });
  }
}

function loadUsage(): UsageStore {
  try {
    if (existsSync(USAGE_PATH)) {
      const content = readFileSync(USAGE_PATH, 'utf-8');
      return JSON.parse(content);
    }
  } catch (e) {
    // Return default if file doesn't exist
  }
  return { prompts: {}, last_updated: new Date().toISOString() };
}

function saveUsage(usage: UsageStore): void {
  try {
    const dir = join(PROMPT_LIB_PATH, '.promptlib');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    usage.last_updated = new Date().toISOString();
    writeFileSync(USAGE_PATH, JSON.stringify(usage, null, 2));
  } catch (e) {
    logError(e as Error, { context: 'saveUsage' });
  }
}

function incrementUsage(promptId: string, promptName: string): void {
  const usage = loadUsage();
  const now = new Date().toISOString();

  if (!usage.prompts[promptId]) {
    usage.prompts[promptId] = {
      name: promptName,
      count: 0,
      first_used: now,
      last_used: now,
    };
  }

  usage.prompts[promptId].count++;
  usage.prompts[promptId].last_used = now;
  saveUsage(usage);
}

function loadExecutions(): ExecutionsStore {
  try {
    if (existsSync(EXECUTIONS_PATH)) {
      const content = readFileSync(EXECUTIONS_PATH, 'utf-8');
      return JSON.parse(content);
    }
  } catch (e) {
    // Return default if file doesn't exist
  }
  return { executions: [], last_updated: new Date().toISOString() };
}

function saveExecutions(store: ExecutionsStore): void {
  try {
    const dir = join(PROMPT_LIB_PATH, '.promptlib');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    store.last_updated = new Date().toISOString();
    writeFileSync(EXECUTIONS_PATH, JSON.stringify(store, null, 2));
  } catch (e) {
    logError(e as Error, { context: 'saveExecutions' });
  }
}

function addExecutionRecord(record: ExecutionRecord): void {
  const store = loadExecutions();
  store.executions.push(record);

  // Keep only last 1000 executions
  if (store.executions.length > 1000) {
    store.executions = store.executions.slice(-1000);
  }

  saveExecutions(store);
}

// ============================================================================
// PROMPT FILE STORAGE HELPERS
// ============================================================================

/**
 * Generate a unique prompt ID from name
 */
function generatePromptId(name: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 6);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `prompt:${slug}:${timestamp}:${random}`;
}

/**
 * Get the file path for a custom prompt
 */
function getPromptFilePath(id: string, category: string): string {
  const categoryDir = join(PROMPT_LIB_PATH, category);
  const filename = `${id.replace(/:/g, '_')}.md`;
  return join(categoryDir, filename);
}

/**
 * Create a new prompt file
 */
function createPromptFile(data: {
  id: string;
  name: string;
  description: string;
  content: string;
  category: string;
  tags: string[];
  role?: string;
}): Prompt {
  const { id, name, description, content, category, tags, role } = data;

  // Create category directory if needed
  const categoryDir = join(PROMPT_LIB_PATH, category);
  if (!existsSync(categoryDir)) {
    mkdirSync(categoryDir, { recursive: true });
  }

  // Generate file content with frontmatter
  const tagsStr = tags.length > 0 ? tags.join(', ') : '';
  const frontmatter = `---
title: ${name}
description: ${description}
role: ${role || ''}
tags: ${tagsStr}
created: ${new Date().toISOString()}
---

${content}`;

  // Write to file
  const filePath = getPromptFilePath(id, category);
  writeFileSync(filePath, frontmatter, 'utf-8');

  // Calculate relative path
  const relativePath = filePath.replace(PROMPT_LIB_PATH + '/', '');

  // Return Prompt object
  const prompt: Prompt = {
    id,
    file_id: id,
    name,
    path: relativePath,
    category,
    metadata: {
      title: name,
      description,
      role,
      tags_list: tags,
      tags: tagsStr,
    },
    preview: content.substring(0, 500) + (content.length > 500 ? '...' : ''),
  };

  return prompt;
}

/**
 * Update an existing prompt file
 */
function updatePromptFile(id: string, data: Partial<{
  name: string;
  description: string;
  content: string;
  category: string;
  tags: string[];
  role?: string;
}>): Prompt | null {
  const index = loadIndex();
  if (!index || !index.prompts[id]) {
    return null;
  }

  const existing = index.prompts[id];
  const updated = { ...existing };

  // Apply updates
  if (data.name !== undefined) {
    updated.name = data.name;
    updated.metadata = { ...updated.metadata, title: data.name };
  }
  if (data.description !== undefined) {
    updated.metadata = { ...updated.metadata, description: data.description };
  }
  if (data.content !== undefined) {
    updated.preview = data.content.substring(0, 500) + (data.content.length > 500 ? '...' : '');
  }
  if (data.tags !== undefined) {
    updated.metadata = { ...updated.metadata, tags_list: data.tags };
  }
  if (data.role !== undefined) {
    updated.metadata = { ...updated.metadata, role: data.role };
  }

  // Rebuild file content
  const tags = updated.metadata.tags_list || [];
  const tagsStr = tags.length > 0 ? tags.join(', ') : '';
  updated.metadata = { ...updated.metadata, tags: tagsStr };
  const content = data.content || getPromptContent(existing);

  const frontmatter = `---
title: ${updated.name}
description: ${updated.metadata.description || ''}
role: ${updated.metadata.role || ''}
tags: ${tagsStr}
created: ${updated.metadata.created || new Date().toISOString()}
updated: ${new Date().toISOString()}
---

${content}`;

  // Write updated file
  const fullPath = join(PROMPT_LIB_PATH, existing.path);
  writeFileSync(fullPath, frontmatter, 'utf-8');

  return updated;
}

/**
 * Delete a prompt file
 */
function deletePromptFile(id: string): boolean {
  const index = loadIndex();
  if (!index || !index.prompts[id]) {
    return false;
  }

  const prompt = index.prompts[id];
  const fullPath = join(PROMPT_LIB_PATH, prompt.path);

  // Only delete custom prompts (not library prompts)
  // Custom prompts are stored in category directories directly
  if (existsSync(fullPath)) {
    try {
      rmSync(fullPath);
      return true;
    } catch (e) {
      logError(e as Error, { context: 'deletePromptFile', path: fullPath });
      return false;
    }
  }

  return false;
}

// ============================================================================
// RATE LIMITING
// ============================================================================

class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(windowMs: number = 60000, maxRequests: number = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  check(identifier: string): boolean {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let requests = this.requests.get(identifier) || [];
    requests = requests.filter(t => t > windowStart);

    if (requests.length >= this.maxRequests) {
      return false;
    }

    requests.push(now);
    this.requests.set(identifier, requests);
    return true;
  }

  reset(identifier: string): void {
    this.requests.delete(identifier);
  }
}

// ============================================================================
// WEBSOCKET MANAGER
// ============================================================================

class WebSocketManager {
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();

  constructor(server: ReturnType<typeof createServer>) {
    this.wss = new WebSocketServer({ server, path: '/api/ws' });

    this.wss.on('connection', (ws: WebSocket) => {
      this.clients.add(ws);
      log.info('WebSocket client connected', { clientCount: this.clients.size });

      // Send initial state
      this.sendToClient(ws, {
        type: 'connected',
        timestamp: new Date().toISOString(),
      });

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (e) {
          log.warn('WebSocket invalid JSON', { error: e });
          this.sendToClient(ws, {
            type: 'error',
            message: 'Invalid JSON',
          });
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        log.info('WebSocket client disconnected', { clientCount: this.clients.size });
      });

      ws.on('error', (error) => {
        logError(error as Error, { context: 'WebSocket' });
        this.clients.delete(ws);
      });
    });
  }

  private handleMessage(ws: WebSocket, message: any): void {
    switch (message.type) {
      case 'ping':
        this.sendToClient(ws, { type: 'pong' });
        break;
      case 'subscribe':
        // Handle subscription to specific events
        break;
    }
  }

  private sendToClient(ws: WebSocket, data: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  broadcast(data: any): void {
    const message = JSON.stringify(data);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  broadcastPromptUpdate(promptId: string, action: 'created' | 'updated' | 'deleted'): void {
    this.broadcast({
      type: 'prompt_update',
      prompt_id: promptId,
      action,
      timestamp: new Date().toISOString(),
    });
  }

  broadcastChainUpdate(chainId: string, action: 'created' | 'updated' | 'deleted' | 'executed'): void {
    this.broadcast({
      type: 'chain_update',
      chain_id: chainId,
      action,
      timestamp: new Date().toISOString(),
    });
  }

  broadcastWorkflowUpdate(workflowId: string, action: 'created' | 'updated' | 'deleted' | 'executed'): void {
    this.broadcast({
      type: 'workflow_update',
      workflow_id: workflowId,
      action,
      timestamp: new Date().toISOString(),
    });
  }

  getClientCount(): number {
    return this.clients.size;
  }
}

// ============================================================================
// HTTP SERVER CLASS
// ============================================================================

// ============================================================================
// HEALTH MONITORING & METRICS TYPES
// ============================================================================

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  server: {
    status: 'ok' | 'error';
    port: number;
    memory: {
      used: number;
      total: number;
      percentage: number;
    };
    cpu: {
      loadAverage: number[];
    };
  };
  database: {
    status: 'ok' | 'error' | 'unknown';
    connected: boolean;
    lastCheck: string;
  };
  externalApis: {
    glm: {
      status: 'ok' | 'error' | 'unconfigured';
      reachable: boolean;
      responseTime?: number;
    };
  };
}

interface DeepHealthStatus extends HealthStatus {
  checks: {
    fileSystem: {
      status: 'ok' | 'error';
      promptLibPath: string;
      accessible: boolean;
      indexExists: boolean;
    };
    index: {
      status: 'ok' | 'error';
      version: string | null;
      promptCount: number;
      lastUpdated: string | null;
    };
    dependencies: {
      status: 'ok' | 'warning';
      items: Array<{
        name: string;
        status: 'ok' | 'warning' | 'error';
        message?: string;
      }>;
    };
  };
}

interface MetricsData {
  timestamp: string;
  uptime: number;
  requests: {
    total: number;
    byEndpoint: Record<string, number>;
    byMethod: Record<string, number>;
  };
  errors: {
    total: number;
    byEndpoint: Record<string, number>;
    byType: Record<string, number>;
    rate: number; // errors per 1000 requests
  };
  performance: {
    avgResponseTime: number;
    p50ResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;
  };
  resources: {
    memory: {
      used: number;
      total: number;
      percentage: number;
    };
    connections: {
      websocket: number;
      http: number;
    };
  };
}

// Metrics collector class
class MetricsCollector {
  private requestCount: number = 0;
  private errorCount: number = 0;
  private requestsByEndpoint: Record<string, number> = {};
  private errorsByEndpoint: Record<string, number> = {};
  private requestsByMethod: Record<string, number> = {};
  private errorsByType: Record<string, number> = {};
  private responseTimes: number[] = [];
  private maxResponseTimes: number = 1000; // Keep last 1000 for percentile calc
  private startTime: number = Date.now();

  recordRequest(method: string, path: string, statusCode: number, responseTime: number): void {
    this.requestCount++;
    this.requestsByMethod[method] = (this.requestsByMethod[method] || 0) + 1;
    this.requestsByEndpoint[path] = (this.requestsByEndpoint[path] || 0) + 1;

    // Store response time
    this.responseTimes.push(responseTime);
    if (this.responseTimes.length > this.maxResponseTimes) {
      this.responseTimes.shift();
    }

    // Track errors
    if (statusCode >= 400) {
      this.errorCount++;
      this.errorsByEndpoint[path] = (this.errorsByEndpoint[path] || 0) + 1;
      const errorType = statusCode >= 500 ? '5xx' : '4xx';
      this.errorsByType[errorType] = (this.errorsByType[errorType] || 0) + 1;
    }
  }

  getMetrics(wsClientCount: number): MetricsData {
    const sortedTimes = [...this.responseTimes].sort((a, b) => a - b);
    const len = sortedTimes.length;

    const p50 = len > 0 ? sortedTimes[Math.floor(len * 0.5)] : 0;
    const p95 = len > 0 ? sortedTimes[Math.floor(len * 0.95)] : 0;
    const p99 = len > 0 ? sortedTimes[Math.floor(len * 0.99)] : 0;
    const avg = len > 0
      ? sortedTimes.reduce((sum, t) => sum + t, 0) / len
      : 0;

    const memUsage = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    return {
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      requests: {
        total: this.requestCount,
        byEndpoint: { ...this.requestsByEndpoint },
        byMethod: { ...this.requestsByMethod },
      },
      errors: {
        total: this.errorCount,
        byEndpoint: { ...this.errorsByEndpoint },
        byType: { ...this.errorsByType },
        rate: this.requestCount > 0 ? (this.errorCount / this.requestCount) * 1000 : 0,
      },
      performance: {
        avgResponseTime: Math.round(avg),
        p50ResponseTime: Math.round(p50),
        p95ResponseTime: Math.round(p95),
        p99ResponseTime: Math.round(p99),
      },
      resources: {
        memory: {
          used: memUsage.heapUsed,
          total: memUsage.heapTotal,
          percentage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
        },
        connections: {
          websocket: wsClientCount,
          http: 0, // Could be tracked with connection middleware
        },
      },
    };
  }

  reset(): void {
    this.requestCount = 0;
    this.errorCount = 0;
    this.requestsByEndpoint = {};
    this.errorsByEndpoint = {};
    this.requestsByMethod = {};
    this.errorsByType = {};
    this.responseTimes = [];
  }
}

// ============================================================================
// HTTP SERVER CLASS
// ============================================================================

export class HttpServer {
  private app: express.Application;
  private server: ReturnType<typeof createServer>;
  private wsManager: WebSocketManager;
  private rateLimiter: RateLimiter;
  private glmRateLimiter: GLMRateLimiter;
  private port: number;
  private metrics: MetricsCollector;
  private startTime: number;

  constructor(port: number = 3000) {
    this.port = port;
    this.startTime = Date.now();
    this.app = express();
    this.server = createServer(this.app);
    this.rateLimiter = new RateLimiter(60000, 100); // 100 requests per minute
    this.glmRateLimiter = new GLMRateLimiter(60000, 20); // 20 GLM requests per minute
    this.wsManager = new WebSocketManager(this.server);
    this.metrics = new MetricsCollector();

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandlers();
  }

  private setupMiddleware(): void {
    // CORS for Vite dev server
    this.app.use(cors({
      origin: [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:5174',
        'http://127.0.0.1:5174',
        'http://localhost:3000',
      ],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }));

    // Body parsing
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '1mb' }));

    // File upload configuration for import endpoint
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: MAX_FILE_SIZE,
        files: MAX_FILES_PER_IMPORT,
      },
      fileFilter: (req: any, file: Express.Multer.File, cb: FileFilterCallback) => {
        const ext = file.originalname.toLowerCase();
        const hasAllowedExt = ALLOWED_EXTENSIONS.some(e => ext.endsWith(e));

        // Check for binary file types by mimetype
        const binaryTypes = [
          'application/octet-stream',
          'application/pdf',
          'application/zip',
          'image/',
          'video/',
          'audio/',
        ];
        const isBinary = binaryTypes.some(t => file.mimetype?.startsWith(t));

        if (!hasAllowedExt && !file.mimetype?.startsWith('text/')) {
          return cb(new Error(`Invalid file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`));
        }

        if (isBinary) {
          return cb(new Error('Binary files are not supported. Please upload text files.'));
        }

        cb(null, true);
      },
    });

    // Store upload instance for use in routes
    (this.app as any).upload = upload;

    // Cookie parsing (for refresh tokens)
    this.app.use(cookieParser());

    // Structured request logging middleware
    this.app.use(requestLoggingMiddleware);

    // Request timing for metrics
    this.app.use((req, res, next) => {
      const startTime = Date.now();

      // Store metrics reference and start time on request
      (req as any).metrics = this.metrics;
      (req as any).startTime = startTime;

      // Track on response finish
      res.on('finish', () => {
        const responseTime = Date.now() - startTime;
        this.metrics.recordRequest(req.method, req.path, res.statusCode, responseTime);

        // Log request completion if request logger is available
        if ((req as any).logger) {
          const logLevel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
          (req as any).logger.log(logLevel, 'Response sent', {
            statusCode: res.statusCode,
            responseTime,
          });
        }
      });

      next();
    });

    // Rate limiting middleware
    this.app.use((req, res, next) => {
      const identifier = req.ip || 'unknown';
      if (!this.rateLimiter.check(identifier)) {
        return res.status(429).json({
          error: 'Too many requests',
          message: 'Rate limit exceeded. Please try again later.',
        });
      }
      next();
    });
  }

  private setupRoutes(): void {
    const api = express.Router();

    // Health check
    api.get('/health', async (req, res) => {
      const uptime = Date.now() - this.startTime;
      const memUsage = process.memoryUsage();
      const index = loadIndex();

      // Check GLM API availability (quick check with timeout)
      let glmStatus: 'ok' | 'error' | 'unconfigured' = 'unconfigured';
      let glmReachable = false;
      let glmResponseTime: number | undefined = undefined;

      if (GLM_API_KEY) {
        try {
          const glmStart = Date.now();
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);

          const response = await fetch(GLM_CODING_API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${GLM_API_KEY}`,
            },
            body: JSON.stringify({
              model: 'glm-4.7',
              messages: [{ role: 'user', content: 'test' }],
              max_tokens: 1,
            }),
            signal: controller.signal,
          }).catch(() => null);
          clearTimeout(timeoutId);

          glmResponseTime = Date.now() - glmStart;
          glmReachable = response !== null && response.ok;
          glmStatus = glmReachable ? 'ok' : 'error';
        } catch {
          glmStatus = 'error';
        }
      }

      // Overall health determination
      let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      if (!index) {
        overallStatus = 'unhealthy';
      }
      if (glmStatus === 'error' && GLM_API_KEY) {
        overallStatus = 'degraded';
      }

      const healthData: HealthStatus = {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        uptime,
        server: {
          status: 'ok',
          port: this.port,
          memory: {
            used: memUsage.heapUsed,
            total: memUsage.heapTotal,
            percentage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
          },
          cpu: {
            loadAverage: os.loadavg(),
          },
        },
        database: {
          status: index ? 'ok' : 'error',
          connected: !!index,
          lastCheck: new Date().toISOString(),
        },
        externalApis: {
          glm: {
            status: glmStatus,
            reachable: glmReachable,
            responseTime: glmResponseTime,
          },
        },
      };

      const statusCode = overallStatus === 'unhealthy' ? 503 : 200;
      res.status(statusCode).json(healthData);
    });

    // Deep health check
    api.get('/health/deep', async (req, res) => {
      const uptime = Date.now() - this.startTime;
      const memUsage = process.memoryUsage();
      const index = loadIndex();

      const fileSystemAccessible = existsSync(PROMPT_LIB_PATH);

      let glmStatus: 'ok' | 'error' | 'unconfigured' = 'unconfigured';
      let glmReachable = false;
      let glmResponseTime: number | undefined = undefined;
      let glmError: string | undefined = undefined;

      if (GLM_API_KEY) {
        try {
          const glmStart = Date.now();
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);

          const response = await fetch(GLM_CODING_API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${GLM_API_KEY}`,
            },
            body: JSON.stringify({
              model: 'glm-4.7',
              messages: [{ role: 'user', content: 'test' }],
              max_tokens: 1,
            }),
            signal: controller.signal,
          }).catch((e) => {
            glmError = e instanceof Error ? e.message : String(e);
            return null;
          });
          clearTimeout(timeoutId);

          glmResponseTime = Date.now() - glmStart;
          glmReachable = response !== null && response.ok;
          glmStatus = glmReachable ? 'ok' : 'error';
        } catch (e) {
          glmStatus = 'error';
          glmError = e instanceof Error ? e.message : String(e);
        }
      }

      const dependencyChecks: Array<{
        name: string;
        status: 'ok' | 'warning' | 'error';
        message: string;
      }> = [
        {
          name: 'prompt-library-path',
          status: fileSystemAccessible ? 'ok' : 'error',
          message: fileSystemAccessible
            ? `Accessible at ${PROMPT_LIB_PATH}`
            : `Cannot access ${PROMPT_LIB_PATH}`,
        },
        {
          name: 'index-file',
          status: index ? 'ok' : 'error',
          message: index
            ? `Index loaded with ${index.stats.total} prompts`
            : 'Index file not found or invalid',
        },
        {
          name: 'glm-api',
          status: glmStatus === 'ok' ? 'ok' : GLM_API_KEY ? 'warning' : 'ok',
          message: GLM_API_KEY
            ? glmReachable
              ? `GLM API reachable (${glmResponseTime}ms)`
              : `GLM API unreachable: ${glmError || 'Connection failed'}`
            : 'GLM API not configured (optional)',
        },
        {
          name: 'memory-usage',
          status: memUsage.heapUsed / memUsage.heapTotal < 0.9 ? 'ok' : 'warning',
          message: `${Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100)}% heap used`,
        },
        {
          name: 'uptime',
          status: 'ok',
          message: `${Math.round(uptime / 1000)}s uptime`,
        },
      ];

      const hasErrors = dependencyChecks.some((d) => d.status === 'error');
      const hasWarnings = dependencyChecks.some((d) => d.status === 'warning');

      let deepStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      if (hasErrors) {
        deepStatus = 'unhealthy';
      } else if (hasWarnings) {
        deepStatus = 'degraded';
      }

      const deepHealthData: DeepHealthStatus = {
        status: deepStatus,
        timestamp: new Date().toISOString(),
        uptime,
        server: {
          status: 'ok',
          port: this.port,
          memory: {
            used: memUsage.heapUsed,
            total: memUsage.heapTotal,
            percentage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
          },
          cpu: {
            loadAverage: os.loadavg(),
          },
        },
        database: {
          status: index ? 'ok' : 'error',
          connected: !!index,
          lastCheck: new Date().toISOString(),
        },
        externalApis: {
          glm: {
            status: glmStatus,
            reachable: glmReachable,
            responseTime: glmResponseTime,
          },
        },
        checks: {
          fileSystem: {
            status: fileSystemAccessible ? 'ok' : 'error',
            promptLibPath: PROMPT_LIB_PATH,
            accessible: fileSystemAccessible,
            indexExists: existsSync(INDEX_PATH),
          },
          index: {
            status: index ? 'ok' : 'error',
            version: index?.version || null,
            promptCount: index?.stats.total || 0,
            lastUpdated: index?.last_updated || null,
          },
          dependencies: {
            status: hasErrors ? 'warning' : 'ok',
            items: dependencyChecks,
          },
        },
      };

      const statusCode = deepStatus === 'unhealthy' ? 503 : 200;
      res.status(statusCode).json(deepHealthData);
    });

    // Metrics endpoint
    api.get('/metrics', (req, res) => {
      const wsClientCount = this.wsManager.getClientCount();
      const metricsData = this.metrics.getMetrics(wsClientCount);
      res.json(metricsData);
    });

    // Reset metrics endpoint (for testing/admin)
    api.post('/metrics/reset', (req, res) => {
      this.metrics.reset();
      res.json({ message: 'Metrics reset successfully' });
    });

    // ============================================================================
    // AUTHENTICATION ENDPOINTS
    // ============================================================================

    // Mount auth router
    api.use('/auth', createAuthRouter());

    // ============================================================================
    // PROMPTS ENDPOINTS
    // ============================================================================

    // GET /api/prompts - List prompts with pagination
    api.get('/prompts', (req, res) => {
      const result = PaginationSchema.safeParse(req.query);
      if (!result.success) {
        return res.status(400).json({
          error: 'Invalid query parameters',
          details: result.error.flatten(),
        });
      }

      const { page, page_size, category, tag } = result.data;
      const index = loadIndex();

      if (!index) {
        return res.status(503).json({
          error: 'Prompt Library index not found',
          message: 'Please run: cd "/Volumes/Storage/Prompt Library" && python3 promptlib.py --sync',
        });
      }

      let allPrompts = Object.values(index.prompts);

      // Filter by category
      if (category && category !== 'all') {
        allPrompts = allPrompts.filter(p => p.category === category);
      }

      // Filter by tag
      if (tag) {
        allPrompts = allPrompts.filter(p =>
          p.metadata.tags_list?.some(t => t.toLowerCase() === tag.toLowerCase())
        );
      }

      const total = allPrompts.length;
      const totalPages = Math.ceil(total / page_size);
      const startIndex = (page - 1) * page_size;
      const endIndex = startIndex + page_size;
      const paginatedPrompts = allPrompts.slice(startIndex, endIndex);

      res.json({
        total,
        page,
        pages: totalPages,
        page_size,
        category: category || 'all',
        prompts: paginatedPrompts.map(p => ({
          id: p.id,
          file_id: p.file_id,
          name: p.name,
          category: p.category,
          role: p.metadata.role || '',
          tags: p.metadata.tags_list || [],
          preview: p.preview.substring(0, 200) + '...',
        })),
      });
    });

    // GET /api/prompts/categories - List categories
    api.get('/prompts/categories', (req, res) => {
      const index = loadIndex();

      if (!index) {
        return res.status(503).json({
          error: 'Prompt Library index not found',
        });
      }

      res.json({
        categories: Object.entries(index.categories).map(([key, value]) => ({
          id: key,
          ...value,
          count: index.stats.by_category[key] || 0,
        })),
      });
    });

    // GET /api/prompts/tags - List all tags
    api.get('/prompts/tags', (req, res) => {
      const index = loadIndex();

      if (!index) {
        return res.status(503).json({
          error: 'Prompt Library index not found',
        });
      }

      res.json({
        tags: index.tags,
      });
    });

    // GET /api/prompts/trending - Get trending prompts (most used)
    api.get('/prompts/trending', (req, res) => {
      const result = TrendingQuerySchema.safeParse(req.query);
      if (!result.success) {
        return res.status(400).json({
          error: 'Invalid query parameters',
          details: result.error.flatten(),
        });
      }

      const { limit, category } = result.data;
      const index = loadIndex();
      const usage = loadUsage();

      if (!index) {
        return res.status(503).json({
          error: 'Prompt Library index not found',
        });
      }

      // Build array of prompts with usage data
      const promptsWithUsage = Object.values(index.prompts).map(prompt => ({
        ...prompt,
        usage_count: usage.prompts[prompt.id]?.count || 0,
        last_used: usage.prompts[prompt.id]?.last_used || null,
      }));

      // Filter by category if specified
      let filtered = promptsWithUsage;
      if (category && category !== 'all') {
        filtered = filtered.filter(p => p.category === category);
      }

      // Sort by usage count (descending), then by last used (descending)
      const sorted = filtered.sort((a, b) => {
        if (b.usage_count !== a.usage_count) {
          return b.usage_count - a.usage_count;
        }
        const bLast = b.last_used ? new Date(b.last_used).getTime() : 0;
        const aLast = a.last_used ? new Date(a.last_used).getTime() : 0;
        return bLast - aLast;
      });

      // Take top N
      const trending = sorted.slice(0, limit);

      res.json({
        trending: trending.map(p => ({
          id: p.id,
          title: p.name,
          uses: p.usage_count,
          category: p.category,
        })),
      });
    });

    // GET /api/prompts/:id - Get single prompt with full content
    api.get('/prompts/:id', (req, res) => {
      const result = PromptIdSchema.safeParse(req.params);
      if (!result.success) {
        return res.status(400).json({
          error: 'Invalid prompt ID',
          details: result.error.flatten(),
        });
      }

      const { id } = result.data;
      const index = loadIndex();

      if (!index) {
        return res.status(503).json({
          error: 'Prompt Library index not found',
        });
      }

      // Find prompt by ID
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

      if (!prompt) {
        return res.status(404).json({
          error: 'Prompt not found',
          message: `Prompt '${id}' not found. Use GET /api/prompts to see available prompts.`,
        });
      }

      const content = getPromptContent(prompt);

      // Strip frontmatter
      let cleanContent = content;
      if (content.startsWith('---')) {
        const end = content.indexOf('\n---\n', 4);
        if (end !== -1) {
          cleanContent = content.substring(end + 5);
        }
      }

      res.json({
        id: prompt.id,
        file_id: prompt.file_id,
        name: prompt.name,
        path: prompt.path,
        category: prompt.category,
        metadata: prompt.metadata,
        content: cleanContent,
        full_content: content, // Include frontmatter version
      });
    });

    // POST /api/prompts - Create a new prompt
    api.post('/prompts', (req, res) => {
      const result = PromptCreateSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          error: 'Invalid prompt data',
          details: result.error.flatten(),
        });
      }

      const { name, description, content, category, tags, role } = result.data;

      // Validate category directory can be created
      const categoryDir = join(PROMPT_LIB_PATH, category);
      try {
        if (!existsSync(categoryDir)) {
          mkdirSync(categoryDir, { recursive: true });
        }
      } catch (e) {
        return res.status(500).json({
          error: 'Failed to create category directory',
          message: category,
        });
      }

      // Generate unique ID and create prompt
      const id = generatePromptId(name);
      const prompt = createPromptFile({
        id,
        name,
        description: description || '',
        content,
        category,
        tags: tags || [],
        role,
      });

      // Update the index to include the new prompt
      const index = loadIndex();
      if (index) {
        // Add the new prompt to the index
        index.prompts[id] = prompt;

        // Update stats
        index.stats.total = Object.keys(index.prompts).length;
        index.stats.by_category[category] = (index.stats.by_category[category] || 0) + 1;

        // Update last_updated
        index.last_updated = new Date().toISOString();

        // Save the updated index
        saveIndex(index);
      }

      // Broadcast update
      this.wsManager.broadcastPromptUpdate(id, 'created');

      res.status(201).json({
        id: prompt.id,
        file_id: prompt.file_id,
        name: prompt.name,
        path: prompt.path,
        category: prompt.category,
        role: prompt.metadata.role || '',
        tags: prompt.metadata.tags_list || [],
        preview: prompt.preview,
      });
    });

    // PUT /api/prompts/:id - Update an existing prompt
    api.put('/prompts/:id', (req, res) => {
      const { id } = req.params;
      const index = loadIndex();

      if (!index) {
        return res.status(503).json({
          error: 'Prompt Library index not found',
        });
      }

      // Find prompt by ID
      let prompt = index.prompts[id];
      if (!prompt) {
        const upperId = id.toUpperCase();
        for (const [pid, p] of Object.entries(index.prompts)) {
          if (pid.startsWith(upperId) || pid.split(':')[1]?.startsWith(upperId.replace(/[^a-z0-9-]/gi, ''))) {
            prompt = p;
            break;
          }
        }
      }

      if (!prompt) {
        return res.status(404).json({
          error: 'Prompt not found',
          message: `Prompt '${id}' not found.`,
        });
      }

      const result = PromptUpdateSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          error: 'Invalid prompt data',
          details: result.error.flatten(),
        });
      }

      const updated = updatePromptFile(prompt.id, result.data);
      if (!updated) {
        return res.status(500).json({
          error: 'Failed to update prompt',
        });
      }

      // Update the index with the modified prompt
      if (index.prompts[prompt.id]) {
        index.prompts[prompt.id] = updated;

        // Update stats (in case category changed)
        index.stats.total = Object.keys(index.prompts).length;
        for (const cat of ['autonomous', 'legacyai', 'skills', 'templates', 'reference']) {
          index.stats.by_category[cat] = Object.values(index.prompts)
            .filter(p => p.category === cat).length;
        }

        // Update last_updated
        index.last_updated = new Date().toISOString();

        // Save the updated index
        saveIndex(index);
      }

      // Broadcast update
      this.wsManager.broadcastPromptUpdate(prompt.id, 'updated');

      res.json({
        id: updated.id,
        file_id: updated.file_id,
        name: updated.name,
        path: updated.path,
        category: updated.category,
        role: updated.metadata.role || '',
        tags: updated.metadata.tags_list || [],
        preview: updated.preview,
      });
    });

    // DELETE /api/prompts/:id - Delete a prompt
    api.delete('/prompts/:id', (req, res) => {
      const { id } = req.params;
      const index = loadIndex();

      if (!index) {
        return res.status(503).json({
          error: 'Prompt Library index not found',
        });
      }

      // Find prompt by ID
      let prompt = index.prompts[id];
      if (!prompt) {
        const upperId = id.toUpperCase();
        for (const [pid, p] of Object.entries(index.prompts)) {
          if (pid.startsWith(upperId) || pid.split(':')[1]?.startsWith(upperId.replace(/[^a-z0-9-]/gi, ''))) {
            prompt = p;
            break;
          }
        }
      }

      if (!prompt) {
        return res.status(404).json({
          error: 'Prompt not found',
          message: `Prompt '${id}' not found.`,
        });
      }

      const deleted = deletePromptFile(prompt.id);
      if (!deleted) {
        return res.status(500).json({
          error: 'Failed to delete prompt',
          message: 'Could not delete the prompt file.',
        });
      }

      // Remove from index
      if (index.prompts[prompt.id]) {
        delete index.prompts[prompt.id];

        // Update stats
        index.stats.total = Object.keys(index.prompts).length;
        index.stats.by_category[prompt.category] = Object.values(index.prompts)
          .filter(p => p.category === prompt.category).length;

        // Update last_updated
        index.last_updated = new Date().toISOString();

        // Save the updated index
        saveIndex(index);
      }

      // Broadcast update
      this.wsManager.broadcastPromptUpdate(prompt.id, 'deleted');

      res.json({
        deleted: true,
        id: prompt.id,
      });
    });

    // POST /api/prompts/bulk - Bulk create prompts
    api.post('/prompts/bulk', (req, res) => {
      const result = BulkPromptCreateSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          error: 'Invalid bulk prompt data',
          details: result.error.flatten(),
        });
      }

      const promptsToCreate = result.data;
      const createdPrompts: any[] = [];
      const errors: Array<{ index: number; error: string }> = [];

      // Create each prompt
      for (let i = 0; i < promptsToCreate.length; i++) {
        const { name, description, content, category, tags, role } = promptsToCreate[i];

        try {
          // Validate category directory can be created
          const categoryDir = join(PROMPT_LIB_PATH, category);
          if (!existsSync(categoryDir)) {
            mkdirSync(categoryDir, { recursive: true });
          }

          // Generate unique ID and create prompt
          const id = generatePromptId(name);
          const prompt = createPromptFile({
            id,
            name,
            description: description || '',
            content,
            category,
            tags: tags || [],
            role,
          });

          createdPrompts.push({
            id: prompt.id,
            file_id: prompt.file_id,
            name: prompt.name,
            path: prompt.path,
            category: prompt.category,
            role: prompt.metadata.role || '',
            tags: prompt.metadata.tags_list || [],
            preview: prompt.preview,
          });

          // Broadcast update
          this.wsManager.broadcastPromptUpdate(id, 'created');
        } catch (e) {
          errors.push({
            index: i,
            error: e instanceof Error ? e.message : 'Unknown error',
          });
        }
      }

      // Update the index with all created prompts
      if (createdPrompts.length > 0) {
        const promptIndex = loadIndex();
        if (promptIndex) {
          for (const created of createdPrompts) {
            // Reconstruct the Prompt object for the index
            const promptForIndex: Prompt = {
              id: created.id,
              file_id: created.file_id,
              name: created.name,
              path: created.path,
              category: created.category,
              metadata: {
                title: created.name,
                role: created.role,
                tags_list: created.tags,
                tags: created.tags.join(', '),
              },
              preview: created.preview,
            };
            promptIndex.prompts[created.id] = promptForIndex;
          }

          // Update stats
          promptIndex.stats.total = Object.keys(promptIndex.prompts).length;
          for (const cat of ['autonomous', 'legacyai', 'skills', 'templates', 'reference']) {
            promptIndex.stats.by_category[cat] = Object.values(promptIndex.prompts)
              .filter(p => p.category === cat).length;
          }

          // Update last_updated
          promptIndex.last_updated = new Date().toISOString();

          // Save the updated index
          saveIndex(promptIndex);
        }
      }

      res.status(201).json({
        created: createdPrompts,
        total: createdPrompts.length,
        errors: errors.length > 0 ? errors : undefined,
      });
    });

    // ============================================================================
    // IMPORT ENDPOINTS
    // ============================================================================

    // POST /api/import - Parse and import prompt files
    api.post('/import', (req: any, res) => {
      const upload = (this.app as any).upload;

      // Use multer middleware inline for this route
      upload.array('files', MAX_FILES_PER_IMPORT)(req, res, async (err: any) => {
        if (err) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
              error: 'File too large',
              message: `Maximum file size is ${MAX_FILE_SIZE / 1024}KB`,
            });
          }
          if (err.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
              error: 'Too many files',
              message: `Maximum ${MAX_FILES_PER_IMPORT} files per import`,
            });
          }
          if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({
              error: 'Invalid field name',
              message: 'Use "files" as the field name for uploaded files',
            });
          }
          return res.status(400).json({
            error: 'Upload failed',
            message: err.message,
          });
        }

        const files = req.files as Express.Multer.File[];

        if (!files || files.length === 0) {
          return res.status(400).json({
            error: 'No files provided',
            message: 'Upload at least one file',
          });
        }

        // Check if GLM API is configured
        if (!GLM_API_KEY) {
          // Fallback: Basic parsing without LLM
          const fallbackResults = files.map((file: Express.Multer.File) => {
            const content = file.buffer.toString('utf-8');
            const fileName = file.originalname.replace(/\.[^/.]+$/, '');

            // Basic extraction
            const lines = content.split('\n').filter(l => l.trim());
            const name = fileName
              .replace(/[-_]/g, ' ')
              .replace(/\b\w/g, l => l.toUpperCase())
              .substring(0, 60);

            const description = lines[0]?.substring(0, 200) || '';

            // Simple category detection
            let category = 'skills';
            const lowerContent = content.toLowerCase();
            if (lowerContent.includes('self-improving') || lowerContent.includes('recursive') || lowerContent.includes('agent')) {
              category = 'autonomous';
            } else if (lowerContent.includes('legacy ai') || lowerContent.includes('team builder')) {
              category = 'legacyai';
            } else if (lowerContent.includes('template') || lowerContent.includes('framework')) {
              category = 'templates';
            } else if (lowerContent.includes('documentation') || lowerContent.includes('guide')) {
              category = 'reference';
            }

            return {
              originalFileName: file.originalname,
              name,
              description,
              content,
              category,
              tags: [],
            };
          });

          return res.json({
            prompts: fallbackResults,
            source: 'basic',
            message: 'GLM API not configured - using basic parsing',
          });
        }

        // Use GLM-4.7 for intelligent parsing
        try {
          // Prepare file data for LLM
          const filesData = files.map((file: Express.Multer.File) => ({
            name: file.originalname,
            size: file.size,
            content: file.buffer.toString('utf-8'),
          }));

          // Build prompt for GLM
          const userPrompt = `Parse the following ${filesData.length} file(s) and extract prompt data.

${filesData.map((f, i) => `
--- File ${i + 1}: ${f.name} (${f.size} bytes) ---
${f.content}
--- End of File ${i + 1} ---
`).join('\n')}

Return a JSON array with parsed prompt data following the specified schema.`;

          // Check GLM rate limit
          const clientId = (req as any).ip || 'unknown';
          if (!this.glmRateLimiter.check(clientId)) {
            return res.status(429).json({
              error: 'Too many GLM requests',
              message: 'Rate limit exceeded. Please try again later.',
            });
          }

          // Call GLM API
          const glmResponse = await fetch(GLM_CODING_API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${GLM_API_KEY}`,
            },
            body: JSON.stringify({
              model: 'glm-4.7',
              messages: [
                { role: 'system', content: IMPORT_PARSER_SYSTEM },
                { role: 'user', content: userPrompt },
              ],
              temperature: 0.3,
              max_tokens: 8000,
            }),
          });

          if (!glmResponse.ok) {
            throw new Error(`GLM API error: ${glmResponse.statusText}`);
          }

          const glmData = await glmResponse.json() as GLMResponse;
          const llmContent = glmData.choices[0]?.message?.content || '';

          // Parse JSON response
          let parsedPrompts: any[] = [];
          try {
            // Extract JSON from response (handle markdown code blocks)
            let jsonStr = llmContent;

            // Remove markdown code blocks if present
            const jsonMatch = jsonStr.match(/```(?:json)?\s*(\[.*?\]|{.*?})\s*```/s);
            if (jsonMatch) {
              jsonStr = jsonMatch[1];
            } else {
              // Try to find raw JSON array
              const arrayMatch = jsonStr.match(/\[.*\]/s);
              if (arrayMatch) {
                jsonStr = arrayMatch[0];
              }
            }

            parsedPrompts = JSON.parse(jsonStr);
          } catch (parseError) {
            log.warn('Failed to parse GLM response, using fallback', { error: parseError });

            // Fallback to basic parsing
            const fallbackResults = files.map((file: Express.Multer.File) => {
              const content = file.buffer.toString('utf-8');
              const fileName = file.originalname.replace(/\.[^/.]+$/, '');
              return {
                originalFileName: file.originalname,
                name: fileName.substring(0, 60),
                description: content.split('\n')[0]?.substring(0, 200) || '',
                content,
                category: 'skills',
                tags: [],
              };
            });

            return res.json({
              prompts: fallbackResults,
              source: 'fallback',
              message: 'LLM parsing failed, used basic extraction',
            });
          }

          // Add original filenames
          const result = parsedPrompts.map((p: any, i: number) => ({
            ...p,
            originalFileName: files[i]?.originalname || `file-${i}`,
          }));

          res.json({
            prompts: result,
            source: 'glm',
            count: result.length,
          });
        } catch (glmError) {
          logError(glmError as Error, { context: 'import GLM parsing' });

          // Return error with fallback suggestion
          return res.status(500).json({
            error: 'Import parsing failed',
            message: glmError instanceof Error ? glmError.message : 'Unknown error',
            suggestion: 'Try uploading individual files or ensure files contain readable text',
          });
        }
      });
    });

    // ============================================================================
    // SEARCH ENDPOINT
    // ============================================================================

    // GET /api/search - Search prompts
    api.get('/search', (req, res) => {
      const result = SearchQuerySchema.safeParse(req.query);
      if (!result.success) {
        return res.status(400).json({
          error: 'Invalid search parameters',
          details: result.error.flatten(),
        });
      }

      const { q, tag, type, limit } = result.data;
      const index = loadIndex();

      if (!index) {
        return res.status(503).json({
          error: 'Prompt Library index not found',
        });
      }

      const query = q?.toLowerCase() || '';
      const tagFilter = tag?.toLowerCase() || '';
      const typeFilter = type?.toLowerCase() || '';

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

      res.json({
        query: q || '',
        total: results.length,
        returned: limited.length,
        results: limited.map(p => ({
          id: p.id,
          name: p.name,
          category: p.category,
          role: p.metadata.role || '',
          tags: p.metadata.tags_list || [],
          description: p.metadata.description || '',
          preview: p.preview.substring(0, 150) + '...',
        })),
      });
    });

    // ============================================================================
    // FAVORITES ENDPOINTS
    // ============================================================================

    // GET /api/favorites - Get all favorite prompts
    api.get('/favorites', (req, res) => {
      const favorites = loadFavorites();
      const index = loadIndex();

      if (!index) {
        return res.status(503).json({
          error: 'Prompt Library index not found',
        });
      }

      const favoritePrompts = favorites.prompts
        .map(id => index.prompts[id])
        .filter(Boolean);

      res.json({
        favorites: favorites.prompts,
        prompts: favoritePrompts.map(p => ({
          id: p.id,
          name: p.name,
          category: p.category,
          role: p.metadata.role || '',
          tags: p.metadata.tags_list || [],
        })),
      });
    });

    // POST /api/favorites/:id - Add/remove favorite
    api.post('/favorites/:id', (req, res) => {
      const { id } = req.params;
      const index = loadIndex();

      if (!index) {
        return res.status(503).json({
          error: 'Prompt Library index not found',
        });
      }

      let prompt = index.prompts[id];
      if (!prompt) {
        const upperId = id.toUpperCase();
        for (const [pid, p] of Object.entries(index.prompts)) {
          if (pid.startsWith(upperId) || pid.split(':')[1]?.startsWith(upperId.replace(/[^a-z0-9-]/gi, ''))) {
            prompt = p;
            break;
          }
        }
      }

      if (!prompt) {
        return res.status(404).json({
          error: 'Prompt not found',
          message: `Prompt '${id}' not found.`,
        });
      }

      const favorites = loadFavorites();
      const indexInFavorites = favorites.prompts.indexOf(prompt.id);

      if (indexInFavorites === -1) {
        favorites.prompts.push(prompt.id);
        saveFavorites(favorites);
        this.wsManager.broadcastPromptUpdate(prompt.id, 'created');
        res.json({
          favorited: true,
          prompt_id: prompt.id,
        });
      } else {
        favorites.prompts.splice(indexInFavorites, 1);
        saveFavorites(favorites);
        this.wsManager.broadcastPromptUpdate(prompt.id, 'deleted');
        res.json({
          favorited: false,
          prompt_id: prompt.id,
        });
      }
    });

    // DELETE /api/favorites/:id - Remove favorite
    api.delete('/favorites/:id', (req, res) => {
      const { id } = req.params;
      const favorites = loadFavorites();
      const indexInFavorites = favorites.prompts.indexOf(id);

      if (indexInFavorites === -1) {
        return res.status(404).json({
          error: 'Favorite not found',
        });
      }

      favorites.prompts.splice(indexInFavorites, 1);
      saveFavorites(favorites);
      this.wsManager.broadcastPromptUpdate(id, 'deleted');

      res.json({
        favorited: false,
        prompt_id: id,
      });
    });

    // POST /api/prompts/favorites - Sync favorites (bulk update)
    api.post('/prompts/favorites', (req, res) => {
      const result = SyncFavoritesSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          error: 'Invalid favorites data',
          details: result.error.flatten(),
        });
      }

      const { prompts: newFavoriteIds } = result.data;
      const index = loadIndex();

      if (!index) {
        return res.status(503).json({
          error: 'Prompt Library index not found',
        });
      }

      // Validate all prompt IDs exist
      const validIds: string[] = [];
      for (const id of newFavoriteIds) {
        let prompt = index.prompts[id];
        if (!prompt) {
          const upperId = id.toUpperCase();
          for (const [pid, p] of Object.entries(index.prompts)) {
            if (pid.startsWith(upperId) || pid.split(':')[1]?.startsWith(upperId.replace(/[^a-z0-9-]/gi, ''))) {
              prompt = p;
              break;
            }
          }
        }
        if (prompt) {
          validIds.push(prompt.id);
        }
      }

      const favorites: FavoritesStore = { prompts: validIds };
      saveFavorites(favorites);

      // Broadcast update for all affected prompts
      for (const id of validIds) {
        this.wsManager.broadcastPromptUpdate(id, 'created');
      }

      res.json({
        favorites: validIds,
        count: validIds.length,
      });
    });

    // ============================================================================
    // CHAINS ENDPOINTS
    // ============================================================================

    // GET /api/chains - List chains
    api.get('/chains', (req, res) => {
      const chains = loadChains();

      res.json({
        chains: Object.values(chains).map(c => ({
          id: c.id,
          name: c.name,
          description: c.description,
          step_count: c.steps.length,
          created_at: c.created_at,
          updated_at: c.updated_at,
          last_run: c.last_run,
        })),
      });
    });

    // GET /api/chains/:id - Get single chain
    api.get('/chains/:id', (req, res) => {
      const chains = loadChains();
      const chain = chains[req.params.id];

      if (!chain) {
        return res.status(404).json({
          error: 'Chain not found',
        });
      }

      res.json(chain);
    });

    // POST /api/chains - Create chain
    api.post('/chains', (req, res) => {
      const result = CreateChainSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          error: 'Invalid chain data',
          details: result.error.flatten(),
        });
      }

      const { name, description, steps } = result.data;
      const chains = loadChains();
      const index = loadIndex();

      if (!index) {
        return res.status(503).json({
          error: 'Prompt Library index not found',
        });
      }

      // Validate all prompt IDs exist
      for (const step of steps) {
        let prompt = index.prompts[step.prompt_id];
        if (!prompt) {
          for (const [pid, p] of Object.entries(index.prompts)) {
            if (pid.startsWith(step.prompt_id.toUpperCase())) {
              prompt = p;
              break;
            }
          }
        }
        if (!prompt) {
          return res.status(400).json({
            error: 'Invalid prompt ID',
            message: `Prompt '${step.prompt_id}' not found.`,
          });
        }
      }

      // Sort steps by order
      steps.sort((a, b) => a.order - b.order);

      const id = `chain_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const now = new Date().toISOString();

      const chain: Chain = {
        id,
        name,
        description,
        steps,
        created_at: now,
        updated_at: now,
      };

      chains[id] = chain;
      saveChains(chains);
      this.wsManager.broadcastChainUpdate(id, 'created');

      res.status(201).json(chain);
    });

    // PUT /api/chains/:id - Update chain
    api.put('/chains/:id', (req, res) => {
      const chains = loadChains();
      const existingChain = chains[req.params.id];

      if (!existingChain) {
        return res.status(404).json({
          error: 'Chain not found',
        });
      }

      const result = CreateChainSchema.partial().safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          error: 'Invalid chain data',
          details: result.error.flatten(),
        });
      }

      const { name, description, steps } = result.data;

      const updatedChain: Chain = {
        ...existingChain,
        name: name || existingChain.name,
        description: description !== undefined ? description : existingChain.description,
        steps: steps || existingChain.steps,
        updated_at: new Date().toISOString(),
      };

      chains[req.params.id] = updatedChain;
      saveChains(chains);
      this.wsManager.broadcastChainUpdate(req.params.id, 'updated');

      res.json(updatedChain);
    });

    // DELETE /api/chains/:id - Delete chain
    api.delete('/chains/:id', (req, res) => {
      const chains = loadChains();
      const chain = chains[req.params.id];

      if (!chain) {
        return res.status(404).json({
          error: 'Chain not found',
        });
      }

      delete chains[req.params.id];
      saveChains(chains);
      this.wsManager.broadcastChainUpdate(req.params.id, 'deleted');

      res.json({
        deleted: true,
        id: req.params.id,
      });
    });

    // POST /api/chains/:id/run - Execute chain
    api.post('/chains/:id/run', async (req, res) => {
      const chains = loadChains();
      const chain = chains[req.params.id];

      if (!chain) {
        return res.status(404).json({
          error: 'Chain not found',
        });
      }

      const result = RunChainSchema.safeParse(req.body);
      const globalVariables = result.success ? (result.data.variables || {}) : {};

      const index = loadIndex();
      if (!index) {
        return res.status(503).json({
          error: 'Prompt Library index not found',
        });
      }

      const executionResults: ChainExecutionResult = {
        chain_id: chain.id,
        status: 'running',
        results: [],
        started_at: new Date().toISOString(),
      };

      // Notify start
      this.wsManager.broadcastChainUpdate(chain.id, 'executed');

      // Execute steps sequentially
      for (const step of chain.steps) {
        try {
          let prompt = index.prompts[step.prompt_id];
          if (!prompt) {
            for (const [pid, p] of Object.entries(index.prompts)) {
              if (pid.startsWith(step.prompt_id.toUpperCase())) {
                prompt = p;
                break;
              }
            }
          }

          if (!prompt) {
            executionResults.results.push({
              step: step.order,
              prompt_id: step.prompt_id,
              content: '',
              error: 'Prompt not found',
            });
            continue;
          }

          let content = getPromptContent(prompt);

          // Apply variables
          const mergedVars = { ...globalVariables, ...step.variables };
          for (const [key, value] of Object.entries(mergedVars)) {
            content = content.replace(new RegExp(`{{${key}}}`, 'g'), value);
            content = content.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
          }

          executionResults.results.push({
            step: step.order,
            prompt_id: prompt.id,
            content,
          });

          // Track usage for each prompt
          incrementUsage(prompt.id, prompt.name);
        } catch (error) {
          executionResults.results.push({
            step: step.order,
            prompt_id: step.prompt_id,
            content: '',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      executionResults.status = executionResults.results.some(r => r.error)
        ? 'failed'
        : 'completed';
      executionResults.completed_at = new Date().toISOString();

      // Record execution history
      const startedAt = new Date(executionResults.started_at).getTime();
      const completedAt = new Date(executionResults.completed_at!).getTime();
      const stepsCompleted = executionResults.results.filter(r => !r.error).length;

      addExecutionRecord({
        id: `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: 'chain',
        target_id: chain.id,
        target_name: chain.name,
        status: executionResults.status === 'completed' ? 'completed' : 'failed',
        started_at: executionResults.started_at,
        completed_at: executionResults.completed_at!,
        duration_ms: completedAt - startedAt,
        steps_total: chain.steps.length,
        steps_completed: stepsCompleted,
      });

      // Update chain's last_run timestamp
      const chainsData = loadChains();
      if (chainsData[chain.id]) {
        chainsData[chain.id].last_run = executionResults.completed_at || new Date().toISOString();
        chainsData[chain.id].updated_at = new Date().toISOString();
        saveChains(chainsData);
      }

      this.wsManager.broadcastChainUpdate(chain.id, 'executed');

      res.json(executionResults);
    });

    // ============================================================================
    // WORKFLOWS ENDPOINTS
    // ============================================================================

    // GET /api/workflows - List workflows
    api.get('/workflows', (req, res) => {
      const workflows = loadWorkflows();

      res.json({
        workflows: Object.values(workflows).map(w => ({
          id: w.id,
          name: w.name,
          description: w.description,
          node_count: w.nodes.length,
          created_at: w.created_at,
          updated_at: w.updated_at,
        })),
      });
    });

    // GET /api/workflows/:id - Get single workflow
    api.get('/workflows/:id', (req, res) => {
      const workflows = loadWorkflows();
      const workflow = workflows[req.params.id];

      if (!workflow) {
        return res.status(404).json({
          error: 'Workflow not found',
        });
      }

      res.json(workflow);
    });

    // POST /api/workflows - Create workflow
    api.post('/workflows', (req, res) => {
      const result = CreateWorkflowSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          error: 'Invalid workflow data',
          details: result.error.flatten(),
        });
      }

      const { name, description, nodes, edges } = result.data;
      const workflows = loadWorkflows();
      const index = loadIndex();

      if (!index) {
        return res.status(503).json({
          error: 'Prompt Library index not found',
        });
      }

      // Validate all prompt IDs exist
      for (const node of nodes) {
        let prompt = index.prompts[node.prompt_id];
        if (!prompt) {
          for (const [pid, p] of Object.entries(index.prompts)) {
            if (pid.startsWith(node.prompt_id.toUpperCase())) {
              prompt = p;
              break;
            }
          }
        }
        if (!prompt) {
          return res.status(400).json({
            error: 'Invalid prompt ID',
            message: `Prompt '${node.prompt_id}' not found.`,
          });
        }

        // Validate dependencies exist
        for (const dep of node.dependencies) {
          if (!nodes.find(n => n.id === dep)) {
            return res.status(400).json({
              error: 'Invalid dependency',
              message: `Node '${dep}' not found in workflow.`,
            });
          }
        }
      }

      // Check for circular dependencies (basic check)
      const visited = new Set<string>();
      const recursionStack = new Set<string>();

      const hasCycle = (nodeId: string): boolean => {
        if (recursionStack.has(nodeId)) return true;
        if (visited.has(nodeId)) return false;

        visited.add(nodeId);
        recursionStack.add(nodeId);

        const node = nodes.find(n => n.id === nodeId);
        if (node) {
          for (const dep of node.dependencies) {
            if (hasCycle(dep)) return true;
          }
        }

        recursionStack.delete(nodeId);
        return false;
      };

      for (const node of nodes) {
        if (hasCycle(node.id)) {
          return res.status(400).json({
            error: 'Circular dependency detected',
            message: 'Workflow cannot contain circular dependencies.',
          });
        }
      }

      const id = `workflow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const now = new Date().toISOString();

      const workflow: Workflow = {
        id,
        name,
        description,
        nodes,
        edges,
        created_at: now,
        updated_at: now,
      };

      workflows[id] = workflow;
      saveWorkflows(workflows);
      this.wsManager.broadcastWorkflowUpdate(id, 'created');

      res.status(201).json(workflow);
    });

    // PUT /api/workflows/:id - Update workflow
    api.put('/workflows/:id', (req, res) => {
      const workflows = loadWorkflows();
      const existingWorkflow = workflows[req.params.id];

      if (!existingWorkflow) {
        return res.status(404).json({
          error: 'Workflow not found',
        });
      }

      const result = CreateWorkflowSchema.partial().safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          error: 'Invalid workflow data',
          details: result.error.flatten(),
        });
      }

      const { name, description, nodes, edges } = result.data;

      const updatedWorkflow: Workflow = {
        ...existingWorkflow,
        name: name || existingWorkflow.name,
        description: description !== undefined ? description : existingWorkflow.description,
        nodes: nodes || existingWorkflow.nodes,
        edges: edges !== undefined ? edges : existingWorkflow.edges,
        updated_at: new Date().toISOString(),
      };

      workflows[req.params.id] = updatedWorkflow;
      saveWorkflows(workflows);
      this.wsManager.broadcastWorkflowUpdate(req.params.id, 'updated');

      res.json(updatedWorkflow);
    });

    // DELETE /api/workflows/:id - Delete workflow
    api.delete('/workflows/:id', (req, res) => {
      const workflows = loadWorkflows();
      const workflow = workflows[req.params.id];

      if (!workflow) {
        return res.status(404).json({
          error: 'Workflow not found',
        });
      }

      delete workflows[req.params.id];
      saveWorkflows(workflows);
      this.wsManager.broadcastWorkflowUpdate(req.params.id, 'deleted');

      res.json({
        deleted: true,
        id: req.params.id,
      });
    });

    // POST /api/workflows/:id/run - Execute workflow
    api.post('/workflows/:id/run', async (req, res) => {
      const workflows = loadWorkflows();
      const workflow = workflows[req.params.id];

      if (!workflow) {
        return res.status(404).json({
          error: 'Workflow not found',
        });
      }

      const result = RunWorkflowSchema.safeParse(req.body);
      const globalVariables = result.success ? (result.data.variables || {}) : {};

      const index = loadIndex();
      if (!index) {
        return res.status(503).json({
          error: 'Prompt Library index not found',
        });
      }

      // Topological sort for workflow execution
      const sorted = this.topologicalSort(workflow.nodes);
      if (!sorted) {
        return res.status(400).json({
          error: 'Circular dependency detected',
          message: 'Cannot execute workflow with circular dependencies.',
        });
      }

      const executionResults: WorkflowExecutionResult = {
        workflow_id: workflow.id,
        status: 'running',
        results: [],
        started_at: new Date().toISOString(),
      };

      // Notify start
      this.wsManager.broadcastWorkflowUpdate(workflow.id, 'executed');

      // Execute nodes in topological order
      for (const node of sorted) {
        try {
          let prompt = index.prompts[node.prompt_id];
          if (!prompt) {
            for (const [pid, p] of Object.entries(index.prompts)) {
              if (pid.startsWith(node.prompt_id.toUpperCase())) {
                prompt = p;
                break;
              }
            }
          }

          if (!prompt) {
            executionResults.results.push({
              node_id: node.id,
              prompt_id: node.prompt_id,
              content: '',
              error: 'Prompt not found',
            });
            continue;
          }

          let content = getPromptContent(prompt);

          // Apply variables from previous steps
          const mergedVars = { ...globalVariables, ...node.variables };

          // Collect results from dependencies
          for (const depId of node.dependencies) {
            const depResult = executionResults.results.find(r => r.node_id === depId);
            if (depResult && !depResult.error) {
              mergedVars[`${depId}_result`] = depResult.content;
            }
          }

          for (const [key, value] of Object.entries(mergedVars)) {
            content = content.replace(new RegExp(`{{${key}}}`, 'g'), value);
            content = content.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
          }

          executionResults.results.push({
            node_id: node.id,
            prompt_id: prompt.id,
            content,
          });

          // Track usage for each prompt
          incrementUsage(prompt.id, prompt.name);
        } catch (error) {
          executionResults.results.push({
            node_id: node.id,
            prompt_id: node.prompt_id,
            content: '',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      executionResults.status = executionResults.results.some(r => r.error)
        ? 'failed'
        : 'completed';
      executionResults.completed_at = new Date().toISOString();

      // Record execution history
      const startedAt = new Date(executionResults.started_at).getTime();
      const completedAt = new Date(executionResults.completed_at!).getTime();
      const stepsCompleted = executionResults.results.filter(r => !r.error).length;

      addExecutionRecord({
        id: `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: 'workflow',
        target_id: workflow.id,
        target_name: workflow.name,
        status: executionResults.status === 'completed' ? 'completed' : 'failed',
        started_at: executionResults.started_at,
        completed_at: executionResults.completed_at!,
        duration_ms: completedAt - startedAt,
        steps_total: workflow.nodes.length,
        steps_completed: stepsCompleted,
      });

      this.wsManager.broadcastWorkflowUpdate(workflow.id, 'executed');

      res.json(executionResults);
    });

    // ============================================================================
    // EXECUTIONS ENDPOINTS
    // ============================================================================

    // GET /api/executions/trend - Get execution trend data
    api.get('/executions/trend', (req, res) => {
      const result = ExecutionsTrendSchema.safeParse(req.query);
      if (!result.success) {
        return res.status(400).json({
          error: 'Invalid query parameters',
          details: result.error.flatten(),
        });
      }

      const { days } = result.data;
      const now = new Date();
      const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

      const executionsStore = loadExecutions();

      // Filter executions within the date range
      const filteredExecutions = executionsStore.executions.filter(
        e => new Date(e.started_at) >= startDate
      );

      // Group by date (YYYY-MM-DD format)
      const trendByDate: Record<string, { chain: number; workflow: number; total: number }> = {};

      for (let i = 0; i < days; i++) {
        const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
        const dateKey = date.toISOString().split('T')[0];
        trendByDate[dateKey] = { chain: 0, workflow: 0, total: 0 };
      }

      for (const exec of filteredExecutions) {
        const dateKey = exec.started_at.split('T')[0];
        if (!trendByDate[dateKey]) {
          trendByDate[dateKey] = { chain: 0, workflow: 0, total: 0 };
        }
        if (exec.type === 'chain') {
          trendByDate[dateKey].chain++;
        } else if (exec.type === 'workflow') {
          trendByDate[dateKey].workflow++;
        }
        trendByDate[dateKey].total++;
      }

      // Convert to array for response
      const trend = Object.entries(trendByDate)
        .map(([date, counts]) => ({
          date,
          ...counts,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      // Calculate summary stats
      const totalExecutions = filteredExecutions.length;
      const successfulExecutions = filteredExecutions.filter(e => e.status === 'completed').length;
      const failedExecutions = filteredExecutions.filter(e => e.status === 'failed').length;
      const avgDuration = totalExecutions > 0
        ? filteredExecutions.reduce((sum, e) => sum + e.duration_ms, 0) / totalExecutions
        : 0;

      // Group by target for top usage
      const targetUsage: Record<string, { name: string; count: number; type: string }> = {};
      for (const exec of filteredExecutions) {
        const key = `${exec.type}:${exec.target_id}`;
        if (!targetUsage[key]) {
          targetUsage[key] = { name: exec.target_name, count: 0, type: exec.type };
        }
        targetUsage[key].count++;
      }

      const topTargets = Object.values(targetUsage)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      res.json({
        days,
        start_date: startDate.toISOString().split('T')[0],
        end_date: now.toISOString().split('T')[0],
        trend,
        summary: {
          total: totalExecutions,
          successful: successfulExecutions,
          failed: failedExecutions,
          success_rate: totalExecutions > 0 ? (successfulExecutions / totalExecutions * 100).toFixed(1) : '0.0',
          avg_duration_ms: Math.round(avgDuration),
        },
        top_targets: topTargets,
      });
    });

    // GET /api/executions - List recent executions
    api.get('/executions', (req, res) => {
      const limit = parseInt(req.query.limit as string || '50', 10);
      const offset = parseInt(req.query.offset as string || '0', 10);

      const executionsStore = loadExecutions();

      // Sort by started_at descending and paginate
      const sorted = [...executionsStore.executions]
        .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
        .slice(offset, offset + limit);

      res.json({
        executions: sorted,
        total: executionsStore.executions.length,
        limit,
        offset,
      });
    });

    // ============================================================================
    // GLM API PROXY ENDPOINTS
    // ============================================================================

    // POST /api/proxy/glm/generate - Generate workflow via GLM-4.7 Coding API
    api.post('/proxy/glm/generate', async (req, res) => {
      // Check GLM API key is configured
      if (!GLM_API_KEY) {
        return res.status(500).json({
          error: 'GLM API not configured',
          message: 'Server-side GLM_CODING_API_KEY is not set. Please contact the administrator.',
        });
      }

      // Validate request body
      const GenerateWorkflowSchema = z.object({
        description: z.string().min(1, 'Workflow description is required'),
        options: z.object({
          temperature: z.number().min(0).max(2).optional(),
          max_tokens: z.number().int().positive().optional(),
        }).optional(),
      });

      const result = GenerateWorkflowSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          error: 'Invalid request',
          details: result.error.flatten(),
        });
      }

      const { description, options = {} } = result.data;

      // Apply GLM-specific rate limiting
      const clientId = req.ip || 'unknown';
      if (!this.glmRateLimiter.check(clientId)) {
        return res.status(429).json({
          error: 'Too many GLM API requests',
          message: 'Rate limit exceeded for workflow generation. Please try again later.',
          retry_after: 60,
        });
      }

      const systemPrompt = `You are a workflow generation expert. Create a JSON workflow definition based on user requests.

The workflow JSON must follow this exact schema:
{
  "name": "string - workflow name",
  "description": "string - workflow description",
  "nodes": [
    {"id": "string", "type": "START|AGENT|PROMPT|CONDITION|END", "label": "string", "x": number, "y": number}
  ],
  "edges": [
    {"id": "string", "source": "node_id", "target": "node_id", "label": "optional string"}
  ]
}

Rules:
- Position nodes logically (x increases left to right, y for vertical spacing)
- Start node at x=50
- Connect nodes sequentially unless user specifies parallel paths
- Return ONLY valid JSON, no markdown formatting`;

      const messages: GLMMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Create a workflow for: ${description}` }
      ];

      try {
        const glmRequest: GLMRequest = {
          model: 'glm-4.7',
          messages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.max_tokens ?? 2000,
          top_p: 0.9,
        };

        const response = await fetch(GLM_CODING_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GLM_API_KEY}`,
          },
          body: JSON.stringify(glmRequest),
        });

        if (!response.ok) {
          const errorText = await response.text();
          log.error('GLM API request failed', {
            status: response.status,
            error: errorText,
            requestId: (req as any).requestId,
          });

          // Return detailed error without exposing the API key
          return res.status(response.status).json({
            error: 'GLM API request failed',
            message: `The GLM API returned an error: ${response.status}`,
            status: response.status,
          });
        }

        const data: GLMResponse = await response.json();

        if (!data.choices || data.choices.length === 0) {
          return res.status(502).json({
            error: 'Invalid GLM response',
            message: 'No choices returned from GLM API',
          });
        }

        // GLM-4.7 Coding API may return content in reasoning_content field
        const message = data.choices[0].message;
        const content = message.content || message.reasoning_content || '';

        if (!content) {
          return res.status(502).json({
            error: 'Empty GLM response',
            message: 'GLM API returned empty content',
          });
        }

        // Extract JSON from response (may be wrapped in markdown code blocks)
        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                         content.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
          return res.status(502).json({
            error: 'Invalid workflow JSON',
            message: 'Could not extract valid JSON from GLM response',
            raw_content: content.substring(0, 500),
          });
        }

        let workflow: any;
        try {
          workflow = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        } catch (parseError) {
          return res.status(502).json({
            error: 'JSON parse error',
            message: 'Failed to parse workflow JSON from GLM response',
            raw_content: jsonMatch[0]?.substring(0, 500),
          });
        }

        // Validate workflow structure
        const WorkflowValidationSchema = z.object({
          name: z.string(),
          description: z.string(),
          nodes: z.array(z.object({
            id: z.string(),
            type: z.enum(['START', 'AGENT', 'PROMPT', 'CONDITION', 'END']),
            label: z.string(),
            x: z.number(),
            y: z.number(),
          })),
          edges: z.array(z.object({
            id: z.string(),
            source: z.string(),
            target: z.string(),
            label: z.string().optional(),
          })),
        });

        const validationResult = WorkflowValidationSchema.safeParse(workflow);
        if (!validationResult.success) {
          return res.status(502).json({
            error: 'Invalid workflow structure',
            message: 'GLM returned an invalid workflow structure',
            details: validationResult.error.flatten(),
          });
        }

        // Return successful response
        res.json({
          success: true,
          workflow: validationResult.data,
          usage: {
            prompt_tokens: data.usage.prompt_tokens,
            completion_tokens: data.usage.completion_tokens,
            total_tokens: data.usage.total_tokens,
          },
          model: data.model,
        });

      } catch (error) {
        logApiError(error as Error, req, { endpoint: '/api/proxy/glm/generate' });
        res.status(500).json({
          error: 'Internal proxy error',
          message: error instanceof Error ? error.message : 'Unknown error occurred',
        });
      }
    });

    // GET /api/proxy/glm/status - Check GLM proxy availability
    api.get('/proxy/glm/status', (req, res) => {
      res.json({
        available: !!GLM_API_KEY,
        message: GLM_API_KEY
          ? 'GLM proxy is available'
          : 'GLM_CODING_API_KEY not configured on server',
      });
    });

    // Mount API routes
    this.app.use('/api', api);
  }

  /**
   * Topological sort for workflow DAG execution
   * Returns ordered nodes or null if cycle detected
   */
  private topologicalSort(nodes: WorkflowNode[]): WorkflowNode[] | null {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>();

    // Initialize in-degrees and adjacency list
    for (const node of nodes) {
      inDegree.set(node.id, node.dependencies.length);
      adjList.set(node.id, []);
    }

    // Build adjacency list (reverse dependencies)
    for (const node of nodes) {
      for (const dep of node.dependencies) {
        adjList.get(dep)?.push(node.id);
      }
    }

    // Kahn's algorithm
    const queue: string[] = [];
    const result: WorkflowNode[] = [];

    // Start with nodes that have no dependencies
    for (const [id, degree] of inDegree) {
      if (degree === 0) {
        queue.push(id);
      }
    }

    while (queue.length > 0) {
      const id = queue.shift()!;
      const node = nodeMap.get(id);
      if (node) {
        result.push(node);
      }

      for (const neighbor of adjList.get(id) || []) {
        const newDegree = (inDegree.get(neighbor) || 0) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }

    // Check for cycle
    if (result.length !== nodes.length) {
      return null;
    }

    return result;
  }

  private setupErrorHandlers(): void {
    // 404 handler
    this.app.use((req, res) => {
      const requestId = (req as any).requestId || 'unknown';
      logger.warn('Route not found', {
        requestId,
        method: req.method,
        path: req.path,
      });
      res.status(404).json({
        error: 'Not found',
        message: `Route ${req.method} ${req.path} not found`,
      });
    });

    // Error handler
    this.app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      const requestId = (req as any).requestId || 'unknown';
      logApiError(err, req);
      res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined,
        requestId,
      });
    });
  }

  /**
   * Start the HTTP server
   */
  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        log.info('HTTP Server started', {
          port: this.port,
          wsEndpoint: `ws://localhost:${this.port}/api/ws`,
          apiEndpoint: `http://localhost:${this.port}/api`,
          nodeEnv: process.env.NODE_ENV || 'development',
        });
        resolve();
      });
    });
  }

  /**
   * Stop the HTTP server
   */
  public stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        log.info('HTTP Server closed', { port: this.port });
        resolve();
      });
    });
  }
}
