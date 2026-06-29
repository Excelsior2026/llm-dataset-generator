/*
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Utility functions for the LLM Dataset Generator

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

    if (rule.type === 'string' && typeof value === 'string') {
      if (rule.minLength !== undefined && value.length < rule.minLength) {
        throw new ApiError(`Field '${rule.field}' must be at least ${rule.minLength} characters`, 400, false);
      }
      if (rule.maxLength !== undefined && value.length > rule.maxLength) {
        throw new ApiError(`Field '${rule.field}' must be at most ${rule.maxLength} characters`, 400, false);
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

      // Don't retry non-retryable errors (e.g. 400s, auth failures)
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

// Memoization utility for caching expensive computations
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

// JSON Schema utilities for Gemini API
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
      // Fallback for unknown formats
      break;
  }

  return schema;
}

/**
 * Convert the Gemini-style response schema (uppercase type names like "OBJECT"/
 * "STRING") into a standard JSON Schema usable by Ollama structured outputs and
 * llama.cpp's json_schema parameter. Recurses through properties and array
 * items; passes required/enum/description through unchanged.
 */
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
  let score = 50; // Base score

  try {
    // Extract text content for analysis
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

    // Length scoring (penalize very short entries)
    if (text.length > 2000) score += 15;
    else if (text.length > 1000) score += 10;
    else if (text.length > 500) score += 5;
    else if (text.length < 100) score -= 15;

    // Reasoning depth
    if (reasoning.length > 500) score += 15;
    else if (reasoning.length > 200) score += 10;
    else if (reasoning.length > 50) score += 5;
    else score -= 10;

    // Vocabulary diversity
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    const unique = new Set(words);
    const diversity = words.length > 0 ? unique.size / words.length : 0;
    if (diversity > 0.7) score += 10;
    else if (diversity > 0.5) score += 5;
    else if (diversity < 0.3) score -= 5;

    // Metadata richness
    if (item.metadata?.trajectory) score += 10;
    if (item.metadata?.persona) score += 5;
    if (item.metadata?.interdisciplinary_link) score += 8;
    if (item.metadata?.correction) score += 5;

    // Negative examples get a slight penalty (they're intentionally flawed)
    if (item.metadata?.is_negative) score -= 5;

  } catch (e) {
    // Don't let scoring errors affect the item
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function computeAllScores(items: any[]): any[] {
  return items.map(item => ({
    ...item,
    qualityScore: computeQualityScore(item),
  }));
}
