import { GoogleGenAI } from "@google/genai";
import { ModelProvider, GenerateOptions, ProviderType, SearchResult } from "./types";

export class GeminiProvider implements ModelProvider {
  private client: GoogleGenAI;
  private model: string;

  constructor(apiKey: string, model: string) {
    if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
      throw new Error("GEMINI_API_KEY is not configured");
    }
    this.client = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  getProviderType(): ProviderType {
    return "gemini";
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async generate(options: GenerateOptions): Promise<string> {
    const config: any = {};

    if (options.temperature !== undefined) {
      config.temperature = options.temperature;
    }

    if (options.responseMimeType === "application/json") {
      config.responseMimeType = "application/json";
      if (options.responseSchema) {
        config.responseSchema = options.responseSchema;
      }
    }

    const contents = options.systemPrompt
      ? [{ role: "user", parts: [{ text: `${options.systemPrompt}\n\n${options.prompt}` }] }]
      : [{ role: "user", parts: [{ text: options.prompt }] }];

    const result = await this.client.models.generateContent({
      model: this.model,
      contents,
      config,
    });

    return result.text || "";
  }

  async generateWithSearch(options: GenerateOptions): Promise<SearchResult> {
    const result = await this.client.models.generateContent({
      model: this.model,
      contents: [{ role: "user", parts: [{ text: options.prompt }] }],
      config: {
        tools: [{ googleSearch: {} }],
        temperature: options.temperature ?? 0.4,
      },
    });

    const groundingChunks = result.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const sources = groundingChunks
      .map((chunk: any) => ({
        title: chunk?.web?.title || chunk?.title || "Source",
        url: chunk?.web?.uri || chunk?.uri || "",
      }))
      .filter((s: any) => s.url !== "");

    return { text: result.text || "", sources };
  }
}
