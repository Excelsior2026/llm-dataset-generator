/*
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express, { Request, Response, NextFunction } from "express";
import compression from "compression";
import path from "path";
import dotenv from "dotenv";
import { createServer, Server as HttpServer } from 'http';
import { RateLimiter } from './src/utils/advanced';
import { metrics, generateCorrelationId } from './src/utils/index';
import { EnhancedLogger } from './src/utils/logger';
import { CircuitBreakerRegistry } from './src/utils/advanced';
import { ResponseCache } from './src/utils/index';
import { validateRequest, ValidationRule, ApiError } from './src/utils/index';
import { validateDataset } from './src/utils/validation';
import { Logger } from 'winston';
import { ProviderService } from './src/services/ProviderService';
import { GenerationService } from './src/services/GenerationService';
import { MetricsService } from './src/services/MetricsService';
import { CacheService } from './src/services/CacheService';
import { QualityService } from './src/services/QualityService';
import { ProviderConfig, DEFAULT_PROVIDER_CONFIG } from './src/providers/types';

dotenv.config();

const logger = EnhancedLogger.getInstance();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const MAX_BATCH_SIZE = Number(process.env.MAX_BATCH_SIZE) || 30;
const JUDGE_THRESHOLD = Number(process.env.JUDGE_THRESHOLD) || 0.7;

let httpServer: HttpServer;

const rateLimiter = new RateLimiter({ windowMs: 60000, maxRequests: 100 });
const circuitBreakers = CircuitBreakerRegistry.getInstance();
const globalCache = new ResponseCache<any>({ ttlMs: 5 * 60 * 1000, maxSize: 100 });
const metricsService = MetricsService.getInstance();
const cacheService = CacheService.getInstance();
const qualityService = QualityService.getInstance();

const providerService = ProviderService.getInstance();

// --- Request validation rules (used with validateRequest from src/utils/index) ---
const GENERATE_RULES: ValidationRule[] = [
  { field: 'topic', type: 'string', required: true, minLength: 1, maxLength: 500 },
  { field: 'size', type: 'number', min: 1, max: MAX_BATCH_SIZE },
  { field: 'format', type: 'string', allowedValues: ['alpaca', 'sharegpt', 'qa', 'raw'] },
  { field: 'temperature', type: 'number', min: 0, max: 2 },
  { field: 'tone', type: 'string', maxLength: 200 },
  { field: 'complexity', type: 'string', allowedValues: ['novice', 'intermediate', 'expert'] },
  { field: 'redTeam', type: 'boolean' },
];
const GENERATE_MORE_RULES: ValidationRule[] = [
  { field: 'researchSummary', type: 'string', required: true, minLength: 1 },
  { field: 'topic', type: 'string', maxLength: 500 },
  { field: 'format', type: 'string', allowedValues: ['alpaca', 'sharegpt', 'qa', 'raw'] },
  { field: 'count', type: 'number', min: 1, max: MAX_BATCH_SIZE },
  { field: 'tone', type: 'string', maxLength: 200 },
  { field: 'complexity', type: 'string', allowedValues: ['novice', 'intermediate', 'expert'] },
  { field: 'existingPrompts', type: 'array' },
];
const VALIDATE_DATASET_RULES: ValidationRule[] = [
  { field: 'items', type: 'array', required: true },
  { field: 'format', type: 'string', allowedValues: ['alpaca', 'sharegpt', 'qa', 'raw'] },
];
const UPLOAD_HF_RULES: ValidationRule[] = [
  { field: 'items', type: 'array', required: true, minLength: 1 },
  { field: 'token', type: 'string', required: true, minLength: 1 },
  { field: 'repoName', type: 'string', required: true, minLength: 1, maxLength: 200 },
  { field: 'format', type: 'string', allowedValues: ['alpaca', 'sharegpt', 'qa', 'raw'] },
  { field: 'topic', type: 'string', maxLength: 500 },
];

/** Shared handler for the catch block of any route — respects ApiError.statusCode instead of always 500. */
function respondError(res: Response, error: any, fallbackMessage: string) {
  if (error instanceof ApiError) {
    res.status(error.statusCode).json({ error: error.message, retryable: error.retryable, code: error.errorCode });
    return;
  }
  res.status(500).json({ error: error?.message || fallbackMessage });
}
const generationService = GenerationService.getInstance();

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

