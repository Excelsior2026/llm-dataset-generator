/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type DatasetFormat = 'alpaca' | 'sharegpt' | 'qa' | 'raw';

export interface AlpacaItem {
  instruction: string;
  input: string;
  output: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ShareGPTItem {
  messages: ChatMessage[];
}

export interface QAItem {
  question: string;
  answer: string;
}

export interface RawItem {
  text: string;
  title: string;
}

export interface DatasetItem {
  id: string;
  format: DatasetFormat;
  topic?: string;
  metadata: {
    reasoning: string;
    intent: string;
    complexity: string;
    is_negative: boolean;
    correction?: string;
  };
  alpaca?: AlpacaItem;
  sharegpt?: ShareGPTItem;
  qa?: QAItem;
  raw?: RawItem;
}

export interface ResearchSource {
  title: string;
  url: string;
}

export interface DatasetGenerationConfig {
  topic: string;
  size: number;
  format: DatasetFormat;
  temperature: number;
  systemPromptText: string;
  tone: 'technical' | 'casual' | 'academic' | 'explanatory' | 'socratic';
  complexity: 'basic' | 'intermediate' | 'advanced';
}

export interface DatasetMetrics {
  totalItems: number;
  estimatedTokens: number;
  vocabUniqueWords: number;
  avgResponseChars: number;
  subtopicCoverage: { name: string; count: number }[];
  tokenRangeDistribution: { range: string; count: number }[];
  complexityBreakdown: { name: string; value: number }[];
}

export interface SearchResultSummary {
  topic: string;
  researchSummary: string;
  sources: ResearchSource[];
  subtopics: string[];
}

export interface APIResponse {
  summary: SearchResultSummary;
  items: DatasetItem[];
}
