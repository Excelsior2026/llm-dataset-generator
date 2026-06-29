export type ProviderType = "ollama" | "llamacpp" | "gemini";
export type ModelFunction = "research" | "generation" | "scoring";

export interface ModelFunctionConfig {
  provider: ProviderType;
  model: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface ProviderConfig {
  research: ModelFunctionConfig;
  generation: ModelFunctionConfig;
  scoring: ModelFunctionConfig;
}

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
