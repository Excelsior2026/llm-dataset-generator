/*
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LogEntry {
  timestamp: number;
  level: string;
  message: string;
  correlationId?: string;
  error?: any;
  metadata?: Record<string, any>;
}

export interface LoggerOptions {
  level?: LogLevel;
  jsonOutput?: boolean;
  maxLogs?: number;
  correlationId?: string;
}

export class EnhancedLogger {
  private static instance: EnhancedLogger;
  private logs: LogEntry[] = [];
  private maxLogs: number;
  private level: LogLevel;
  private jsonOutput: boolean;
  private correlationId?: string;

  private constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? LogLevel.INFO;
    this.jsonOutput = options.jsonOutput ?? false;
    this.maxLogs = options.maxLogs ?? 1000;
    this.correlationId = options.correlationId;
  }

  static getInstance(options?: LoggerOptions): EnhancedLogger {
    if (!EnhancedLogger.instance) {
      EnhancedLogger.instance = new EnhancedLogger(options);
    }
    if (options) {
      EnhancedLogger.instance.configure(options);
    }
    return EnhancedLogger.instance;
  }

  configure(options: LoggerOptions): void {
    if (options.level !== undefined) this.level = options.level;
    if (options.jsonOutput !== undefined) this.jsonOutput = options.jsonOutput;
    if (options.maxLogs !== undefined) this.maxLogs = options.maxLogs;
  }

  setCorrelationId(correlationId: string | undefined): void {
    this.correlationId = correlationId;
  }

  setJsonOutput(enabled: boolean): void {
    this.jsonOutput = enabled;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(message: string, metadata?: Record<string, any>, error?: any): void {
    this.log(LogLevel.DEBUG, 'debug', message, metadata, error);
  }

  info(message: string, metadata?: Record<string, any>, error?: any): void {
    this.log(LogLevel.INFO, 'info', message, metadata, error);
  }

  warn(message: string, metadata?: Record<string, any>, error?: any): void {
    this.log(LogLevel.WARN, 'warn', message, metadata, error);
  }

  error(message: string, metadata?: Record<string, any>, error?: any): void {
    this.log(LogLevel.ERROR, 'error', message, metadata, error);
  }

  private log(level: LogLevel, levelStr: string, message: string, metadata?: Record<string, any>, error?: any): void {
    if (level < this.level) return;

    const entry: LogEntry = {
      timestamp: Date.now(),
      level: levelStr,
      message,
      correlationId: this.correlationId,
      error,
      metadata,
    };

    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.splice(0, this.logs.length - this.maxLogs);
    }

    if (this.jsonOutput) {
      const output = {
        ts: new Date(entry.timestamp).toISOString(),
        level: entry.level,
        msg: entry.message,
        corr_id: entry.correlationId,
        ...(entry.metadata && { meta: entry.metadata }),
        ...(entry.error && { err: this.serializeError(entry.error) }),
      };
      console.log(JSON.stringify(output));
    } else {
      const prefix = `[${levelStr.toUpperCase()}]`;
      const corrPrefix = entry.correlationId ? `[${entry.correlationId.substring(0, 8)}] ` : '';
      const baseMsg = `${prefix} ${new Date(entry.timestamp).toISOString()} - ${corrPrefix}${message}`;

      if (level === LogLevel.ERROR) {
        console.error(baseMsg, error);
      } else if (level === LogLevel.WARN) {
        console.warn(baseMsg, error);
      } else {
        console.log(baseMsg);
      }
    }
  }

  private serializeError(error: any): Record<string, any> {
    if (!error) return {};
    return {
      message: error.message || String(error),
      stack: error.stack,
      name: error.name,
      code: error.code,
    };
  }

  getLogs(level?: string, correlationId?: string, since?: number): LogEntry[] {
    let filtered = this.logs;
    if (level) {
      filtered = filtered.filter(log => log.level === level);
    }
    if (correlationId) {
      filtered = filtered.filter(log => log.correlationId === correlationId);
    }
    if (since) {
      filtered = filtered.filter(log => log.timestamp >= since);
    }
    return filtered;
  }

  getLogsByCorrelationId(correlationId: string): LogEntry[] {
    return this.logs.filter(log => log.correlationId === correlationId);
  }

  clear(): void {
    this.logs = [];
  }

  getStats(): { total: number; byLevel: Record<string, number> } {
    const byLevel: Record<string, number> = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
    };
    this.logs.forEach(log => {
      byLevel[log.level] = (byLevel[log.level] || 0) + 1;
    });
    return { total: this.logs.length, byLevel };
  }
}

export const logger = EnhancedLogger.getInstance();