function logSecretAccess(secretType: string, accessedBy: string, correlationId?: string): void {
  logger.info(`Secret accessed: ${secretType} by ${accessedBy}`, { correlationId });
  metrics.incCounter('secret_access', 1, { type: secretType, accessed_by: accessedBy });
}

function cleanJsonString(str: string): string {
  let cleaned = str.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.substring(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.substring(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.substring(0, cleaned.length - 3);
  }
  return cleaned.trim();
}

app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: "50mb" }));

app.use((req: Request, res: Response, next: NextFunction) => {
  const correlationId = generateCorrelationId();
  (req as any).correlationId = correlationId;
  const contextLogger = EnhancedLogger.getInstance();
  contextLogger.setCorrelationId(correlationId);
  
  logger.info(`${req.method} ${req.path}`, {
    correlationId,
    ip: req.ip,
    userAgent: req.get('user-agent')
  });
  
  metrics.incCounter('http_requests_total', 1, {
    method: req.method,
    path: req.path,
    status_code: 'pending'
  });
  
  next();
});

function globalRateLimit(req: Request, res: Response, next: NextFunction): void {
  const clientIp = req.ip || 'unknown';
  const result = rateLimiter.isAllowed(clientIp);
  
  res.set('X-RateLimit-Limit', String(result.remaining + 1));
  res.set('X-RateLimit-Remaining', String(result.remaining));
  res.set('X-RateLimit-Reset', String(result.resetAt));
  
  if (!result.allowed) {
    metrics.incCounter('rate_limit_exceeded', 1, { ip: clientIp });
    res.status(429).json({ error: 'Too many requests', retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000) });
    return;
  }
  
  next();
}

app.use(globalRateLimit);

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (!err) return next();
  const correlationId = (req as any).correlationId;
  logger.error(`Error in ${req.method} ${req.path}:`, { correlationId }, err);
  res.status(500).json({ error: "Internal server error", correlationId });
});

function parseModelConfig(query: Record<string, any>): ProviderConfig {
  const raw = query.modelConfig;
  if (!raw) return DEFAULT_PROVIDER_CONFIG;
  try {
    const mc = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      research: { ...DEFAULT_PROVIDER_CONFIG.research, ...mc.research },
      generation: { ...DEFAULT_PROVIDER_CONFIG.generation, ...mc.generation },
      scoring: { ...DEFAULT_PROVIDER_CONFIG.scoring, ...mc.scoring },
    };
  } catch {
    return DEFAULT_PROVIDER_CONFIG;
  }
}

function sendSSEvent(res: Response, event: string, data: any): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

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
      
      const provider = await providerService.createProvider(config);
      await provider.isAvailable();
      const latency = Date.now() - start;
      
      providerStatus[type] = { available: true, latencyMs: latency };
      metricsService.gauge('provider_latency', latency, { provider: type });
    } catch (error: any) {
      providerStatus[type] = { available: false, error: error.message };
      metrics.incCounter('provider_unavailable', 1, { provider: type });
    }
  }
  
  const allAvailable = Object.values(providerStatus).every(s => s.available);
  const status = allAvailable ? 'healthy' : 'degraded';
  
  metricsService.gauge('health_status', status === 'healthy' ? 1 : 0);
  
  res.json({
    status,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    correlationId,
    providers: providerStatus
  });
});

app.get("/metrics", (req: Request, res: Response) => {
  res.set('Content-Type', 'text/plain');
  res.send(metricsService.exportPrometheus());
});

app.post("/api/validate-dataset", (req: Request, res: Response) => {
  try {
    const { items, format } = validateRequest<{ items: any[]; format?: string }>(req.body, VALIDATE_DATASET_RULES);
    const result = validateDataset(items, format);
    res.json(result);
  } catch (error: any) {
    respondError(res, error, 'Validation failed');
  }
});

