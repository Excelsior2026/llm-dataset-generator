/*
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { metrics } from '../utils/index';

export interface MetricsStats {
  counterCounts: Record<string, number>;
  gaugeValues: Record<string, number>;
  histogramStats: Record<string, any>;
  totalRequests: number;
  totalErrors: number;
  avgResponseTime: number;
}

export class MetricsService {
  private static instance: MetricsService;

  private constructor() {}

  public static getInstance(): MetricsService {
    if (!MetricsService.instance) {
      MetricsService.instance = new MetricsService();
    }
    return MetricsService.instance;
  }

  increment(name: string, labels?: Record<string, string>): void {
    metrics.incCounter(name, 1, labels);
  }

  gauge(name: string, value: number, labels?: Record<string, string>): void {
    metrics.setGauge(name, value, labels);
  }

  observe(name: string, value: number, labels?: Record<string, string>): void {
    metrics.observeHistogram(name, value, labels);
  }

  getSummary(): MetricsStats {
    const summary: MetricsStats = {
      counterCounts: {},
      gaugeValues: {},
      histogramStats: {},
      totalRequests: 0,
      totalErrors: 0,
      avgResponseTime: 0
    };

    metrics.getGauge('generation_requests_total')
      ? summary.totalRequests = metrics.getGauge('generation_requests_total')!
      : summary.totalRequests = 0;

    metrics.getGauge('generation_error')
      ? summary.totalErrors = Math.floor(metrics.getGauge('generation_error')! / 10)
      : summary.totalErrors = 0;

    const responseTimes: number[] = [];
    metrics.histograms.forEach((values, key) => {
      if (key.includes('response_time') || key.includes('generation_duration')) {
        responseTimes.push(...values);
      }
    });

    summary.avgResponseTime = responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : 0;

    return summary;
  }

  exportPrometheus(): string {
    return metrics.toPrometheusFormat();
  }

  reset(): void {
    metrics.reset();
  }

  collectSystemMetrics(): void {
    const mem = process.memoryUsage();
    this.gauge('memory_heap_used_bytes', mem.heapUsed);
    this.gauge('memory_heap_total_bytes', mem.heapTotal);
    this.gauge('memory_rss_bytes', mem.rss);

    const cpuUsage = process.cpuUsage();
    this.gauge('cpu_user_seconds', Math.floor(cpuUsage.user / 1e6));
    this.gauge('cpu_system_seconds', Math.floor(cpuUsage.system / 1e6));

    this.gauge('process_uptime_seconds', process.uptime());
    this.gauge('active_handles', process._getActiveHandles().length);
    this.gauge('active_requests', process._getActiveRequests().length);
  }
}

export default MetricsService;