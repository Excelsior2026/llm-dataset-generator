/*
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ModelProvider } from '../providers/types';
import { MetricsService } from './MetricsService';

export interface AuditResult {
  audits: number;
  refinements: number;
  failedItems: number;
  improvementScore: number;
  /** Indices (into the batch passed to auditBatch) of items the critic marked invalid. */
  failedIndices: number[];
  /** Subset of failedIndices whose confidence cleared the refinement threshold — these are the ones to actually refine. */
  refinementIndices: number[];
  /** Per-index critique text, for logging/debugging refinement quality. */
  critiquesByIndex: Record<number, string>;
}

export interface QualityThresholds {
  minConfidence?: number;
  maxRetries?: number;
  enableRefinement?: boolean;
}

export class QualityService {
  private static instance: QualityService;
  private metricsService: MetricsService;

  private constructor() {
    this.metricsService = MetricsService.getInstance();
  }

  public static getInstance(): QualityService {
    if (!QualityService.instance) {
      QualityService.instance = new QualityService();
    }
    return QualityService.instance;
  }

  async auditBatch(
    items: any[],
    scoringProvider: ModelProvider,
    tone: string,
    complexity: string,
    correlationId: string
  ): Promise<AuditResult> {
    const startTime = Date.now();
    this.metricsService.increment('audit_start', { correlation_id: correlationId });

    try {
      const auditStart = Date.now();
      const auditResult = await scoringProvider.generate({
        prompt: `Audit these ${items.length} training items.
For each item, analyze:
1. Logical gaps in reasoning
2. Factual inaccuracies
3. Misalignment between reasoning and output
4. Subtle logical traps

Output JSON: { "critiques": [ { "index": number, "isValid": boolean, "critique": "feedback", "confidence": number } ] }

Items: ${JSON.stringify(items)}`,
        systemPrompt: `You are a world-class logic auditor. Provide detailed critique with confidence scores (0-1).`,
        temperature: 0.2,
        responseMimeType: "application/json",
      });

      this.metricsService.observe('audit_prompt_duration', Date.now() - auditStart, { correlation_id: correlationId });

      let parsed: any = {};
      try {
        parsed = JSON.parse(this.cleanJsonString(auditResult || "{}"));
        this.metricsService.increment('audit_parse_success', { correlation_id: correlationId });
      } catch (e) {
        this.metricsService.increment('audit_parse_error', { correlation_id: correlationId });
        // Parse failure means we couldn't audit anything — treat every item as failed but
        // give the caller no indices to "refine" against, since we have no critique data at all.
        return {
          audits: items.length, refinements: 0, failedItems: items.length, improvementScore: 0,
          failedIndices: [], refinementIndices: [], critiquesByIndex: {}
        };
      }

      const critiques = parsed.critiques || [];
      const enabled = this.getRefinementThreshold();

      const failedIndices: number[] = [];
      const refinementIndices: number[] = [];
      const critiquesByIndex: Record<number, string> = {};

      for (const critique of critiques) {
        const idx = critique.index;
        if (typeof idx !== 'number' || idx < 0 || idx >= items.length) {
          // Critic returned an index we can't map to a real item — skip rather than
          // silently pointing refinement at the wrong item (the old [0] fallback bug).
          continue;
        }
        if (!critique.isValid) {
          failedIndices.push(idx);
          if (critique.critique) critiquesByIndex[idx] = critique.critique;
          if (enabled && (critique.confidence ?? 1) >= enabled) {
            refinementIndices.push(idx);
          }
        }
      }

      const failedItems = failedIndices.length;
      const refinements = refinementIndices.length;

      const improvementScore = items.length > 0
        ? Math.max(0, 100 - (failedItems / items.length) * 100)
        : 0;

      this.metricsService.increment('audit_complete', {
        correlation_id: correlationId,
        audits: items.length,
        failed_items: failedItems,
        refinements: refinements,
        improvement_score: improvementScore
      });

      return {
        audits: items.length,
        refinements,
        failedItems,
        improvementScore,
        failedIndices,
        refinementIndices,
        critiquesByIndex
      };

    } catch (error) {
      this.metricsService.increment('audit_error', { correlation_id: correlationId, error_type: (error as Error).constructor.name });
      this.metricsService.observe('audit_duration_error', Date.now() - startTime, { correlation_id: correlationId });
      console.error(`Audit failed for ${items.length} items`, { correlationId }, error);
      return {
        audits: 0, refinements: 0, failedItems: items.length, improvementScore: 0,
        failedIndices: [], refinementIndices: [], critiquesByIndex: {}
      };
    }
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

  private getRefinementThreshold(): number | undefined {
    const threshold = process.env.JUDGE_THRESHOLD ? parseFloat(process.env.JUDGE_THRESHOLD) : undefined;
    return threshold && !isNaN(threshold) ? threshold : 0.7;
  }

  public getQualityStats(): any {
    return {
      refinementThreshold: this.getRefinementThreshold(),
      minConfidence: 0.5,
      maxRetries: 2,
      enableRefinement: true
    };
  }
}

export default QualityService;