app.post("/api/generate", async (req: Request, res: Response) => {
  try {
    const { topic, size = 10, format = "alpaca", temperature = 0.7, tone = "explanatory", complexity = "intermediate", redTeam } =
      validateRequest<{ topic: string; size?: number; format?: string; temperature?: number; tone?: string; complexity?: string; redTeam?: boolean }>(
        req.body, GENERATE_RULES
      );
    const correlationId = (req as any).correlationId;

    const targetSize = Math.max(1, Math.min(MAX_BATCH_SIZE, size));
    const isRedTeam = redTeam === true;
    
    const cacheKey = globalCache.generateKey({ topic, size: targetSize, format, temperature, isRedTeam });
    const cached = globalCache.get(cacheKey);
    if (cached) {
      res.json(cached);
      metrics.incCounter('cache_hit', 1, { endpoint: 'generate' });
      return;
    }
    
    const geminiKey = getNextApiKey('gemini');
    if (geminiKey) {
      logSecretAccess('gemini_api_key', 'generate_endpoint', correlationId);
    }
    
    const cacheKeyV2 = generationService.generateCacheKey({
      topic, size: targetSize, format, temperature, tone, complexity, redTeam, modelConfig: parseModelConfig(req.body)
    });
    const cachedV2 = cacheService.get<GenerationResult>(cacheKeyV2, 'generation');
    if (cachedV2) {
      res.json(cachedV2);
      metrics.incCounter('cache_hit', 1, { endpoint: 'generate_service' });
      return;
    }
    
    const generationRequest = {
      topic,
      size: targetSize,
      format,
      temperature,
      tone,
      complexity,
      redTeam: isRedTeam,
      modelConfig: parseModelConfig(req.body)
    };
    
    const result = await generationService.generateCompleteDataset(generationRequest, { enableCache: true });
    
    globalCache.set(cacheKey, result);
    cacheService.set(cacheKeyV2, result, { ttlMs: 5 * 60 * 1000 }, 'generation');
    
    const etag = require('crypto').createHash('md5').update(JSON.stringify(result)).digest('hex');
    res.set('ETag', etag);
    res.set('Cache-Control', 'public, max-age=300');
    
    metrics.incCounter('generation_completed', 1, { format, size: result.items.length });
    res.json(result);
    
  } catch (error: any) {
    logger.error("Synthesize breakdown:", { correlationId: (req as any).correlationId }, error);
    respondError(res, error, "Generation failed");
  }
});

