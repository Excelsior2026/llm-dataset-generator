/*
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ProviderType, ModelFunctionConfig } from '../types';
import { ModelProvider } from './types';

export interface ProviderPlugin {
  name: ProviderType;
  createProvider(config: ModelFunctionConfig): ModelProvider;
  isAvailable(config: ModelFunctionConfig): Promise<boolean>;
  getMetadata(): ProviderMetadata;
}

export interface ProviderMetadata {
  version: string;
  description: string;
  supportedFeatures: string[];
  defaultModel: string;
}

export class ProviderRegistry {
  private static instance: ProviderRegistry;
  private providers = new Map<ProviderType, ProviderPlugin>();

  static getInstance(): ProviderRegistry {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry();
    }
    return ProviderRegistry.instance;
  }

  register(plugin: ProviderPlugin): void {
    this.providers.set(plugin.name, plugin);
  }

  unregister(type: ProviderType): void {
    this.providers.delete(type);
  }

  get(type: ProviderType): ProviderPlugin | undefined {
    return this.providers.get(type);
  }

  list(): ProviderType[] {
    return Array.from(this.providers.keys());
  }

  async checkAllAvailability(
    configs: Record<ProviderType, ModelFunctionConfig>
  ): Promise<Record<ProviderType, boolean>> {
    const results: Record<ProviderType, boolean> = {} as any;

    for (const [type, config] of Object.entries(configs)) {
      const provider = this.get(type as ProviderType);
      if (provider) {
        results[type as ProviderType] = await provider.isAvailable(config);
      } else {
        results[type as ProviderType] = false;
      }
    }

    return results;
  }

  getMetadata(type: ProviderType): ProviderMetadata | undefined {
    const provider = this.providers.get(type);
    return provider?.getMetadata();
  }
}

export async function loadProviderPlugins(): Promise<void> {
  const registry = ProviderRegistry.getInstance();

  const { GeminiProvider } = await import('../providers/GeminiProvider');
  const { OllamaProvider } = await import('../providers/OllamaProvider');
  const { LlamaCppProvider } = await import('../providers/LlamaCppProvider');

  registry.register({
    name: 'gemini',
    createProvider: config => new GeminiProvider(config.apiKey || '', config.model),
    isAvailable: async config => {
      if (!config.apiKey || config.apiKey === 'MY_GEMINI_API_KEY') return false;
      try {
        const provider = new GeminiProvider(config.apiKey, config.model);
        return await provider.isAvailable();
      } catch {
        return false;
      }
    },
    getMetadata: () => ({
      version: '2.0.0',
      description: 'Google Gemini AI (cloud)',
      supportedFeatures: ['research', 'generation', 'scoring', 'grounding'],
      defaultModel: 'gemini-2.0-flash',
    }),
  });

  registry.register({
    name: 'ollama',
    createProvider: config => new OllamaProvider(config.baseUrl || 'http://localhost:11434', config.model),
    isAvailable: async config => {
      try {
        const provider = new OllamaProvider(config.baseUrl || 'http://localhost:11434', config.model);
        return await provider.isAvailable();
      } catch {
        return false;
      }
    },
    getMetadata: () => ({
      version: '1.0.0',
      description: 'Ollama local models',
      supportedFeatures: ['research', 'generation', 'scoring'],
      defaultModel: 'llama3.2:3b',
    }),
  });

  registry.register({
    name: 'llamacpp',
    createProvider: config => new LlamaCppProvider(config.baseUrl || 'http://localhost:8080', config.model),
    isAvailable: async config => {
      try {
        const provider = new LlamaCppProvider(config.baseUrl || 'http://localhost:8080', config.model);
        return await provider.isAvailable();
      } catch {
        return false;
      }
    },
    getMetadata: () => ({
      version: '1.0.0',
      description: 'llama.cpp local inference',
      supportedFeatures: ['research', 'generation', 'scoring'],
      defaultModel: 'models/llama-3.2-3b.Q4_K_M.gguf',
    }),
  });
}
