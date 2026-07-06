/*
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'events';
import { createHash } from 'crypto';

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

export class CircuitBreaker extends EventEmitter {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private nextAttempt = Date.now();
  private successCount = 0;
  
  private readonly failureThreshold: number;
  private readonly resetTimeout: number;
  private readonly monitoringPeriod: number;

  constructor(options: Partial<CircuitBreakerOptions> = {}) {
    super();
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
      this.emit('half-open');
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
        this.emit('close');
      }
    }
  }

  private onFailure(): void {
    this.failureCount++;
    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      this.nextAttempt = Date.now() + this.resetTimeout;
      this.emit('open');
    } else if (this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.nextAttempt = Date.now() + this.resetTimeout;
      this.emit('open');
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
    this.emit('reset');
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
  return createHash('sha256').update(str).digest('hex').substring(0, 16);
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
  return createHash('md5').update(str).digest('hex');
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
    
    // sorted is non-empty here (guarded above), so indexed reads are safe
    const percentile = (p: number) => {
      const idx = Math.ceil((p / 100) * sorted.length) - 1;
      return sorted[Math.max(0, idx)]!;
    };

    return {
      count,
      sum,
      avg: sum / count,
      min: sorted[0]!,
      max: sorted[sorted.length - 1]!,
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