app.get("/api/generate/stream", async (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const correlationId = (req as any).correlationId;

  try {
    const { topic, size = "10", format = "alpaca", temperature = "0.7", tone = "explanatory", complexity = "intermediate", redTeam, primaryTopic, secondaryTopic } = req.query as Record<string, string>;

    // Query params arrive as strings — coerce to the types validateRequest expects, then validate.
    // parseInt/parseFloat failures become NaN, which fails the min/max range check below rather than
    // silently falling back to a default (a raw string like "size=banana" should be rejected, not ignored).
    validateRequest<{ topic: string; size?: number; format?: string; temperature?: number; tone?: string; complexity?: string }>(
      { topic, size: parseInt(size), format, temperature: parseFloat(temperature), tone, complexity },
      GENERATE_RULES.filter(r => r.field !== 'redTeam') // redTeam here is a query string ("true"/"false"), not boolean — checked separately below
    );

    const targetSize = Math.max(1, Math.min(MAX_BATCH_SIZE, parseInt(size) || 10));
    const isRedTeam = redTeam === "true";
    const isCrossDomain = secondaryTopic && secondaryTopic !== "";
    const temp = parseFloat(temperature) || 0.7;
    const modelConfig = parseModelConfig(req.query);

    const usesGeminiResearch = modelConfig.research.provider === "gemini" && getNextApiKey('gemini');

    const cacheKey = globalCache.generateKey({ topic, size: targetSize, format, temp, isRedTeam, isCrossDomain });
    const cached = globalCache.get(cacheKey);
    if (cached) {
      sendSSEvent(res, "complete", cached);
      res.end();
      metrics.incCounter('cache_hit', 1, { endpoint: 'stream' });
      return;
    }

    const researchProvider = await providerService.createProvider(modelConfig.research);
    const genProvider = await providerService.createProvider(modelConfig.generation);
    const scoringProvider = await providerService.createProvider(modelConfig.scoring);

    sendSSEvent(res, "status", {
      message: usesGeminiResearch
        ? "Step 1: Searching the web for recent grounding facts..."
        : `Step 1: Researching topic using ${modelConfig.research.provider} (${modelConfig.research.model})...`,
      correlationId
    });

    let researchSummary = '';
    let sources: { title: string; url: string }[] = [];
    let subtopics: string[] = [];
    let knowledgeGraph = { nodes: [], edges: [] };

    if (usesGeminiResearch) {
      const geminiProvider = researchProvider as any;
      const geminiKey = getNextApiKey('gemini');
      if (geminiKey) {
        logSecretAccess('gemini_api_key', 'stream_endpoint', correlationId);
        (geminiProvider as any).apiKey = geminiKey;
      }

      const searchResult = await geminiProvider.generateWithSearch({
        prompt: `You are an elite research engine. Research the following topic exhaustively using Google Search: "${topic}".
Provide a detailed, authoritative research overview.
[SUBTOPICS]: A list of 6 to 8 subtopics separated by '|'.
[KNOWLEDGE_GRAPH]: A JSON object containing 'nodes' and 'edges'.`,
      });
      researchSummary = searchResult.text || '';
      sources = searchResult.sources;
    } else {
      researchSummary = await researchProvider.generate({
        prompt: `Research the following topic thoroughly: "${topic}". Cover fundamental concepts, use cases, and key subtopics.

[SUBTOPICS] Subtopic A | Subtopic B | Subtopic C | Subtopic D | Subtopic E | Subtopic F [END]
[KNOWLEDGE_GRAPH] { "nodes": [], "edges": [] } [END]`,
        systemPrompt: "You are a research assistant. Provide factual, well-structured information.",
        temperature: 0.4,
      });
    }

    const subtopicMatch = researchSummary.match(/\[SUBTOPICS\](.*?)(\[END\]|$)/s);
    if (subtopicMatch) {
      subtopics = subtopicMatch[1].split("|").map(s => s.trim()).filter(Boolean);
      researchSummary = researchSummary.replace(/\[SUBTOPICS\].*?(\[END\]|$)/s, "").trim();
    }

    const kgMatch = researchSummary.match(/\[KNOWLEDGE_GRAPH\](.*?)(\[END\]|$)/s);
    if (kgMatch) {
      try {
        const parsed = JSON.parse(kgMatch[1].trim());
        if (parsed.nodes && Array.isArray(parsed.nodes) && parsed.edges && Array.isArray(parsed.edges)) {
          knowledgeGraph = parsed;
        }
      } catch (e) {
        logger.warn("Failed to parse knowledge graph", { correlationId });
      }
    }

    if (subtopics.length === 0) {
      subtopics = ["Core Foundations", "Advanced Concepts", "Practical Demonstrations", "Historical Background", "Contemporary Applications"];
    }

    sendSSEvent(res, "research_done", { researchSummary, sources, subtopics, knowledgeGraph });

    const batchSize = 5;
    const numBatches = Math.ceil(targetSize / batchSize);
    sendSSEvent(res, "status", { message: `Step 2: Generating ${targetSize} items in ${numBatches} batches...`, correlationId });

    const allItems: any[] = [];

    for (let idx = 0; idx < numBatches; idx++) {
      const itemsInThisBatch = Math.min(batchSize, targetSize - idx * batchSize);
      const subtopicSubset = (() => {
        const start = (idx * 2) % subtopics.length;
        const end = start + 3;
        if (end <= subtopics.length) {
          return subtopics.slice(start, end);
        }
        return [...subtopics.slice(start), ...subtopics.slice(0, end - subtopics.length)];
      })();

      sendSSEvent(res, "status", { message: `Generating batch ${idx + 1}/${numBatches}...`, correlationId });

      const redTeamInstruction = isRedTeam ? '\nCRITICAL: ADVERSARIAL RED-TEAMING mode' : '';
      const crossDomainInstruction = isCrossDomain ? '\nCRITICAL: CROSS-DOMAIN SYNTHESIS mode' : '';
      const systemInstruction = `Generate ${itemsInThisBatch} training examples in '${format}' format.
Ground in: ${researchSummary}
Tone: ${tone}. Complexity: ${complexity}. Subtopics: ${subtopicSubset.join(", ")}.${redTeamInstruction}${crossDomainInstruction}`;

      try {
        const breaker = circuitBreakers.get(modelConfig.generation.provider);
        const genResult = await breaker.execute(() => genProvider.generate({
          prompt: `Synthesize exactly ${itemsInThisBatch} training items. Output valid JSON.`,
          systemPrompt: systemInstruction,
          temperature: temp,
          responseMimeType: "application/json",
        }));

        let batchItems: any[] = [];
        try {
          const parsed = JSON.parse(cleanJsonString(genResult || "{}"));
          batchItems = parsed.items || [];
        } catch (e) {
          logger.error(`Batch ${idx} parse error`, { correlationId });
        }

        if (batchItems.length > 0) {
          sendSSEvent(res, "status", { message: `Auditing batch ${idx + 1}...`, correlationId });
          const auditResult = await qualityService.auditBatch(batchItems, scoringProvider, tone, complexity, correlationId);

          // Use the critic's actual per-item indices (from QualityService), not a guess.
          const refinementIndices = auditResult.refinementIndices;
          if (refinementIndices.length > 0) {
            sendSSEvent(res, "status", { message: `Refining ${refinementIndices.length} item(s)...`, correlationId });

            const refinerResult = await genProvider.generate({
              prompt: `Refine these items. Each has a critique explaining what's wrong. Output: { "refinedItems": [ { "index": number, "item": { ... } } ] }
${refinementIndices.map(i => `Item ${i} (critique: ${auditResult.critiquesByIndex[i] || 'no critique provided'}): ${JSON.stringify(batchItems[i])}`).join("\n\n")}`,
              temperature: 0.4,
              responseMimeType: "application/json",
            });

            try {
              const refinedData = JSON.parse(cleanJsonString(refinerResult || "{}"));
              (refinedData.refinedItems || []).forEach((entry: any) => {
                if (typeof entry.index === 'number' && batchItems[entry.index] && refinementIndices.includes(entry.index)) {
                  batchItems[entry.index] = entry.item;
                }
              });
            } catch (e) {
              logger.warn(`Batch ${idx} refinement parse error — shipping unrefined items for indices ${refinementIndices.join(",")}`, { correlationId });
            }
          }
        }

        sendSSEvent(res, "batch_done", { batchIndex: idx, items: batchItems, correlationId });
        allItems.push(...batchItems);
      } catch (e: any) {
        sendSSEvent(res, "batch_error", { batchIndex: idx, error: e.message, correlationId });
        metrics.incCounter('batch_error', 1, { provider: modelConfig.generation.provider });
      }
    }

    const mapItem = createItemMapper(format);
    let idCounter = 1;
    const finalItems = allItems.map((item: any) => {
      const id = `item-${Date.now()}-${idCounter++}`;
      return mapItem(item, id, "General Concepts");
    });

    const responseData = {
      summary: { topic, researchSummary, sources, subtopics, knowledgeGraph },
      items: finalItems,
    };

    globalCache.set(cacheKey, responseData);
    sendSSEvent(res, "complete", { ...responseData, correlationId });
    res.end();
    
  } catch (error: any) {
    logger.error("SSE Error:", { correlationId: (req as any).correlationId }, error);
    sendSSEvent(res, "error", { error: error.message || "Generation failed", correlationId });
    res.end();
  }
});

