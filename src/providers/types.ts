export { ProviderType, ModelFunction, ModelFunctionConfig, ProviderConfig } from '../types';

export interface GenerateOptions {
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  responseMimeType?: "text/plain" | "application/json";
  responseSchema?: any;
}

export interface ModelProvider {
  generate(options: GenerateOptions): Promise<string>;
  isAvailable(): Promise<boolean>;
  getProviderType(): ProviderType;
}

export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  research: { provider: "ollama", model: "llama3.2:3b", baseUrl: "http://localhost:11434" },
  generation: { provider: "ollama", model: "qwen2.5:7b", baseUrl: "http://localhost:11434" },
  scoring: { provider: "ollama", model: "llama3.2:3b", baseUrl: "http://localhost:11434" },
};

export interface SearchResult {
  text: string;
  sources: { title: string; url: string }[];
}