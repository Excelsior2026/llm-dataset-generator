/*
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ResponseCache } from '../utils/index';

export interface CacheStats {
  size: number;
  maxSize: number;
  ttlMs: number;
  hitRate: number;
  totalRequests: number;
}

export class CacheService {
  private static instance: CacheService;
  private caches: Map<string, ResponseCache<any>> = new Map();
  private stats: Map<string, { requests: number; hits: number }> = new Map();

  private constructor() {}

  public static getInstance(): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService();
    }
    return CacheService.instance;
  }

  get<T>(key: string, cacheName: string = 'default'): T | undefined {
    const cache = this.getCache(cacheName);
    const stats = this.getStats(cacheName);
    stats.requests++;

    const value = cache.get(key);
    if (value !== undefined) {
      stats.hits++;
    }

    return value;
  }

  async set<T>(key: string, value: T, options: { ttlMs?: number; maxSize?: number } = {}, cacheName: string = 'default'): Promise<void> {
    const cache = this.getCache(cacheName, options);
    await cache.set(key, value);
  }

  delete(key: string, cacheName: string = 'default'): boolean {
    const cache = this.getCache(cacheName);
    return cache.delete(key);
  }

  clear(cacheName: string = 'default'): void {
    const cache = this.getCache(cacheName);
    cache.clear();
    this.stats.delete(cacheName);
  }

  getStats(cacheName: string = 'default'): { requests: number; hits: number } {
    if (!this.stats.has(cacheName)) {
      this.stats.set(cacheName, { requests: 0, hits: 0 });
    }
    return this.stats.get(cacheName)!;
  }

  getAllStats(): Record<string, CacheStats> {
    const allStats: Record<string, CacheStats> = {};

    this.caches.forEach((cache, name) => {
      const cacheStats = cache.getStats();
      const requestStats = this.stats.get(name) || { requests: 0, hits: 0 };

      allStats[name] = {
        size: cacheStats.size,
        maxSize: cacheStats.maxSize,
        ttlMs: cacheStats.ttlMs,
        hitRate: requestStats.requests > 0 ? requestStats.hits / requestStats.requests : 0,
        totalRequests: requestStats.requests
      };
    });

    return allStats;
  }

  getCache(name: string, options?: { ttlMs?: number; maxSize?: number }): ResponseCache<any> {
    if (!this.caches.has(name)) {
      this.caches.set(name, new ResponseCache(options));
      this.stats.set(name, { requests: 0, hits: 0 });
    }
    return this.caches.get(name)!;
  }

  cleanupAll(): void {
    this.caches.forEach(cache => cache.cleanup());
  }

  async preloadCache(key: string, loader: () => Promise<any>, cacheName: string = 'default', options?: { ttlMs?: number; maxSize?: number }): Promise<any> {
    let value = this.get<any>(key, cacheName);
    if (value === undefined) {
      value = await loader();
      await this.set(key, value, options, cacheName);
    }
    return value;
  }

  public getCacheStats(): Record<string, CacheStats> {
    return this.getAllStats();
  }
}

export default CacheService;