app.post("/api/generate-more", async (req: Request, res: Response) => {
  try {
    const { topic, researchSummary, format, count = 2, tone = "explanatory", complexity = "intermediate", existingPrompts = [] } =
      validateRequest<{ topic?: string; researchSummary: string; format?: string; count?: number; tone?: string; complexity?: string; existingPrompts?: any[] }>(
        req.body, GENERATE_MORE_RULES
      );
    const correlationId = (req as any).correlationId;

    const modelConfig = parseModelConfig(req.body);
    const genProvider = await providerService.createProvider(modelConfig.generation);

    const geminiKey = getNextApiKey('gemini');
    if (geminiKey && genProvider.getProviderType() === 'gemini') {
      logSecretAccess('gemini_api_key', 'generate-more_endpoint', correlationId);
      (genProvider as any).apiKey = geminiKey;
    }

    const systemInstruction = `Generate ${count} new items in '${format}' format.
Base on: ${researchSummary}
Avoid duplicates of: ${existingPrompts.slice(0, 15).join("\n")}
Tone: ${tone}. Complexity: ${complexity}.`;

    const generateMore = async () => {
      const breaker = circuitBreakers.get(modelConfig.generation.provider);
      const genResult = await breaker.execute(() => genProvider.generate({
        prompt: `Generate ${count} new items.`,
        systemPrompt: systemInstruction,
        temperature: 0.8,
        responseMimeType: "application/json",
      }));

      try {
        const parsed = JSON.parse(cleanJsonString(genResult || "{}"));
        return parsed.items || [];
      } catch (error) {
        logger.error("Failed to parse:", { correlationId }, error);
        return [];
      }
    };

    const rawItems = await createTimeoutPromise(
      withRetry(generateMore, 2, 500),
      60000,
      "Generation timed out"
    );

    const mapItem = createItemMapper(format);
    let idCounter = 1;
    const finalItems = rawItems.map((item: any) => {
      const id = `item-synthetic-${Date.now()}-${idCounter++}`;
      return mapItem(item, id, "Extended Concepts");
    });

    res.json({ items: finalItems });
    metrics.incCounter('generate_more_completed', 1, { count: finalItems.length });
  } catch (error: any) {
    logger.error("Generate-more error:", { correlationId: (req as any).correlationId }, error);
    respondError(res, error, "Generate-more failed");
  }
});

