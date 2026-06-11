/*
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Utility functions for the LLM Dataset Generator

export interface ItemMapping {
  id: string;
  format: string;
  topic: string;
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

function mapItemToFormat(item: any, format: string, id: string, topic: string): ItemMapping {
  const itemTopic = item.topic || "General Concepts";
  
  switch (format) {
    case "alpaca":
      return {
        id,
        format: "alpaca",
        topic: itemTopic,
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
        raw: {
          title: "Unknown Format",
          text: "Data in unknown format"
        }
      };
  }
}

export { mapItemToFormat };

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

export function validateRequest<T>(data: any, schema: { new (): T }): T {
  try {
    return JSON.parse(JSON.stringify(data));
  } catch (error) {
    throw new ApiError('Invalid request format', 400, false);
  }
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
