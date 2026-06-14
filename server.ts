/*
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express, { Request, Response, NextFunction } from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { withRetry, createTimeoutPromise, createItemMapper, getSchemaForFormat, logger } from "./src/utils/index";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "50mb" }));

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (!err) return next();

  logger.error(`Error in ${req.method} ${req.path}:`, err);

  if (err instanceof Error && err.message.includes("GEMINI_API_KEY")) {
    res.status(400).json({ error: err.message });
    return;
  }

  res.status(500).json({
    error: "Internal server error during synthesis pipeline"
  });
});

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

// Clean JSON response helper
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

// Optimized format mapping function to reduce duplication
// Note: Using createItemMapper from utils/index.ts

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
    logger.info(`Researching topic: "${topic}" via Google Search Grounding...`);
    const searchResponse = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: `You are an elite research engine. Research the following topic exhaustively using Google Search: "${topic}".
Provide an detailed, authoritative research overview highlighting:
1. Fundamental concepts, major definitions, and underlying rules.
2. Scientific formula, code examples, or chronological timelines where applicable.
3. Solved problems, practical use cases, and contemporary debates/discoveries.

Additionally, output two structured sections at the end:
1. [SUBTOPICS]: A list of 6 to 8 subtopics separated by '|'.
2. [KNOWLEDGE_GRAPH]: A JSON object containing 'nodes' (id, label, level) and 'edges' (from, to), representing the pedagogical dependency of these subtopics (which concepts must be learned first).

Format the end of your response exactly like this:
[SUBTOPICS] Subtopic A | Subtopic B ... [END]
[KNOWLEDGE_GRAPH] { "nodes": [...], "edges": [...] } [END]`,
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

    // Extract Knowledge Graph
    let knowledgeGraph = { nodes: [], edges: [] };
    const kgMatch = researchSummary.match(/\[KNOWLEDGE_GRAPH\](.*?)(\[END\]|$)/s);
    if (kgMatch) {
      try {
        const parsed = JSON.parse(kgMatch[1].trim());
        // Validate that nodes and edges arrays exist
        if (parsed.nodes && Array.isArray(parsed.nodes) && parsed.edges && Array.isArray(parsed.edges)) {
          knowledgeGraph = parsed;
        } else {
          logger.warn("Knowledge graph missing required nodes or edges arrays");
        }
      } catch (e) {
        logger.warn("Failed to parse knowledge graph from AI response");
      }
      researchSummary = researchSummary.replace(/\[KNOWLEDGE_GRAPH\].*?(\[END\]|$)/s, "").trim();
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

    logger.info(`Discovered Subtopics: ${subtopics}`);

    // Step 2: Batch Generation of dataset items with retry logic
    const targetSize = Math.max(1, Math.min(30, size)); // Protect limits (max 30)
    const batchSize = 5;
    const numBatches = Math.ceil(targetSize / batchSize);
    
    logger.info(`Synthesizing dataset of ${targetSize} items in ${numBatches} parallel batches...`);

    // Create batch promises with timeout protection
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
- **Reasoning First**: For every item, you MUST first construct a detailed, step-by-step chain-of-thought reasoning path in the 'metadata.reasoning' field.
- **Intent Encoding**: Assign a cognitive intent to each item (e.g., 'Socratic', 'Adversarial', 'First-Principles', 'Deductive').
- **Rationality & Contrast**: Some items should be marked as 'is_negative: true'. In these cases, the 'output' should contain a subtle but critical logical error, and 'metadata.correction' must provide the corrected logic and answer.
- **Self-Correction Trajectories**: For high-complexity items, generate a 'metadata.trajectory' array (Initial Attempt $\rightarrow$ Self-Critique $\rightarrow$ Final Correction).
- **Theory of Mind (ToM)**: Assign a 'metadata.persona' to each item. Define the persona's role, mental state (e.g., "skeptical", "curious", "confused"), and a specific constraint they are operating under. The output must be tailored to this persona.
- **Interdisciplinary Synthesis**: For a subset of items, create an 'interdisciplinary_link'. Connect the core topic to a seemingly unrelated second domain. Explain the 'synthesis_bridge'—the conceptual logic that connects them.
- **Ambiguity Handling**: Some items should be intentionally under-specified. The 'correct' output in these cases is for the AI to identify the ambiguity and ask the necessary clarifying questions.
- **Complexity Scaling**: Vary the complexity across 'novice', 'intermediate', and 'expert' levels.
- **Tone/Style**: ${tone}.
- **Target Complexity**: ${complexity} depth.
- **Subtopics to target in this specific batch**: ${subtopicSubset.join(", ")}.
- Ensure every example is highly educational and unique. Avoid repeating similar sentence structures or concepts across items.
- Output MUST be strict JSON matching the requested schema. Do not insert any Markdown wrappers or explanatory text outside the JSON.`;


      const prompt = `Synthesize exactly ${itemsInThisBatch} training dataset items. Refuse placeholder or truncated values. Output absolutely valid JSON.`;

      const generateBatch = async () => {
        // 1. Multi-Model Generation for Consensus
        const consensusModels = ["gemini-1.5-flash", "gemini-1.5-pro"]; // Use different model tiers for cross-verification
        
        logger.info(`Executing multi-model consensus generation using: ${consensusModels.join(", ")}...`);
        
        const modelPromises = consensusModels.map(async (modelName) => {
          const generation = await ai.models.generateContent({
            model: modelName,
            contents: prompt,
            config: {
              systemInstruction: systemInstruction,
              temperature: temperature,
              responseMimeType: "application/json",
              responseSchema: getSchemaForFormat(format)
            }
          });
          try {
            const parsed = JSON.parse(cleanJsonString(generation.text || "{}"));
            return parsed.items || [];
          } catch (error) {
            logger.error(`Failed to parse JSON from model ${modelName}:`, error);
            return [];
          }
        });

        const allModelResults = await Promise.allSettled(modelPromises);
        const resultsData = allModelResults
          .filter(r => r.status === 'fulfilled')
          .map(r => (r as PromiseFulfilledResult<any[]>).value)
          .filter(items => items.length > 0);

        if (resultsData.length === 0) return [];

        // Use the first successful model as the baseline, then analyze consensus
        let items = resultsData[0];

        if (resultsData.length > 1) {
          logger.info(`Analyzing logic consensus across ${resultsData.length} models...`);
          
          // Consensus analysis prompt
          const consensusPrompt = `You are a logic consensus engine. I will provide you with multiple versions of the same training dataset batch generated by different LLMs.
Your task is to compare the 'metadata.reasoning' and 'output' of each version.

For each item index:
1. Determine if the models agree on the logical path.
2. If there is a discrepancy, identify which version is more robust or synthesize a "Golden Version" that combines the strengths of both.
3. Mark the item as 'requires_review: true' if the models fundamentally disagree on the factual answer.

Output a JSON object: { "refinedItems": [ { "index": number, "item": { ... }, "consensusReached": boolean, "reviewRequired": boolean } ] }

Items from Model 0: ${JSON.stringify(resultsData[0])}
${resultsData.length > 1 ? `Items from Model 1: ${JSON.stringify(resultsData[1])}` : ''}
...`;

          const consensusResponse = await ai.models.generateContent({
            model: "gemini-1.5-pro",
            contents: consensusPrompt,
            config: {
              temperature: 0.2,
              responseMimeType: "application/json"
            }
          });

          try {
            const consensusData = JSON.parse(cleanJsonString(consensusResponse.text || "{}"));
            const refinedItems = consensusData.refinedItems || [];

            refinedItems.forEach((entry: any) => {
              if (typeof entry.index === 'number' && items[entry.index]) {
                items[entry.index] = entry.item;
                // Inject a flag for the UI to highlight "High Entropy" / Disagreement
                if (entry.reviewRequired) {
                  items[entry.index].metadata = { 
                    ...items[entry.index].metadata, 
                    intent: `REVIEW: ${items[entry.index].metadata.intent}` 
                  };
                }
              }
            });
          } catch (error) {
            logger.error("Failed to parse consensus response:", error);
          }
        }

        // 2. Critic Phase: Audit the synthesized consensus result for logical integrity
        logger.info(`Auditing batch of ${items.length} items...`);
        const judgePrompt = `You are a world-class logic auditor. Review these ${items.length} training items. 
For each item, identify:
1. Logical gaps in the 'metadata.reasoning' path.
2. Factual inaccuracies.
3. Misalignment between reasoning and the final output.
4. Subtle logical traps that were not correctly handled.

Output a JSON array of critiques, where each object matches the index of the item:
{ "critiques": [ { "index": 0, "isValid": boolean, "critique": "detailed feedback" }, ... ] }`;

        const judgeResponse = await ai.models.generateContent({
          model: "gemini-1.5-flash",
          contents: `${judgePrompt}\n\nItems to audit:\n${JSON.stringify(items)}`,
          config: {
            temperature: 0.2,
            responseMimeType: "application/json"
          }
        });

        try {
          const judgeData = JSON.parse(cleanJsonString(judgeResponse.text || "{}"));
          const critiques = judgeData.critiques || [];

          // 3. Refinement Phase: Fix items that failed the audit
          const failedIndices = critiques.filter(c => !c.isValid).map(c => c.index);

          if (failedIndices.length > 0) {
            logger.info(`Refining ${failedIndices.length} items based on critic feedback...`);
            
            const refinerPrompt = `You are an expert AI refiner. I will provide you with a set of training items and their corresponding critiques. 
Rewrite the items to ensure absolute logical precision and high-fidelity reasoning. 
Preserve the original intent and format. Ensure the 'metadata.reasoning' is now flawless.

You MUST output a JSON object containing a 'refinedItems' array, where each object includes the 'index' of the original item it is replacing.
Format: { "refinedItems": [ { "index": 0, "item": { ...original schema... } }, ... ] }

Input:
${critiques.filter(c => !c.isValid).map(c => `Item Index ${c.index}: ${JSON.stringify(items[c.index])}\nCritique: ${c.critique}`).join("\n\n")}
`;

            const refinerResponse = await ai.models.generateContent({
              model: "gemini-1.5-pro",
              contents: refinerPrompt,
              config: {
                temperature: 0.4,
                responseMimeType: "application/json"
              }
            });

            try {
              const refinedData = JSON.parse(cleanJsonString(refinerResponse.text || "{}"));
              const refinedItems = refinedData.refinedItems || [];

              refinedItems.forEach((entry: any) => {
                if (typeof entry.index === 'number' && items[entry.index]) {
                  items[entry.index] = entry.item;
                }
              });
            } catch (error) {
              logger.error("Failed to parse refiner response:", error);
            }
          }
        } catch (error) {
          logger.error("Failed to parse judge response:", error);
        }

        return items;
      };


      // Apply retry logic with timeout protection
      return createTimeoutPromise(
        withRetry(generateBatch, 2, 500),
        60000,
        `Batch ${idx} generation timed out`
      );
    });

    // Execute all batches in parallel with error isolation
    const results = await Promise.allSettled(batchPromises);
    const rawItems: any[] = [];

    // Collect successful results and log failures
    results.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        rawItems.push(...result.value);
      } else {
        logger.error(`Batch ${idx} failed:`, result.reason);
      }
    });

    if (rawItems.length === 0) {
      throw new Error("All batch generations failed. Unable to create dataset.");
    }

    // Step 3: Map items to unique identifiers and format types
    const mapItem = createItemMapper(format);
    let idCounter = 1;
    const finalItems = rawItems.map((item: any) => {
      const id = `item-${Date.now()}-${idCounter++}`;
      return mapItem(item, id, "General Concepts");
    });

    res.json({
      summary: {
        topic,
        researchSummary,
        sources,
        subtopics,
        knowledgeGraph
      },
      items: finalItems
    });
  } catch (error: any) {
    logger.error("Synthesize breakdown:", error);
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

Your output must comply strictly with these criteria:
- **Reasoning First**: For every item, construct a detailed, step-by-step chain-of-thought in 'metadata.reasoning'.
- **Intent Encoding**: Assign a cognitive intent (e.g., 'Socratic', 'Adversarial', 'First-Principles').
- **Rationality & Contrast**: Mix in 'is_negative: true' items where the output contains a logical flaw, provided with a 'metadata.correction'.
- **Complexity Scaling**: Ensure a range of 'novice', 'intermediate', and 'expert' levels.
- Tone: ${tone}.
- Target Complexity: ${complexity}.
Ensure absolute precision. Keep the JSON perfect.`;

    const prompt = `Generate ${count} brand-new additional dataset items matching the JSON schema.`;

    const generateMore = async () => {
      const generation = await ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents: prompt,
        config: {
          systemInstruction,
          temperature: 0.8,
          responseMimeType: "application/json",
          responseSchema: getSchemaForFormat(format)
        }
      });

      const rawJsonText = cleanJsonString(generation.text || "{}");
      try {
        const parsed = JSON.parse(rawJsonText);
        return parsed.items || [];
      } catch (error) {
        logger.error("Failed to parse generate-more response:", error);
        return [];
      }
    };

    // Apply retry logic with timeout protection for generate-more
    const rawItems = await createTimeoutPromise(
      withRetry(generateMore, 2, 500),
      60000,
      "Additional items generation timed out"
    );

    // Use the same optimized mapper
    const mapItem = createItemMapper(format);
    let idCounter = 1;
    const finalItems = rawItems.map((item: any) => {
      const id = `item-synthetic-${Date.now()}-${idCounter++}`;
      return mapItem(item, id, "Extended Concepts");
    });

    res.json({ items: finalItems });
  } catch (error: any) {
    logger.error("Synthesize more breakdown:", error);
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
    logger.info(`Server running on http://0.0.0.0:${PORT}`);
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();