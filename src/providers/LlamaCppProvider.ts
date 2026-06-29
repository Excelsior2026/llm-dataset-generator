import { ModelProvider, GenerateOptions, ProviderType } from "./types";

export class LlamaCppProvider implements ModelProvider {
  private baseUrl: string;
  private model: string;

  constructor(baseUrl: string, model: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
  }

  getProviderType(): ProviderType {
    return "llamacpp";
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      try {
        const res = await fetch(`${this.baseUrl}/v1/models`, { signal: AbortSignal.timeout(3000) });
        return res.ok;
      } catch {
        return false;
      }
    }
  }

  async generate(options: GenerateOptions): Promise<string> {
    if (options.responseMimeType === "application/json") {
      return this.generateJson(options);
    }
    return this.generateText(options);
  }

  private async generateText(options: GenerateOptions): Promise<string> {
    const prompt = options.systemPrompt
      ? `<|system|>\n${options.systemPrompt}\n<|user|>\n${options.prompt}\n<|assistant|>`
      : options.prompt;

    const body: any = {
      prompt,
      temperature: options.temperature ?? 0.7,
      n_predict: 4096,
      stop: ["<|user|>", "<|system|>"],
    };

    const res = await fetch(`${this.baseUrl}/completion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`llama.cpp request failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    return data.content || "";
  }

  private async generateJson(options: GenerateOptions): Promise<string> {
    const prompt = options.systemPrompt
      ? `<|system|>\n${options.systemPrompt}\n<|user|>\n${options.prompt}\nReturn ONLY valid JSON. No other text.\n<|assistant|>`
      : `${options.prompt}\nReturn ONLY valid JSON. No other text.`;

    const body: any = {
      prompt,
      temperature: options.temperature ?? 0.2,
      n_predict: 4096,
      stop: ["<|user|>", "<|system|>", "```"],
      grammar: "root ::= \"{\" [^{}]* \"}\"",
    };

    try {
      const res = await fetch(`${this.baseUrl}/completion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`llama.cpp request failed (${res.status}): ${text}`);
      }

      const data = await res.json();
      return data.content || "";
    } catch (e) {
      return this.generateText(options);
    }
  }
}
