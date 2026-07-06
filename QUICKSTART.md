# Quick Start - New Features

Get started with the 27 enhancements in 5 minutes!

## 1. Install Dependencies

```bash
npm install
```

## 2. Configure Environment

Create or update `.env`:

```bash
# Server
PORT=3000
MAX_BATCH_SIZE=30
JUDGE_THRESHOLD=0.7

# Logging (optional)
LOG_LEVEL=info
LOG_FORMAT=text

# API Keys (optional - comma-separated for rotation)
GEMINI_API_KEY=key1,key2,key3
```

## 3. Run Quality Checks

```bash
# Type check
npm run typecheck

# Lint
npm run lint

# Format check
npm run format:check

# All at once
npm run typecheck && npm run lint && npm run format:check
```

## 4. Start the Server

```bash
npm run dev
```

## 5. Test New Endpoints

### Health Check

```bash
curl http://localhost:3000/health | jq
```

**Expected Output:**
```json
{
  "status": "healthy",
  "timestamp": "2026-07-03T12:00:00.000Z",
  "uptime": 123.45,
  "providers": {
    "ollama": { "available": true, "latencyMs": 45 },
    "gemini": { "available": true, "latencyMs": 230 }
  }
}
```

### Metrics (Prometheus Format)

```bash
curl http://localhost:3000/metrics
```

**Expected Output:**
```prometheus
# TYPE llm_dataset_generation_completed counter
llm_dataset_generation_completed{format="alpaca",size="10"} 5
# TYPE llm_dataset_health_status gauge
llm_dataset_health_status 1
# TYPE llm_dataset_provider_latency gauge
llm_dataset_provider_latency{provider="gemini"} 230
```

### Dataset Validation

```bash
curl -X POST http://localhost:3000/api/validate-dataset \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      {
        "id": "test-1",
        "format": "alpaca",
        "metadata": {
          "reasoning": "Step-by-step explanation",
          "intent": "educational",
          "complexity": "intermediate",
          "is_negative": false
        },
        "alpaca": {
          "instruction": "What is 2+2?",
          "input": "",
          "output": "4"
        }
      }
    ],
    "format": "alpaca"
  }' | jq
```

**Expected Output:**
```json
{
  "valid": true,
  "totalItems": 1,
  "validItems": 1,
  "errors": [],
  "warnings": [
    {
      "itemIndex": 0,
      "itemId": "test-1",
      "message": "Output is very short (< 20 characters)"
    }
  ]
}
```

## 6. Use New Features in Code

### Circuit Breaker

```typescript
import { CircuitBreakerRegistry } from './src/utils/index';

const breakers = CircuitBreakerRegistry.getInstance();
const breaker = breakers.get('gemini');

try {
  const result = await breaker.execute(() => provider.generate(options));
  console.log('Success!');
} catch (error) {
  if ((error as any).code === 'CIRCUIT_OPEN') {
    console.log('Circuit breaker is OPEN - service unavailable');
  }
}
```

### Response Caching

```typescript
import { ResponseCache } from './src/utils/index';

const cache = new ResponseCache({ ttlMs: 5 * 60 * 1000 });

const key = cache.generateKey({ topic: 'AI', size: 10 });
const cached = cache.get(key);

if (cached) {
  console.log('Cache hit!');
  return cached;
}

// Generate and cache
const result = await generateDataset();
cache.set(key, result);
```

### Enhanced Logging

```typescript
import { EnhancedLogger, LogLevel } from './src/utils/logger';

const logger = EnhancedLogger.getInstance();
logger.setCorrelationId('abc-123');
logger.setJsonOutput(true);

logger.info('Processing request', { userId: 123 });
logger.error('Failed to generate', { topic: 'AI' }, error);
```

### Rate Limiting

