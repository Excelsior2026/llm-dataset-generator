/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express, { Request, Response } from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));

// Lazy initializer for Google GenAI to handle missing keys gracefully on startup.
function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey.trim() === "") {
    throw new Error("GEMINI_API_KEY is not configured in the environment. Please add it in the Secrets panel (Settings > Secrets).");
  }
  return new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
}

// Helpers for schema mapping based on chosen format
function getSchemaForFormat(format: string) {
  if (format === "alpaca") {
    return {
      type: Type.OBJECT,
      properties: {
        items: {
          type: Type.ARRAY,
          description: "List of synthesized Alpaca instruction items",
          items: {
            type: Type.OBJECT,
            properties: {
              instruction: { type: Type.STRING, description: "The prompt or instruction for the model" },
              input: { type: Type.STRING, description: "Optional background, context, or code scaffold for the instruction. Leave empty if a standalone instruction." },
              output: { type: Type.STRING, description: "Detailed, high-quality response/completion" },
              topic: { type: Type.STRING, description: "The subtopic or category this instruction falls under" }
            },
            required: ["instruction", "input", "output", "topic"]
          }
        }
      },
      required: ["items"]
    };
  } else if (format === "sharegpt") {
    return {
      type: Type.OBJECT,
      properties: {
        items: {
          type: Type.ARRAY,
          description: "List of multi-turn conversation sessions",
          items: {
            type: Type.OBJECT,
            properties: {
              topic: { type: Type.STRING, description: "The subtopic or category this conversation models" },
              messages: {
                type: Type.ARRAY,
                description: "Sequential list of conversation dialog turns",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    role: { type: Type.STRING, description: "Sender role: system, user, or assistant" },
                    content: { type: Type.STRING, description: "The spoken or thought response of the character" }
                  },
                  required: ["role", "content"]
                }
              }
            },
            required: ["topic", "messages"]
          }
        }
      },
      required: ["items"]
    };
  } else if (format === "qa") {
    return {
      type: Type.OBJECT,
      properties: {
        items: {
          type: Type.ARRAY,
          description: "List of question and answer training pairs",
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING, description: "A highly specific, direct educational or technical question" },
              answer: { type: Type.STRING, description: "A detailed, structured and expert educational response" },
              topic: { type: Type.STRING, description: "The subtopic or category this question falls under" }
            },
            required: ["question", "answer", "topic"]
          }
        }
      },
      required: ["items"]
    };
  } else {
    // raw
    return {
      type: Type.OBJECT,
      properties: {
        items: {
          type: Type.ARRAY,
          description: "List of pre-training textbook document chunks",
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: "The title or section header of the text block" },
              text: { type: Type.STRING, description: "Dense, encyclopedia-like educational information, prose, or code, formatted in detail" },
              topic: { type: Type.STRING, description: "The subtopic or category this chunk target" }
            },
            required: ["title", "text", "topic"]
          }
        }
      },
      required: ["items"]
    };
  }
}

