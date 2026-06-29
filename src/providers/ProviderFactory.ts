import { ModelProvider, ProviderConfig, ModelFunctionConfig } from "./types";
import { OllamaProvider } from "./OllamaProvider";
import { LlamaCppProvider } from "./LlamaCppProvider";
import { GeminiProvider } from "./GeminiProvider";
import { logger } from "../utils/index";

export function createProvider(config: ModelFunctionConfig): ModelProvider {
  switch (config.provider) {
    case "ollama":
      return new OllamaProvider(config.baseUrl || "http://localhost:11434", config.model);
    case "llamacpp":
      return new LlamaCppProvider(config.baseUrl || "http://localhost:8080", config.model);
    case "gemini":
      return new GeminiProvider(config.apiKey || process.env.GEMINI_API_KEY || "", config.model);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

export async function checkProviderAvailability(provider: ModelProvider): Promise<boolean> {
  try {
    return await provider.isAvailable();
  } catch (e) {
    return false;
  }
}

export async function getProviderStatus(config: ProviderConfig): Promise<Record<string, { available: boolean; provider: string; model: string }>> {
  const results: Record<string, any> = {};

  for (const func of ["research", "generation", "scoring"] as const) {
    try {
      const provider = createProvider(config[func]);
      const available = await checkProviderAvailability(provider);
      results[func] = { available, provider: config[func].provider, model: config[func].model };
    } catch (e: any) {
      results[func] = { available: false, provider: config[func].provider, model: config[func].model, error: e.message };
    }
  }

  return results;
}

export function getDefaultModelForProvider(provider: string, func: string): string {
  if (provider === "ollama") {
    switch (func) {
      case "research": return "llama3.2:3b";
      case "generation": return "qwen2.5:7b";
      case "scoring": return "llama3.2:3b";
    }
  }
  if (provider === "llamacpp") {
    switch (func) {
      case "research": return "ggml-model-q4_k_m.gguf";
      case "generation": return "ggml-model-q4_k_m.gguf";
      case "scoring": return "ggml-model-q4_k_m.gguf";
    }
  }
  if (provider === "gemini") {
    switch (func) {
      case "research": return "gemini-2.5-flash";
      case "generation": return "gemini-2.5-flash";
      case "scoring": return "gemini-2.5-flash";
    }
  }
  return "default";
}

export { GeminiProvider } from "./GeminiProvider";