```typescript
import { RateLimiter } from './src/utils/index';

const limiter = new RateLimiter({ windowMs: 60000, maxRequests: 100 });

app.use((req, res, next) => {
  const result = limiter.isAllowed(req.ip);
  
  if (!result.allowed) {
    return res.status(429).json({ 
      error: 'Too many requests',
      retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000)
    });
  }
  
  next();
});
```

### Metrics Collection

```typescript
import { metrics } from './src/utils/index';

// Count events
metrics.incCounter('generation_completed', 1, { format: 'alpaca' });

// Track values
metrics.setGauge('active_users', 42);

// Record durations
metrics.observeHistogram('batch_duration', 1234, { provider: 'gemini' });

// Get stats
const stats = metrics.getHistogramStats('batch_duration');
console.log(`Avg: ${stats.avg}ms, P95: ${stats.p95}ms`);
```

### CSV Export (Safe)

```typescript
import { escapeCsvField } from './src/utils/index';

const dangerous = '=SUM(A1:A10)';
const safe = escapeCsvField(dangerous);
// Result: "'=SUM(A1:A10)" - won't execute as formula
```

### ETag for Caching

```typescript
import { computeETag } from './src/utils/index';

const data = { items: [...] };
const etag = computeETag(data);

res.set('ETag', etag);
res.set('Cache-Control', 'public, max-age=300');
res.json(data);
```

## 7. Docker Deployment

```bash
# Build
docker build -t llm-dataset-generator .

# Run
docker run -p 3000:3000 \
  -e GEMINI_API_KEY=your_key \
  -e LOG_FORMAT=json \
  llm-dataset-generator
```

## 8. CI/CD

The GitHub Actions CI automatically runs on every push:

- ✅ Type checking
- ✅ Linting
- ✅ Formatting
- ✅ Tests
- ✅ Build
- ✅ Docker build

To trigger manually:

```bash
git push origin main
```

## 9. API Key Rotation

Set multiple keys in `.env`:

```bash
GEMINI_API_KEY=key1,key2,key3,key4
```

The system automatically rotates through keys in round-robin fashion.

## 10. Monitor Logs

### Text Format (Default)
```
[INFO] 2026-07-03T12:00:00.000Z - [abc123] POST /api/generate
[ERROR] 2026-07-03T12:00:01.000Z - [abc123] Generation failed
```

### JSON Format
```json
{"ts":"2026-07-03T12:00:00.000Z","level":"info","msg":"POST /api/generate","corr_id":"abc123"}
{"ts":"2026-07-03T12:00:01.000Z","level":"error","msg":"Generation failed","corr_id":"abc123","err":{"message":"Timeout"}}
```

Enable with: `export LOG_FORMAT=json`

## Common Issues

### TypeScript Errors

```bash
npm run typecheck
```

Fix any type errors before proceeding.

### Lint Errors

```bash
npm run lint:fix
```

Auto-fixes fixable issues.

### Format Issues

```bash
npm run format
```

Auto-formats all files.

### Circuit Breaker Open

If you see "Circuit breaker is OPEN":
1. Check provider health: `curl /health`
2. Wait for reset timeout (60s default)
3. Reduce failure threshold if needed

### Rate Limited

If you get 429 errors:
1. Wait for reset (check `X-RateLimit-Reset` header)
2. Increase limit in code if needed
3. Check for runaway requests in logs

## Next Steps

1. ✅ Test all new endpoints
2. ✅ Integrate utilities into server.ts (see `SERVER_INTEGRATION_GUIDE.md`)
3. ✅ Set up monitoring (Prometheus + Grafana)
4. ✅ Configure production environment
5. ✅ Deploy with Docker

## Resources

- **Full Integration Guide**: `SERVER_INTEGRATION_GUIDE.md`
- **Implementation Details**: `IMPLEMENTATION_SUMMARY.md`
- **API Specification**: `openapi.yaml`
- **Enhancement Status**: `ENHANCEMENTS_STATUS.md`

---

**Happy coding! 🚀**