// Clean helper to remove JSON format backticks if the model ignores responseMimeType occasionally
function cleanJsonString(str: string): string {
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

/**
 * Endpoint to query search grounding and build dataset
 */
app.post("/api/generate", async (req: Request, res: Response) => {
  try {
    const { topic, size = 10, format = "alpaca", temperature = 0.7, tone = "explanatory", complexity = "intermediate" } = req.body;

    if (!topic || topic.trim() === "") {
      res.status(400).json({ error: "Missing required field 'topic'" });
      return;
    }

    const ai = getGeminiClient();

    // Step 1: Perform Google Search Grounding to research the topic
    console.log(`Researching topic: "${topic}" via Google Search Grounding...`);
    const searchResponse = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `You are an elite research engine. Research the following topic exhaustively using Google Search: "${topic}".
Provide an detailed, authoritative research overview highlighting:
1. Fundamental concepts, major definitions, and underlying rules.
2. Scientific formula, code examples, or chronological timelines where applicable.
3. Solved problems, practical use cases, and contemporary debates/discoveries.

Additionally, output a list of 6 to 8 subtopics. You MUST format this subtopics section at the very end of your response exactly like this:
[SUBTOPICS] Subtopic A | Subtopic B | Subtopic C | Subtopic D ... [END]`,
      config: {
        tools: [{ googleSearch: {} }],
        temperature: 0.4
      }
    });

    let researchSummary = searchResponse.text || "";
    const groundingChunks = searchResponse.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    
    // Parse sources
    const sources = groundingChunks
      .map((chunk: any) => ({
        title: chunk?.web?.title || chunk?.title || "Search Grounding Source",
        url: chunk?.web?.uri || chunk?.uri || ""
      }))
      .filter((source: any) => source.url !== "");

    // Extract subtopics
    let subtopics: string[] = [];
    const subtopicMatch = researchSummary.match(/\[SUBTOPICS\](.*?)(\[END\]|$)/s);
    if (subtopicMatch) {
      subtopics = subtopicMatch[1]
        .split("|")
        .map(s => s.trim())
        .filter(Boolean);
      // Strip subtopics section from customer-facing report
      researchSummary = researchSummary.replace(/\[SUBTOPICS\].*?(\[END\]|$)/s, "").trim();
    }

    if (subtopics.length === 0) {
      subtopics = [
        "Core Foundations",
        "Advanced Concepts",
        "Practical Demonstrations",
        "Historical Background & Milestones",
        "Contemporary Controversies & Future Work"
      ];
    }

    console.log(`Discovered Subtopics:`, subtopics);

    // Step 2: Batch Generation of dataset items
    // We break them down into sizes of 5 or 6 per batch to guarantee length and details
    const targetSize = Math.max(1, Math.min(30, size)); // Protect limits (max 30)
    const batchSize = 5;
    const numBatches = Math.ceil(targetSize / batchSize);
    const schema = getSchemaForFormat(format);

    console.log(`Synthesizing dataset of ${targetSize} items in ${numBatches} parallel batches...`);

    const batchPromises = Array.from({ length: numBatches }).map(async (_, idx) => {
      const itemsInThisBatch = Math.min(batchSize, targetSize - idx * batchSize);
      
      // Determine subset of subtopics for this specific batch to ensure high entropy/diversity
      const subtopicSubset = subtopics.slice(
        (idx * 2) % subtopics.length,
        ((idx * 2) + 3) % subtopics.length || subtopics.length
      );

      const systemInstruction = `You are an expert AI compiler and high-fidelity synthetic LLM training dataset engine.
Your purpose is to generate ${itemsInThisBatch} distinct, exceptionally detailed, high-quality, and robust training examples in the '${format}' layout.
Ground your generation in the following verified research material:
---
${researchSummary}
---

Your output must comply strictly with these criteria:
- **Tone/Style**: ${tone}.
- **Target Complexity**: ${complexity} depth.
- **Subtopics to target in this specific batch**: ${subtopicSubset.join(", ")}.
- Ensure every example is highly educational and unique. Avoid repeating similar sentence structures or concepts across items.
- Output MUST be strict JSON matching the requested schema. Do not insert any Markdown wrappers or explanatory text outside the JSON.`;

      const prompt = `Synthesize exactly ${itemsInThisBatch} training dataset items. Refuse placeholder or truncated values. Output absolutely valid JSON.`;

      try {
        const generation = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
          config: {
            systemInstruction: systemInstruction,
            temperature: temperature,
            responseMimeType: "application/json",
            responseSchema: schema
          }
        });

        const rawJsonText = cleanJsonString(generation.text || "{}");
        const parsed = JSON.parse(rawJsonText);
        return parsed.items || [];
      } catch (err) {
        console.error(`Error in batch ${idx}:`, err);
        return [];
      }
    });

    const results = await Promise.all(batchPromises);
    const rawItems = results.flat();

    // Map items to unique identifiers and the exact types format
    let idCounter = 1;
    const finalItems = rawItems.map((item: any) => {
      const id = `item-${Date.now()}-${idCounter++}`;
      const itemTopic = item.topic || "General Concepts";
      
      if (format === "alpaca") {
        return {
          id,
          format: "alpaca",
          topic: itemTopic,
          alpaca: {
            instruction: item.instruction || "No instruction provided",
            input: item.input || "",
            output: item.output || ""
          }
        };
      } else if (format === "sharegpt") {
        return {
          id,
          format: "sharegpt",
          topic: itemTopic,
          sharegpt: {
            messages: item.messages || [
              { role: "system", content: "You are an expert assistant." },
              { role: "user", content: "Tell me about this topic." },
              { role: "assistant", content: "Here is the key info." }
            ]
          }
        };
      } else if (format === "qa") {
        return {
          id,
          format: "qa",
          topic: itemTopic,
          qa: {
            question: item.question || "What is this topic?",
            answer: item.answer || "Detail answer of this topic"
          }
        };
      } else {
        // raw
        return {
          id,
          format: "raw",
          topic: itemTopic,
          raw: {
            title: item.title || "Section Overview",
            text: item.text || "Detailed text contents"
          }
        };
      }
    });

    res.json({
      summary: {
        topic,
        researchSummary,
        sources,
        subtopics
      },
      items: finalItems
    });
  } catch (error: any) {
    console.error("Synthesize breakdown:", error);
    res.status(500).json({ error: error.message || "An unresolved error occurred during server synthesis." });
  }
});

