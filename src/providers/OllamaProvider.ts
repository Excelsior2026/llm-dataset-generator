import { ModelProvider, GenerateOptions, ProviderType } from "./types";

export class OllamaProvider implements ModelProvider {
  private baseUrl: string;
  private model: string;

  constructor(baseUrl: string, model: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
  }

  getProviderType(): ProviderType {
    return "ollama";
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generate(options: GenerateOptions): Promise<string> {
    const body: any = {
      model: this.model,
      prompt: options.systemPrompt
        ? `${options.systemPrompt}\n\n${options.prompt}`
        : options.prompt,
      stream: false,
      options: {},
    };

    if (options.temperature !== undefined) {
      body.options.temperature = options.temperature;
    }

    if (options.responseMimeType === "application/json") {
      body.format = "json";
    }

    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama request failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    return data.response || "";
  }
}
