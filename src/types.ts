/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type DatasetFormat = 'alpaca' | 'sharegpt' | 'qa' | 'raw';
export type ProviderType = "ollama" | "llamacpp" | "gemini";
export type ModelFunction = "research" | "generation" | "scoring";

export interface ModelFunctionConfig {
  provider: ProviderType;
  model: string;
  baseUrl?: string;
  apiKey?: string;
}

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

export interface TrajectoryStep {
  step: number;
  phase: 'initial_attempt' | 'self_critique' | 'final_correction';
  content: string;
  thought_process?: string;
}

export interface DatasetItem {
  id: string;
  format: DatasetFormat;
  topic?: string;
  feedback?: 'positive' | 'negative';
  qualityScore?: number;
  metadata: {
    reasoning: string;
    intent: string;
    complexity: string;
    is_negative: boolean;
    correction?: string;
    trajectory?: TrajectoryStep[];
    persona?: {
      role: string;
      mental_state: string;
      constraint: string;
    };
    interdisciplinary_link?: {
      domain_a: string;
      domain_b: string;
      synthesis_bridge: string;
    };
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

export interface SubtopicNode {
  id: string;
  label: string;
  level: number; 
}

export interface DependencyEdge {
  from: string; 
  to: string;   
}

export interface DatasetGenerationConfig {
  topic: string;
  secondaryTopic?: string;
  size: number;
  format: DatasetFormat;
  temperature: number;
  systemPromptText: string;
  tone: 'technical' | 'casual' | 'academic' | 'explanatory' | 'socratic';
  complexity: 'basic' | 'intermediate' | 'advanced';
  redTeam?: boolean;
  modelConfig?: {
    research: ModelFunctionConfig;
    generation: ModelFunctionConfig;
    scoring: ModelFunctionConfig;
  };
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
  knowledgeGraph: {
    nodes: SubtopicNode[];
    edges: DependencyEdge[];
  };
}

export interface APIResponse {
  summary: SearchResultSummary;
  items: DatasetItem[];
}
