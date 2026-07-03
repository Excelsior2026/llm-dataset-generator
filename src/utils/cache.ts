/*
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'crypto';

export interface CacheOptions {
  ttlMs?: number;
  maxSize?: number;
}

export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  hits: number;
}

export class ResponseCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private readonly ttlMs: number;
  private readonly maxSize: number;

  constructor(options: CacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000;
    this.maxSize = options.maxSize ?? 1000;
  }

  generateKey(data: any): string {
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    return createHash('sha256').update(str).digest('hex').substring(0, 16);
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }
    
    entry.hits++;
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
    
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      hits: 0
    });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  getStats(): { 
    size: number; 
    maxSize: number; 
    ttlMs: number;
    entries: Array<{ key: string; age: number; hits: number }>;
  } {
    const now = Date.now();
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
      entries: Array.from(this.cache.entries()).map(([key, entry]) => ({
        key,
        age: now - entry.timestamp,
        hits: entry.hits
      }))
    };
  }

  cleanup(): void {
    const now = Date.now();
    const toDelete: string[] = [];
    
    this.cache.forEach((entry, key) => {
      if (now - entry.timestamp > this.ttlMs) {
        toDelete.push(key);
      }
    });
    
    toDelete.forEach(key => this.cache.delete(key));
  }

  startPeriodicCleanup(intervalMs: number = 60000): void {
    setInterval(() => this.cleanup(), intervalMs);
  }
}

export type CachedFunction<T extends (...args: any[]) => Promise<any>> = 
  (...args: Parameters<T>) => Promise<ReturnType<T>>;

export function createCachedFunction<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  cache: ResponseCache<ReturnType<T>>,
  keyGenerator?: (...args: Parameters<T>) => string
): CachedFunction<T> {
  return async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    const key = keyGenerator 
      ? keyGenerator(...args)
      : cache.generateKey(args);
    
    const cached = cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    
    const result = await fn(...args);
    cache.set(key, result);
    return result;
  };
}