app.post("/api/upload-huggingface", async (req: Request, res: Response) => {
  try {
    const { items, token, repoName, format, topic } = validateRequest<{ items: any[]; token: string; repoName: string; format?: string; topic?: string }>(
      req.body, UPLOAD_HF_RULES
    );
    const correlationId = (req as any).correlationId;

    logSecretAccess('huggingface_token', 'upload_endpoint', correlationId);

    const hfHeaders = {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    await fetch("https://huggingface.co/api/repos/create", {
      method: "POST",
      headers: hfHeaders,
      body: JSON.stringify({ name: repoName, type: "dataset", private: false }),
    }).catch(() => {});

    const sanitizedName = repoName.replace(/[^a-zA-Z0-9_-]/g, "_");
    const fileContent = (() => {
      switch (format) {
        case "alpaca": return items.map((itm: any) => JSON.stringify(itm.alpaca)).join("\n");
        case "sharegpt": return items.map((itm: any) => JSON.stringify(itm.sharegpt)).join("\n");
        case "qa": return items.map((itm: any) => JSON.stringify(itm.qa)).join("\n");
        default: return items.map((itm: any) => JSON.stringify(itm.raw)).join("\n");
      }
    })();

    const uploadUrl = `https://huggingface.co/api/datasets/${encodeURIComponent(repoName)}/upload`;
    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: hfHeaders,
      body: JSON.stringify({ path: `data/${sanitizedName}_${format}.jsonl`, content: fileContent, operations: "overwrite" }),
    });

    if (!uploadRes.ok) {
      const fallbackUrl = `https://huggingface.co/datasets/${encodeURIComponent(repoName)}/raw/main/data/${sanitizedName}_${format}.jsonl`;
      const fallbackRes = await fetch(fallbackUrl, {
        method: "PUT",
        headers: { ...hfHeaders, "Content-Type": "text/plain" },
        body: fileContent,
      });
      if (!fallbackRes.ok) throw new Error(`Upload failed: ${fallbackRes.status}`);
    }

    const readmeContent = `---
dataset_info:
  description: "Synthetic LLM dataset by TrainEngine.ai"
  license: apache-2.0
  languages: [en]
---

# ${repoName}
- Topic: ${topic || "General"}
- Format: ${format}
- Size: ${items.length}
- Generated: ${new Date().toISOString()}
`;

    await fetch(uploadUrl, {
      method: "POST",
      headers: hfHeaders,
      body: JSON.stringify({ path: "README.md", content: readmeContent, operations: "overwrite" }),
    }).catch(() => {});

    const encodedRepo = encodeURIComponent(repoName);
    logger.info(`Uploaded to HF: ${repoName}`, { correlationId });
    res.json({
      success: true,
      url: `https://huggingface.co/datasets/${encodedRepo}`, 
      itemCount: items.length,
    });
    metrics.incCounter('huggingface_upload', 1, { success: 'true' });
  } catch (error: any) {
    logger.error("HF upload failed:", { correlationId: (req as any).correlationId }, error);
    respondError(res, error, "HF upload failed");
    metrics.incCounter('huggingface_upload', 1, { success: 'false' });
  }
});

const viteMiddleware = async () => {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    return vite.middlewares;
  }
  return (req: Request, res: Response, next: NextFunction) => {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  };
};

async function startServer() {
  const middleware = await viteMiddleware();
  app.use(middleware);

  httpServer = createServer(app);

  app.listen(PORT, "127.0.0.1", () => {
    logger.info(`Server running on http://127.0.0.1:${PORT}`);
    console.log(`Server running on http://127.0.0.1:${PORT}`);
  });

  metricsService.collectSystemMetrics();
}

startServer();

process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  if (httpServer) {
    httpServer.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  }
});

process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM, shutting down...');
  if (httpServer) {
    httpServer.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  }
});