/**
 * Endpoint to generate individual synthetic items based on existing dataset
 */
app.post("/api/generate-more", async (req: Request, res: Response) => {
  try {
    const { topic, researchSummary, format, count = 2, tone = "explanatory", complexity = "intermediate", existingPrompts = [] } = req.body;

    if (!researchSummary) {
      res.status(400).json({ error: "Missing required field 'researchSummary'" });
      return;
    }

    const ai = getGeminiClient();
    const schema = getSchemaForFormat(format);

    console.log(`Generating more synthetic items for ${topic}...`);

    const systemInstruction = `You are an expert AI synthetic text compiler.
Generate exactly ${count} completely brand-new, unique and detailed training dataset items in the '${format}' layout.
Base them strictly on the factual details of the research report below:
---
${researchSummary}
---

Your items MUST be entirely distinct from these existing items/prompts that are already in the dataset. DO NOT cover the exact same prompt wording:
---
${existingPrompts.slice(0, 15).join("\n")}
---

Tone: ${tone}.
Target Complexity: ${complexity}.
Ensure absolute precision. Keep the JSON perfect.`;

    const prompt = `Generate ${count} brand-new additional dataset items matching the JSON schema.`;

    const generation = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction,
        temperature: 0.8,
        responseMimeType: "application/json",
        responseSchema: schema
      }
    });

    const rawJsonText = cleanJsonString(generation.text || "{}");
    const parsed = JSON.parse(rawJsonText);
    const rawItems = parsed.items || [];

    let idCounter = 1;
    const finalItems = rawItems.map((item: any) => {
      const id = `item-synthetic-${Date.now()}-${idCounter++}`;
      const itemTopic = item.topic || "Extended Concepts";

      if (format === "alpaca") {
        return {
          id,
          format: "alpaca",
          topic: itemTopic,
          alpaca: {
            instruction: item.instruction || "New instruction detail",
            input: item.input || "",
            output: item.output || ""
          }
        };
      } else if (format === "sharegpt") {
        return {
          id,
          format: "sharegpt",
          topic: itemTopic,
          sharegpt: {
            messages: item.messages || [
              { role: "system", content: "You are an expert." },
              { role: "user", content: "Tell me about this new nuance." },
              { role: "assistant", content: "Here is the response." }
            ]
          }
        };
      } else if (format === "qa") {
        return {
          id,
          format: "qa",
          topic: itemTopic,
          qa: {
            question: item.question || "Synthesized detail question?",
            answer: item.answer || "Synthesized detail response"
          }
        };
      } else {
        return {
          id,
          format: "raw",
          topic: itemTopic,
          raw: {
            title: item.title || "Synthesized Prose Title",
            text: item.text || "Description of synthesized concepts"
          }
        };
      }
    });

    res.json({ items: finalItems });
  } catch (error: any) {
    console.error("Synthesize more breakdown:", error);
    res.status(500).json({ error: error.message || "An unresolved error occurred during expansion generation." });
  }
});

// Vite middleware and asset serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
