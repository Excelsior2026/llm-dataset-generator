/*
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { generateCorrelationId } from '../utils/index';
import { ProviderService } from './ProviderService';
import { MetricsService } from './MetricsService';
import { CacheService } from './CacheService';
import { QualityService } from './QualityService';
import {
  ModelFunctionConfig,
  ProviderConfig,
  DEFAULT_PROVIDER_CONFIG
} from '../providers/types';
import { ModelProvider } from '../providers/types';
import { logger } from '../utils/index';
import { withRetry, createTimeoutPromise } from '../utils/index';
import { mapItemToFormat } from '../utils/index';

export interface GenerationRequest {
  topic: string;
  size?: number;
  format?: 'alpaca' | 'sharegpt' | 'qa' | 'raw';
  temperature?: number;
  tone?: string;
  complexity?: string;
  redTeam?: boolean;
  primaryTopic?: string;
  secondaryTopic?: string;
  modelConfig?: Partial<ProviderConfig>;
}

export interface GenerationResult {
  id: string;
  topic: string;
  researchSummary: string;
  sources: { title: string; url: string }[];
  subtopics: string[];
  knowledgeGraph: any;
  items: any[];
  metrics: {
    totalItems: number;
    generationTime: number;
    cacheHit: boolean;
    providerLatency: Record<string, number>;
  };
}

export interface BatchGenerationOptions {
  batchSize?: number;
  timeout?: number;
  retryCount?: number;
  enableCache?: boolean;
}

export class GenerationService {
  private static instance: GenerationService;
  private providerService: ProviderService;
  private metricsService: MetricsService;
  private cacheService: CacheService;
  private qualityService: QualityService;
  private correlationIds: Map<string, string> = new Map();

  private constructor() {
    this.providerService = ProviderService.getInstance();
    this.metricsService = MetricsService.getInstance();
    this.cacheService = CacheService.getInstance();
    this.qualityService = QualityService.getInstance();
  }

  public static getInstance(): GenerationService {
    if (!GenerationService.instance) {
      GenerationService.instance = new GenerationService();
    }
    return GenerationService.instance;
  }

  async generateCompleteDataset(request: GenerationRequest, options: BatchGenerationOptions = {}): Promise<GenerationResult> {
    const correlationId = generateCorrelationId();
    const startTime = Date.now();
    this.correlationIds.set(correlationId, correlationId);

    try {
      this.metricsService.increment('generation_requests_total', {
        correlation_id: correlationId,
        topic: request.topic,
        format: request.format || 'alpaca'
      });

      const cacheKey = this.generateCacheKey(request);
      let result = await this.cacheService.get<GenerationResult>(cacheKey);

      if (result) {
        this.metricsService.increment('generation_cache_hit', { correlation_id: correlationId });
        this.metricsService.observe('generation_cache_duration', Date.now() - startTime, { correlation_id: correlationId });
        return result;
      }

      this.metricsService.increment('generation_cache_miss', { correlation_id: correlationId });

      const effectiveSize = Math.min(30, request.size || 10);
      const batchSize = options.batchSize || 5;
      const numBatches = Math.ceil(effectiveSize / batchSize);

      const researchProvider = await this.getProvider(request.modelConfig?.research || DEFAULT_PROVIDER_CONFIG.research);
      const genProvider = await this.getProvider(request.modelConfig?.generation || DEFAULT_PROVIDER_CONFIG.generation);
      const scoringProvider = await this.getProvider(request.modelConfig?.scoring || DEFAULT_PROVIDER_CONFIG.scoring);

      const geminiApiKey = this.getNextApiKey('gemini');
      if (geminiApiKey && researchProvider.getProviderType() === 'gemini') {
        (researchProvider as any).apiKey = geminiApiKey;
      }

      const researchSummary = await this.performResearch(researchProvider, request, correlationId);
      const { subtopics, knowledgeGraph } = this.extractStructuredData(researchSummary, correlationId);

      const generationStart = Date.now();
      const allItems = await this.generateAllBatches(
        genProvider, scoringProvider, effectiveSize, batchSize, numBatches,
        request, subtopics, researchSummary, correlationId
      );
      const generationTime = Date.now() - generationStart;

      result = {
        id: correlationId,
        topic: request.topic,
        researchSummary,
        sources: [],
        subtopics,
        knowledgeGraph,
        items: allItems,
        metrics: {
          totalItems: allItems.length,
          generationTime,
          cacheHit: false,
          providerLatency: await this.getProviderLatencyStats()
        }
      };

      if (options.enableCache !== false) {
        await this.cacheService.set(cacheKey, result, { ttlMs: 5 * 60 * 1000 });
        this.metricsService.increment('generation_cache_store', { correlation_id: correlationId });
      }

      this.metricsService.observe('generation_duration', Date.now() - startTime, { correlation_id: correlationId });
      this.metricsService.increment('generation_success', { correlation_id: correlationId });

      return result;

    } catch (error) {
      this.metricsService.increment('generation_error', {
        correlation_id: correlationId,
        error_type: (error as Error).constructor.name
      });
      this.metricsService.observe('generation_duration_error', Date.now() - startTime, { correlation_id: correlationId });
      throw error;
    } finally {
      this.correlationIds.delete(correlationId);
    }
  }

  private async generateAllBatches(
    genProvider: ModelProvider,
    scoringProvider: ModelProvider,
    targetSize: number,
    batchSize: number,
    numBatches: number,
    request: GenerationRequest,
    subtopics: string[],
    researchSummary: string,
    correlationId: string
  ): Promise<any[]> {
    const allItems: any[] = [];

    for (let idx = 0; idx < numBatches; idx++) {
      const itemsInThisBatch = Math.min(batchSize, targetSize - idx * batchSize);
      const subtopicSubset = this.getSubtopicSubset(subtopics, idx);

      const batchResult = await this.generateBatch(
        genProvider, scoringProvider, itemsInThisBatch, request, subtopicSubset, researchSummary, idx, correlationId
      );

      allItems.push(...batchResult.items);
    }

    return allItems;
  }

  private async generateBatch(
    genProvider: ModelProvider,
    scoringProvider: ModelProvider,
    itemsInThisBatch: number,
    request: GenerationRequest,
    subtopicSubset: string[],
    researchSummary: string,
    batchIndex: number,
    correlationId: string
  ): Promise<{ items: any[]; audits: number; refinements: number }> {
    const batchStart = Date.now();
    this.metricsService.increment('batch_start', { correlation_id: correlationId });

    const redTeamInstruction = request.redTeam ? '\nCRITICAL: ADVERSARIAL RED-TEAMING mode' : '';
    const crossDomainInstruction = request.secondaryTopic ? '\nCRITICAL: CROSS-DOMAIN SYNTHESIS mode' : '';
    const systemInstruction = `Generate ${itemsInThisBatch} training examples in '${request.format}' format.
Ground in: ${researchSummary}
Tone: ${request.tone}. Complexity: ${request.complexity}. Subtopics: ${subtopicSubset.join(", ")}.${redTeamInstruction}${crossDomainInstruction}`;

    let batchItems: any[] = [];
    let audits = 0;
    let refinements = 0;

    try {
      const generateStart = Date.now();
      const genResult = await genProvider.generate({
        prompt: `Synthesize exactly ${itemsInThisBatch} training items. Output valid JSON.`,
        systemPrompt: systemInstruction,
        temperature: request.temperature || 0.7,
        responseMimeType: "application/json",
      });

      this.metricsService.observe('generation_prompt_duration', Date.now() - generateStart, { correlation_id: correlationId });

      let parsed: any = {};
      try {
        parsed = JSON.parse(this.cleanJsonString(genResult || "{}"));
        batchItems = parsed.items || [];
        this.metricsService.increment('generation_parse_success', { correlation_id: correlationId });
      } catch (e) {
        this.metricsService.increment('generation_parse_error', { correlation_id: correlationId });
        logger.warn(`Batch ${batchIndex} parse error`, { correlationId }, e);
      }

      if (batchItems.length > 0) {
        const auditStart = Date.now();
        const auditResult = await this.qualityService.auditBatch(batchItems, scoringProvider, request.tone, request.complexity, correlationId);
        audits = auditResult.audits;
        refinements = auditResult.refinements;
        this.metricsService.observe('audit_duration', Date.now() - auditStart, { correlation_id: correlationId });

        // Actually apply refinement to the failed items — previously this counted
        // `refinements` for telemetry but never rewrote batchItems, so failed items
        // shipped unrefined regardless of the audit result.
        if (auditResult.refinementIndices.length > 0) {
          try {
            const refinerResult = await genProvider.generate({
              prompt: `Refine these items. Each has a critique explaining what's wrong. Output: { "refinedItems": [ { "index": number, "item": { ... } } ] }
${auditResult.refinementIndices.map(i => `Item ${i} (critique: ${auditResult.critiquesByIndex[i] || 'no critique provided'}): ${JSON.stringify(batchItems[i])}`).join("\n\n")}`,
              temperature: 0.4,
              responseMimeType: "application/json",
            });
            const refinedData = JSON.parse(this.cleanJsonString(refinerResult || "{}"));
            (refinedData.refinedItems || []).forEach((entry: any) => {
              if (typeof entry.index === 'number' && batchItems[entry.index] && auditResult.refinementIndices.includes(entry.index)) {
                batchItems[entry.index] = entry.item;
              }
            });
          } catch (e) {
            logger.warn(`Batch ${batchIndex} refinement failed — shipping unrefined items for indices ${auditResult.refinementIndices.join(",")}`, { correlationId }, e as Error);
          }
        }
      }

    } catch (error) {
      this.metricsService.increment('batch_error', { correlation_id: correlationId, error_type: (error as Error).constructor.name });
      this.metricsService.observe('batch_duration_error', Date.now() - batchStart, { correlation_id: correlationId });
      logger.error(`Batch ${batchIndex} failed`, { correlationId }, error);
    }

    this.metricsService.observe('batch_duration', Date.now() - batchStart, { correlation_id: correlationId });
    this.metricsService.increment('batch_complete', { correlation_id: correlationId });

    return { items: batchItems, audits, refinements };
  }

  private generateCacheKey(request: GenerationRequest): string {
    const hash = require('crypto').createHash('md5')
      .update(`${request.topic}|${request.size}|${request.format}|${request.temperature}|${request.tone}|${request.complexity}|${request.redTeam}|${request.primaryTopic}|${request.secondaryTopic}`)
      .digest('hex')
      .substring(0, 16);
    return `generation:${hash}`;
  }

  private getSubtopicSubset(subtopics: string[], index: number): string[] {
    const start = (index * 2) % subtopics.length;
    const end = start + 3;
    if (end <= subtopics.length) {
      return subtopics.slice(start, end);
    }
    return [...subtopics.slice(start), ...subtopics.slice(0, end - subtopics.length)];
  }

  private cleanJsonString(str: string): string {
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

  private async performResearch(
    researchProvider: ModelProvider,
    request: GenerationRequest,
    correlationId: string
  ): Promise<string> {
    const researchStart = Date.now();
    this.metricsService.increment('research_start', { correlation_id: correlationId });

    try {
      const researchResult = await researchProvider.generate({
        prompt: `Research the topic thoroughly: "${request.topic}". Provide comprehensive overview, covering fundamental concepts, practical use cases, and key subtopics.

[SUBTOPICS] Subtopic A | Subtopic B | Subtopic C | Subtopic D | Subtopic E | Subtopic F [END]
[KNOWLEDGE_GRAPH] { "nodes": [{"id":"core","label":"Core Concepts","level":0}], "edges": [] } [END]`,
        systemPrompt: 'You are a research assistant. Provide factual, well-structured information.',
        temperature: 0.4,
      });

      this.metricsService.observe('research_duration', Date.now() - researchStart, { correlation_id: correlationId });
      this.metricsService.increment('research_success', { correlation_id: correlationId });

      return researchResult || '';
    } catch (error) {
      this.metricsService.increment('research_error', { correlation_id: correlationId, error_type: (error as Error).constructor.name });
      logger.error(`Research failed for topic "${request.topic}"`, { correlationId }, error);
      return `Research on ${request.topic} - fundamental concepts and key aspects.`;
    }
  }

  private extractStructuredData(researchSummary: string, correlationId: string): { subtopics: string[], knowledgeGraph: any } {
    const subtopics: string[] = [];
    let knowledgeGraph = { nodes: [], edges: [] };

    const subtopicMatch = researchSummary.match(/\[SUBTOPICS\](.*?)(\[END\]|$)/s);
    if (subtopicMatch) {
      subtopics.push(...subtopicMatch[1].split("|").map(s => s.trim()).filter(Boolean));
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
      subtopics.push("Core Foundations", "Advanced Concepts", "Practical Demonstrations", "Historical Context", "Modern Applications");
    }

    return { subtopics, knowledgeGraph };
  }

  public generateCorrelationId(): string {
    return generateCorrelationId();
  }

  private async getProvider(config: any): Promise<ModelProvider> {
    return this.providerService.createProvider(config);
  }

  private getNextApiKey(provider: string): string | undefined {
    const keys = process.env.GEMINI_API_KEY || '';
    if (!keys) return undefined;
    const keyArray = keys.split(',').filter(k => k && k !== 'MY_GEMINI_API_KEY');
    if (keyArray.length === 0) return undefined;
    return keyArray[0];
  }

  private async getProviderLatencyStats(): Promise<Record<string, number>> {
    return this.providerService.getAllProviderLatencies();
  }

  public getServiceStats(): any {
    return {
      activeRequests: this.correlationIds.size,
      cacheStats: this.cacheService.getStats(),
      providerStats: this.providerService.getAllProviderStats(),
      metrics: this.metricsService.getSummary()
    };
  }
}

export { GenerationService };