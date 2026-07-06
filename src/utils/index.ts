/*
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export * from './logger';
export * from './advanced';
export * from './cache';
export * from './validation';

// Re-export services from service barrel to maintain clean imports
export { default as CacheService } from '../services/CacheService';
export { default as GenerationService } from '../services/GenerationService';
export { default as MetricsService } from '../services/MetricsService';
export { default as ProviderService } from '../services/ProviderService';
export { default as QualityService } from '../services/QualityService';

export interface ItemMapping {
  id: string;
  format: string;
  topic: string;
  metadata: {
    reasoning: string;
    intent: string;
    complexity: string;
    is_negative: boolean;
    correction?: string;
  };
  alpaca?: {
    instruction: string;
    input: string;
    output: string;
  };
  sharegpt?: {
    messages: {
      role: 'system' | 'user' | 'assistant';
      content: string;
    }[];
  };
  qa?: {
    question: string;
    answer: string;
  };
  raw?: {
    title: string;
    text: string;
  };
}

export function mapItemToFormat(item: any, format: string, id: string, topic: string): ItemMapping {
  const itemTopic = item.topic || "General Concepts";
  const metadata = item.metadata || {
    reasoning: "No reasoning provided",
    intent: "General",
    complexity: "intermediate",
    is_negative: false
  };
  
  switch (format) {
    case "alpaca":
      return {
        id,
        format: "alpaca",
        topic: itemTopic,
        metadata,
        alpaca: {
          instruction: item.instruction || "No instruction provided",
          input: item.input || "",
          output: item.output || ""
        }
      };
    case "sharegpt":
      return {
        id,
        format: "sharegpt",
        topic: itemTopic,
        metadata,
        sharegpt: {
          messages: item.messages || [
            { role: "system", content: "You are an expert assistant." },
            { role: "user", content: "Tell me about this topic." },
            { role: "assistant", content: "Here is the key info." }
          ]
        }
      };
    case "qa":
      return {
        id,
        format: "qa",
        topic: itemTopic,
        metadata,
        qa: {
          question: item.question || "What is this topic?",
          answer: item.answer || "Detail answer of this topic"
        }
      };
    case "raw":
      return {
        id,
        format: "raw",
        topic: itemTopic,
        metadata,
        raw: {
          title: item.title || "Section Overview",
          text: item.text || "Detailed text contents"
        }
      };
    default:
      return {
        id,
        format: "raw",
        topic: itemTopic,
        metadata,
        raw: {
          title: "Unknown Format",
          text: "Data in unknown format"
        }
      };
  }
}

export function createItemMapper(format: string) {
  return (item: any, id: string, topic: string) => {
    return mapItemToFormat(item, format, id, topic);
  };
}

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeout: number;
  monitoringPeriod: number;
}

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private nextAttempt = Date.now();
  private successCount = 0;
  
  private readonly failureThreshold: number;
  private readonly resetTimeout: number;
  private readonly monitoringPeriod: number;

  constructor(options: Partial<CircuitBreakerOptions> = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeout = options.resetTimeout ?? 60000;
    this.monitoringPeriod = options.monitoringPeriod ?? 10000;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttempt) {
        const error = new Error('Circuit breaker is OPEN');
        (error as any).code = 'CIRCUIT_OPEN';
        throw error;
      }
      this.state = CircuitState.HALF_OPEN;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= 2) {
        this.state = CircuitState.CLOSED;
        this.successCount = 0;
      }
    }
  }

  private onFailure(): void {
    this.failureCount++;
    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      this.nextAttempt = Date.now() + this.resetTimeout;
    } else if (this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.nextAttempt = Date.now() + this.resetTimeout;
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttempt = Date.now();
  }

  getStatus(): { state: string; failureCount: number; nextAttempt: number } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      nextAttempt: this.nextAttempt
    };
  }
}

export class CircuitBreakerRegistry {
  private static instance: CircuitBreakerRegistry;
  private breakers = new Map<string, CircuitBreaker>();

  static getInstance(): CircuitBreakerRegistry {
    if (!CircuitBreakerRegistry.instance) {
      CircuitBreakerRegistry.instance = new CircuitBreakerRegistry();
    }
    return CircuitBreakerRegistry.instance;
  }

  get(name: string): CircuitBreaker {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker());
    }
    return this.breakers.get(name)!;
  }

  getAllStatus(): Record<string, { state: string; failureCount: number }> {
    const status: Record<string, { state: string; failureCount: number }> = {};
    this.breakers.forEach((breaker, name) => {
      status[name] = breaker.getStatus();
    });
    return status;
  }

  reset(name: string): void {
    const breaker = this.breakers.get(name);
    if (breaker) {
      breaker.reset();
    }
  }
}

export function hashConfig(config: any): string {
  const str = JSON.stringify(config, Object.keys(config).sort());
  return require('crypto').createHash('sha256').update(str).digest('hex').substring(0, 16);
}

export function escapeCsvField(value: string): string {
  if (!value) return value;
  const trimmed = value.trim();
  if (/^[=+\-@]/.test(trimmed)) {
    return `'${trimmed}`;
  }
  if (/[,"\n\r]/.test(trimmed)) {
    return `"${trimmed.replace(/"/g, '""')}"`;
  }
  return trimmed;
}

export function computeETag(data: any): string {
  const str = JSON.stringify(data);
  return require('crypto').createHash('md5').update(str).digest('hex');
}

export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
}

export class RateLimiter {
  private requests = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(options: Partial<RateLimitOptions> = {}) {
    this.windowMs = options.windowMs ?? 60000;
    this.maxRequests = options.maxRequests ?? 100;
  }

  isAllowed(key: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    let userRequests = this.requests.get(key) || [];
    userRequests = userRequests.filter(timestamp => timestamp > windowStart);
    
    const remaining = Math.max(0, this.maxRequests - userRequests.length);
    const allowed = userRequests.length < this.maxRequests;
    
    if (allowed) {
      userRequests.push(now);
      this.requests.set(key, userRequests);
    }
    
    const resetAt = now + this.windowMs;
    return { allowed, remaining, resetAt };
  }

  reset(key: string): void {
    this.requests.delete(key);
  }

  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    this.requests.forEach((timestamps, key) => {
      const filtered = timestamps.filter(ts => ts > windowStart);
      if (filtered.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, filtered);
      }
    });
  }
}

export interface MetricsOptions {
  enabled?: boolean;
  prefix?: string;
}

export interface MetricPoint {
  timestamp: number;
  value: number;
  labels?: Record<string, string>;
}

export class MetricsCollector {
  private static instance: MetricsCollector;
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private histograms = new Map<string, number[]>();
  private enabled: boolean;
  private prefix: string;

  private constructor(options: MetricsOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.prefix = options.prefix ?? 'llm_dataset_';
  }

  static getInstance(options?: MetricsOptions): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector(options);
    }
    return MetricsCollector.instance;
  }

  incCounter(name: string, value: number = 1, labels?: Record<string, string>): void {
    if (!this.enabled) return;
    const key = this.makeKey(name, labels);
    this.counters.set(key, (this.counters.get(key) || 0) + value);
  }

  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    if (!this.enabled) return;
    const key = this.makeKey(name, labels);
    this.gauges.set(key, value);
  }

  observeHistogram(name: string, value: number, labels?: Record<string, string>): void {
    if (!this.enabled) return;
    const key = this.makeKey(name, labels);
    if (!this.histograms.has(key)) {
      this.histograms.set(key, []);
    }
    this.histograms.get(key)!.push(value);
  }

  private makeKey(name: string, labels?: Record<string, string>): string {
    const base = `${this.prefix}${name}`;
    if (!labels) return base;
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return `${base}{${labelStr}}`;
  }

  getCounter(name: string, labels?: Record<string, string>): number {
    const key = this.makeKey(name, labels);
    return this.counters.get(key) || 0;
  }

  getGauge(name: string, labels?: Record<string, string>): number | undefined {
    const key = this.makeKey(name, labels);
    return this.gauges.get(key);
  }

  getHistogramStats(name: string, labels?: Record<string, string>): { 
    count: number; 
    sum: number; 
    avg: number; 
    min: number; 
    max: number;
    p50: number;
    p95: number;
    p99: number;
  } | null {
    const key = this.makeKey(name, labels);
    const values = this.histograms.get(key);
    if (!values || values.length === 0) return null;

    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    const count = values.length;
    
    const percentile = (p: number) => {
      const idx = Math.ceil((p / 100) * sorted.length) - 1;
      return sorted[Math.max(0, idx)];
    };

    return {
      count,
      sum,
      avg: sum / count,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p50: percentile(50),
      p95: percentile(95),
      p99: percentile(99)
    };
  }

  toPrometheusFormat(): string {
    const lines: string[] = [];

    this.counters.forEach((value, key) => {
      lines.push(`# TYPE ${key} counter`);
      lines.push(`${key} ${value}`);
    });

    this.gauges.forEach((value, key) => {
      lines.push(`# TYPE ${key} gauge`);
      lines.push(`${key} ${value}`);
    });

    this.histograms.forEach((values, key) => {
      const stats = this.getHistogramStats(key.replace(this.prefix, ''));
      if (stats) {
        lines.push(`# TYPE ${key} histogram`);
        lines.push(`${key}_count ${stats.count}`);
        lines.push(`${key}_sum ${stats.sum}`);
      }
    });

    return lines.join('\n');
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}

export const metrics = MetricsCollector.getInstance();

export function generateCorrelationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`;
}

export interface RequestContext {
  correlationId: string;
  startTime: number;
  labels: Record<string, string>;
}

export class RequestContextManager {
  private static instance: RequestContextManager;
  private contexts = new Map<string, RequestContext>();

  static getInstance(): RequestContextManager {
    if (!RequestContextManager.instance) {
      RequestContextManager.instance = new RequestContextManager();
    }
    return RequestContextManager.instance;
  }

  create(labels?: Record<string, string>): RequestContext {
    const correlationId = generateCorrelationId();
    const context: RequestContext = {
      correlationId,
      startTime: Date.now(),
      labels: labels || {}
    };
    this.contexts.set(correlationId, context);
    return context;
  }

  get(correlationId: string): RequestContext | undefined {
    return this.contexts.get(correlationId);
  }

  finalize(correlationId: string): void {
    this.contexts.delete(correlationId);
  }

  getDuration(correlationId: string): number | null {
    const context = this.contexts.get(correlationId);
    if (!context) return null;
    return Date.now() - context.startTime;
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public retryable: boolean = true,
    public errorCode?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ValidationRule {
  field: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  allowedValues?: string[];
}

export function validateRequest<T>(data: any, rules: ValidationRule[]): T {
  if (!data || typeof data !== 'object') {
    throw new ApiError('Request body must be a JSON object', 400, false);
  }

  for (const rule of rules) {
    const value = data[rule.field];

    if (rule.required && (value === undefined || value === null)) {
      throw new ApiError(`Missing required field: '${rule.field}'`, 400, false);
    }

    if (value === undefined || value === null) continue;

    if (rule.type === 'array' && !Array.isArray(value)) {
      throw new ApiError(`Field '${rule.field}' must be an array`, 400, false);
    }

    if (typeof value !== rule.type && rule.type !== 'array' && rule.type !== 'object') {
      throw new ApiError(`Field '${rule.field}' must be of type ${rule.type}`, 400, false);
    }

    // typeof NaN === 'number', and NaN < min / NaN > max are both always false —
    // so without this check a malformed numeric string (parseInt("banana") -> NaN)
    // silently clears any min/max range check below instead of being rejected.
    if (rule.type === 'number' && typeof value === 'number' && Number.isNaN(value)) {
      throw new ApiError(`Field '${rule.field}' must be a valid number`, 400, false);
    }

    if (rule.type === 'string' && typeof value === 'string') {
      if (rule.minLength !== undefined && value.length < rule.minLength) {
        throw new ApiError(`Field '${rule.field}' must be at least ${rule.minLength} characters`, 400, false);
      }
      if (rule.maxLength !== undefined && value.length > rule.maxLength) {
        throw new ApiError(`Field '${rule.field}' must be at most ${rule.maxLength} characters`, 400, false);
      }
    }

    if (rule.type === 'array' && Array.isArray(value)) {
      if (rule.minLength !== undefined && value.length < rule.minLength) {
        throw new ApiError(`Field '${rule.field}' must have at least ${rule.minLength} item(s)`, 400, false);
      }
      if (rule.maxLength !== undefined && value.length > rule.maxLength) {
        throw new ApiError(`Field '${rule.field}' must have at most ${rule.maxLength} item(s)`, 400, false);
      }
    }

    if (rule.type === 'number' && typeof value === 'number') {
      if (rule.min !== undefined && value < rule.min) {
        throw new ApiError(`Field '${rule.field}' must be >= ${rule.min}`, 400, false);
      }
      if (rule.max !== undefined && value > rule.max) {
        throw new ApiError(`Field '${rule.field}' must be <= ${rule.max}`, 400, false);
      }
    }

    if (rule.allowedValues && !rule.allowedValues.includes(value)) {
      throw new ApiError(`Field '${rule.field}' must be one of: ${rule.allowedValues.join(', ')}`, 400, false);
    }
  }

  return data as T;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000,
  backoffFactor: number = 2
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (error instanceof ApiError && !error.retryable) {
        throw error;
      }

      if (attempt < maxRetries) {
        const waitTime = delay * Math.pow(backoffFactor, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  throw lastError;
}

export function createTimeoutPromise<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError: string = 'Operation timed out'
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new ApiError(timeoutError, 504, true)), timeoutMs);
    })
  ]);
}

export class Logger {
  private static instance: Logger;
  private logs: Array<{ timestamp: number; level: string; message: string; error?: any }> = [];
  private readonly maxLogs = 1000;

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  info(message: string, error?: any): void {
    console.log(`[INFO] ${new Date().toISOString()} - ${message}`);
    this.log('info', message, error);
  }

  error(message: string, error?: any): void {
    console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, error);
    this.log('error', message, error);
  }

  warn(message: string, error?: any): void {
    console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, error);
    this.log('warn', message, error);
  }

  private log(level: string, message: string, error?: any): void {
    this.logs.push({
      timestamp: Date.now(),
      level,
      message,
      error
    });
    if (this.logs.length > this.maxLogs) {
      this.logs.splice(0, this.logs.length - this.maxLogs);
    }
  }

  getLogs(level?: string, since?: number): Array<{ timestamp: number; level: string; message: string; error?: any }> {
    let filtered = this.logs;
    if (level) {
      filtered = filtered.filter(log => log.level === level);
    }
    if (since) {
      filtered = filtered.filter(log => log.timestamp >= since);
    }
    return filtered;
  }

  clear(): void {
    this.logs = [];
  }
}

export const logger = Logger.getInstance();

export class Memoizer<T, R> {
  private cache = new Map<T, { value: R; timestamp: number }>();
  private readonly maxAge: number;

  constructor(maxAgeMs: number = 5 * 60 * 1000) {
    this.maxAge = maxAgeMs;
  }

  get(key: T): R | undefined {
    const item = this.cache.get(key);
    if (!item) return undefined;
    if (Date.now() - item.timestamp > this.maxAge) {
      this.cache.delete(key);
      return undefined;
    }
    return item.value;
  }

  set(key: T, value: R): void {
    this.cache.set(key, { value, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

export function getSchemaForFormat(format: string): Record<string, any> {
  const schema = {
    type: "OBJECT",
    properties: {
      items: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            metadata: {
              type: "OBJECT",
              properties: {
                reasoning: { type: "STRING", description: "Detailed step-by-step chain of thought explaining how the answer is derived." },
                intent: { type: "STRING", description: "The cognitive goal (e.g., 'Socratic', 'Adversarial', 'First-Principles', 'Deductive')." },
                complexity: { type: "STRING", enum: ["novice", "intermediate", "expert"] },
                is_negative: { type: "BOOLEAN", description: "Whether this example intentionally contains a logical flaw for contrastive learning." },
                correction: { type: "STRING", description: "If is_negative is true, the corrected reasoning and final answer." },
                trajectory: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      step: { type: "NUMBER" },
                      phase: { type: "STRING", enum: ["initial_attempt", "self_critique", "final_correction"] },
                      content: { type: "STRING" },
                      thought_process: { type: "STRING" }
                    },
                    required: ["step", "phase", "content"]
                  }
                },
                persona: {
                  type: "OBJECT",
                  properties: {
                    role: { type: "STRING" },
                    mental_state: { type: "STRING" },
                    constraint: { type: "STRING" }
                  }
                },
                interdisciplinary_link: {
                  type: "OBJECT",
                  properties: {
                    domain_a: { type: "STRING" },
                    domain_b: { type: "STRING" },
                    synthesis_bridge: { type: "STRING" }
                  }
                }
              },
              required: ["reasoning", "intent", "complexity", "is_negative"]
            }
          },
          required: ["metadata"]
        }
      }
    },
    required: ["items"]
  };

  switch (format) {
    case "alpaca":
      (schema.properties.items.items.properties as any).alpaca = {
        type: "OBJECT",
        properties: {
          instruction: { type: "STRING" },
          input: { type: "STRING" },
          output: { type: "STRING" }
        },
        required: ["instruction", "input", "output"]
      };
      schema.properties.items.items.required.push("alpaca");
      break;
    case "sharegpt":
      (schema.properties.items.items.properties as any).sharegpt = {
        type: "OBJECT",
        properties: {
          messages: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                role: { type: "STRING", enum: ["system", "user", "assistant"] },
                content: { type: "STRING" }
              },
              required: ["role", "content"]
            }
          }
        },
        required: ["messages"]
      };
      schema.properties.items.items.required.push("sharegpt");
      break;
    case "qa":
      (schema.properties.items.items.properties as any).qa = {
        type: "OBJECT",
        properties: {
          question: { type: "STRING" },
          answer: { type: "STRING" }
        },
        required: ["question", "answer"]
      };
      schema.properties.items.items.required.push("qa");
      break;
    case "raw":
      (schema.properties.items.items.properties as any).raw = {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          text: { type: "STRING" }
        },
        required: ["title", "text"]
      };
      schema.properties.items.items.required.push("raw");
      break;
    default:
      break;
  }

  return schema;
}

export function toJsonSchema(schema: any): any {
  if (Array.isArray(schema)) return schema.map(toJsonSchema);
  if (schema === null || typeof schema !== "object") return schema;

  const out: any = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "type" && typeof value === "string") {
      out.type = value.toLowerCase();
    } else if (key === "properties" && value && typeof value === "object") {
      out.properties = Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, toJsonSchema(v)])
      );
    } else if (key === "items") {
      out.items = toJsonSchema(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function computeQualityScore(item: any): number {
  let score = 50;

  try {
    let text = "";
    let reasoning = item.metadata?.reasoning || "";

    if (item.alpaca) {
      text = [item.alpaca.instruction, item.alpaca.input, item.alpaca.output].filter(Boolean).join(" ");
    } else if (item.sharegpt?.messages) {
      text = item.sharegpt.messages.map((m: any) => m.content).join(" ");
    } else if (item.qa) {
      text = [item.qa.question, item.qa.answer].filter(Boolean).join(" ");
    } else if (item.raw) {
      text = [item.raw.title, item.raw.text].filter(Boolean).join(" ");
    }

    if (text.length > 2000) score += 15;
    else if (text.length > 1000) score += 10;
    else if (text.length > 500) score += 5;
    else if (text.length < 100) score -= 15;

    if (reasoning.length > 500) score += 15;
    else if (reasoning.length > 200) score += 10;
    else if (reasoning.length > 50) score += 5;
    else score -= 10;

    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    const unique = new Set(words);
    const diversity = words.length > 0 ? unique.size / words.length : 0;
    if (diversity > 0.7) score += 10;
    else if (diversity > 0.5) score += 5;
    else if (diversity < 0.3) score -= 5;

    if (item.metadata?.trajectory) score += 10;
    if (item.metadata?.persona) score += 5;
    if (item.metadata?.interdisciplinary_link) score += 8;
    if (item.metadata?.correction) score += 5;

    if (item.metadata?.is_negative) score -= 5;

  } catch (e) {
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function computeAllScores(items: any[]): any[] {
  return items.map(item => ({
    ...item,
    qualityScore: computeQualityScore(item),
  }));
}