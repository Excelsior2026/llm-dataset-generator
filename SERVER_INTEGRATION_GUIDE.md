# Server Integration Guide

This guide shows how to integrate all enhancement utilities into `server.ts`.

## 1. Add Imports

At the top of `server.ts`, add:

```typescript
import compression from "compression";
import { createServer, Server as HttpServer } from 'http';
import {
  EnhancedLogger,
  LogLevel,
  CircuitBreakerRegistry,
  RateLimiter,
  metrics,
  RequestContextManager,
  ResponseCache,
  validateDataset,
  computeETag,
  generateCorrelationId
} from "./src/utils/index";
import { ProviderRegistry, loadProviderPlugins } from "./src/providers/PluginRegistry";
```

## 2. Initialize Global Instances

After the `app` initialization:

```typescript
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const MAX_BATCH_SIZE = Number(process.env.MAX_BATCH_SIZE) || 30;
const JUDGE_THRESHOLD = Number(process.env.JUDGE_THRESHOLD) || 0.7;

let httpServer: HttpServer;

// Global instances
const globalCache = new ResponseCache<any>({ ttlMs: 5 * 60 * 1000, maxSize: 100 });
const rateLimiter = new RateLimiter({ windowMs: 60000, maxRequests: 100 });
const circuitBreakers = CircuitBreakerRegistry.getInstance();
const requestContextManager = RequestContextManager.getInstance();

// Load provider plugins
await loadProviderPlugins();
```

## 3. Add Middleware Stack

Replace the existing middleware with:

```typescript
// Compression
app.use(compression({ threshold: 1024 }));

// JSON parsing with size limit
app.use(express.json({ limit: "50mb", strict: true }));

// Correlation ID and request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  const context = requestContextManager.create({ 
    method: req.method, 
    path: req.path,
    ip: req.ip 
  });
  (req as any).correlationId = context.correlationId;
  EnhancedLogger.getInstance().setCorrelationId(context.correlationId);
  
  logger.info(`${req.method} ${req.path}`, {
    correlationId: context.correlationId,
    ip: req.ip,
    userAgent: req.get('user-agent')
  });
  
  next();
});

// Rate limiting
app.use((req: Request, res: Response, next: NextFunction) => {
  const clientIp = req.ip || 'unknown';
  const result = rateLimiter.isAllowed(clientIp);
  
  res.set('X-RateLimit-Limit', '100');
  res.set('X-RateLimit-Remaining', String(result.remaining));
  res.set('X-RateLimit-Reset', String(result.resetAt));
  
  if (!result.allowed) {
    metrics.incCounter('rate_limit_exceeded', 1, { ip: clientIp });
    res.status(429).json({ 
      error: 'Too many requests', 
      retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000) 
    });
    return;
  }
  
  next();
});

// Error handling with correlation ID
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (!err) return next();
  const correlationId = (req as any).correlationId;
  logger.error(`Error in ${req.method} ${req.path}:`, { correlationId }, err);
  metrics.incCounter('errors', 1, { type: 'unhandled', path: req.path });
  res.status(500).json({ error: "Internal server error", correlationId });
});
```

## 4. Add Health Check Endpoint

Before the existing endpoints:

```typescript
app.get("/health", async (req: Request, res: Response) => {
  const correlationId = (req as any).correlationId;
  const providerStatus: Record<string, { available: boolean; latencyMs?: number; error?: string }> = {};
  
  const providers = [
    { type: 'ollama', config: DEFAULT_PROVIDER_CONFIG.research },
    { type: 'llamacpp', config: DEFAULT_PROVIDER_CONFIG.generation },
  ];
  
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY') {
    providers.push({ 
      type: 'gemini', 
      config: { ...DEFAULT_PROVIDER_CONFIG.scoring, apiKey: process.env.GEMINI_API_KEY } 
    });
  }
  
  for (const { type, config } of providers) {
    const start = Date.now();
    try {
      const breaker = circuitBreakers.get(type);
      if (breaker.getState() === 'OPEN') {
        providerStatus[type] = { available: false, error: 'Circuit breaker OPEN' };
        continue;
      }
      
      const provider = createProvider(config);
      await provider.isAvailable();
      const latency = Date.now() - start;
      
      providerStatus[type] = { available: true, latencyMs: latency };
      metrics.setGauge('provider_latency', latency, { provider: type });
    } catch (error: any) {
      providerStatus[type] = { available: false, error: error.message };
      metrics.incCounter('provider_unavailable', 1, { provider: type });
    }
  }
  
  const allAvailable = Object.values(providerStatus).every(s => s.available);
  const status = allAvailable ? 'healthy' : 'degraded';
  
  metrics.setGauge('health_status', status === 'healthy' ? 1 : 0);
  
  res.json({
    status,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    correlationId,
    providers: providerStatus
  });
});
```

## 5. Add Metrics Endpoint

```typescript
app.get("/metrics", (req: Request, res: Response) => {
  res.set('Content-Type', 'text/plain');
  res.send(metrics.toPrometheusFormat());
});
```

## 6. Add Validation Endpoint

```typescript
app.post("/api/validate-dataset", (req: Request, res: Response) => {
  const { items, format } = req.body;
  
  if (!items || !Array.isArray(items)) {
    res.status(400).json({ error: 'Items array is required' });
    return;
  }
  
  const result = validateDataset(items, format);
  res.json(result);
});
```

## 7. Wrap Provider Calls with Circuit Breaker

In the `/api/generate` endpoint, wrap provider calls:

```typescript
// Before
const genResult = await genProvider.generate({
  prompt,
  systemPrompt: systemInstruction,
  temperature,
  responseMimeType: "application/json",
  responseSchema: getSchemaForFormat(format),
});

// After
const breaker = circuitBreakers.get(modelConfig.generation.provider);
const genResult = await breaker.execute(() => genProvider.generate({
  prompt,
  systemPrompt: systemInstruction,
  temperature,
  responseMimeType: "application/json",
  responseSchema: getSchemaForFormat(format),
}));
```

## 8. Add Response Caching

Add caching to `/api/generate`:

```typescript
// At the start of the endpoint
const cacheKey = globalCache.generateKey({ topic, size: targetSize, format, temperature, isRedTeam });
const cached = globalCache.get(cacheKey);
if (cached) {
  res.json(cached);
  metrics.incCounter('cache_hit', 1, { endpoint: 'generate' });
  return;
}

// Before sending response
const responseData = { summary, items };
const etag = computeETag(responseData);
res.set('ETag', etag);
res.set('Cache-Control', 'public, max-age=300');

globalCache.set(cacheKey, responseData);
res.json(responseData);
```

## 9. Add API Key Rotation

Add at the top of the file:

```typescript
const apiKeys = {
  gemini: (process.env.GEMINI_API_KEY || '').split(',').filter(k => k && k !== 'MY_GEMINI_API_KEY'),
};

let currentKeyIndex: Record<string, number> = { gemini: 0 };

function getNextApiKey(provider: string): string | undefined {
  const keys = apiKeys[provider as keyof typeof apiKeys];
  if (!keys || keys.length === 0) return undefined;
  const key = keys[currentKeyIndex[provider] || 0];
  currentKeyIndex[provider] = (currentKeyIndex[provider] + 1) % keys.length;
  return key;
}

function logSecretAccess(secretType: string, accessedBy: string): void {
  logger.info(`Secret accessed: ${secretType} by ${accessedBy}`, { 
    correlationId: (req as any).correlationId 
  });
  metrics.incCounter('secret_access', 1, { type: secretType, accessed_by: accessedBy });
}
```

Use in endpoints:

```typescript
const geminiKey = getNextApiKey('gemini');
if (geminiKey) {
  logSecretAccess('gemini_api_key', 'generate_endpoint');
  (modelConfig.research as any).apiKey = geminiKey;
}
```

## 10. Add Graceful Shutdown

At the end of `server.ts`, replace the `startServer()` function:

```typescript
async function startServer() {
  // Vite middleware setup (existing code)
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer = createServer(app);
  
  httpServer.listen(PORT, "127.0.0.1", () => {
    logger.info(`Server running on http://127.0.0.1:${PORT}`);
    console.log(`Server running on http://127.0.0.1:${PORT}`);
  });
  
  // Graceful shutdown
  const gracefulShutdown = (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    
    // Close HTTP server
    httpServer.close(() => {
      logger.info('HTTP server closed');
      
      // Flush logs
      logger.info('Logs flushed');
      
      // Cleanup rate limiter
      rateLimiter.cleanup();
      
      // Clear caches
      globalCache.clear();
      
      process.exit(0);
    });
    
    // Force exit after 30 seconds
    setTimeout(() => {
      logger.error('Forcing exit after timeout');
      process.exit(1);
    }, 30000);
  };
  
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

startServer();
```

## 11. Enable JSON Logging (Optional)

Add environment variable support:

```typescript
// At the top of server.ts
const logFormat = process.env.LOG_FORMAT || 'text';
const logLevel = process.env.LOG_LEVEL || 'info';

const logLevelEnum = {
  debug: LogLevel.DEBUG,
  info: LogLevel.INFO,
  warn: LogLevel.WARN,
  error: LogLevel.ERROR
}[logLevel.toLowerCase()] || LogLevel.INFO;

EnhancedLogger.getInstance().configure({
  jsonOutput: logFormat === 'json',
  level: logLevelEnum
});
```

## 12. Configure Judge Threshold

Use the `JUDGE_THRESHOLD` environment variable:

```typescript
// In the judge/refine section
const failedIndices = critiques
  .filter((c: any) => !c.isValid && (c.confidence || 1) >= JUDGE_THRESHOLD)
  .map((c: any) => c.index);
```

## 13. Add Request Size Limits

The `MAX_BATCH_SIZE` is already defined. Use it in endpoints:

```typescript
const targetSize = Math.max(1, Math.min(MAX_BATCH_SIZE, size));
```

## Testing the Integration

After making these changes:

```bash
# Type check
npm run typecheck

# Run the server
npm run dev

# Test health endpoint
curl http://localhost:3000/health

# Test metrics endpoint
curl http://localhost:3000/metrics

# Test validation endpoint
curl -X POST http://localhost:3000/api/validate-dataset \
  -H "Content-Type: application/json" \
  -d '{"items": [], "format": "alpaca"}'
```

## Environment Variables Summary

Add to `.env`:

```bash
# Server
PORT=3000
MAX_BATCH_SIZE=30
JUDGE_THRESHOLD=0.7

# Logging
LOG_LEVEL=info
LOG_FORMAT=text  # or 'json'

# API Keys (comma-separated for rotation)
GEMINI_API_KEY=key1,key2,key3
```

## Next Steps

1. Test each enhancement individually
2. Monitor metrics at `/metrics`
3. Watch circuit breaker status in health check
4. Review logs for correlation IDs
5. Verify cache hit rates
6. Test rate limiting with multiple requests