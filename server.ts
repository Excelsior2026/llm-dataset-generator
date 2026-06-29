/*
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express, { Request, Response, NextFunction } from "express";
import path from "path";
import dotenv from "dotenv";
import { withRetry, createTimeoutPromise, createItemMapper, getSchemaForFormat, logger } from "./src/utils/index";
import { createProvider } from "./src/providers/ProviderFactory";
import { ProviderConfig, DEFAULT_PROVIDER_CONFIG } from "./src/providers/types";
import { GeminiProvider } from "./src/providers/GeminiProvider";

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
  res.status(500).json({ error: "Internal server error during synthesis pipeline" });
});

function parseModelConfig(query: Record<string, any>): ProviderConfig {
  const raw = query.modelConfig;
  if (!raw) return DEFAULT_PROVIDER_CONFIG;
  try {
    const mc = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      research: { ...DEFAULT_PROVIDER_CONFIG.research, ...mc.research },
      generation: { ...DEFAULT_PROVIDER_CONFIG.generation, ...mc.generation },
      scoring: { ...DEFAULT_PROVIDER_CONFIG.scoring, ...mc.scoring },
    };
  } catch {
    return DEFAULT_PROVIDER_CONFIG;
  }
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

// SSE helper to send structured events
function sendSSEEvent(res: Response, event: string, data: any) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * SSE Streaming endpoint for real-time generation progress
 */
app.get("/api/generate/stream", async (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const { topic, size = "10", format = "alpaca", temperature = "0.7", tone = "explanatory", complexity = "intermediate", redTeam, primaryTopic, secondaryTopic } = req.query as Record<string, string>;

    if (!topic || topic.trim() === "") {
      sendSSEEvent(res, "error", { error: "Missing required field 'topic'" });
      res.end();
      return;
    }

    const isRedTeam = redTeam === "true";
    const isCrossDomain = secondaryTopic && secondaryTopic !== "";
    const temp = parseFloat(temperature) || 0.7;
    const modelConfig = parseModelConfig(req.query);

    const researchProvider = createProvider(modelConfig.research);
    const genProvider = createProvider(modelConfig.generation);

    const usesGeminiResearch = modelConfig.research.provider === "gemini" && process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "MY_GEMINI_API_KEY";

    if (usesGeminiResearch) {
      sendSSEEvent(res, "status", { message: "Step 1: Searching the web for recent grounding facts..." });
    } else {
      sendSSEEvent(res, "status", { message: `Step 1: Researching topic using ${modelConfig.research.provider} (${modelConfig.research.model})...` });
    }

    let researchSummary: string;
    let sources: { title: string; url: string }[] = [];
    let subtopics: string[] = [];
    let knowledgeGraph = { nodes: [] as any[], edges: [] as any[] };

    if (usesGeminiResearch) {
      const geminiProvider = researchProvider as GeminiProvider;
      const searchResult = await geminiProvider.generateWithSearch({
        prompt: `You are an elite research engine. Research the following topic exhaustively using Google Search: "${topic}".
Provide a detailed, authoritative research overview highlighting:
1. Fundamental concepts, major definitions, and underlying rules.
2. Scientific formula, code examples, or chronological timelines where applicable.
3. Solved problems, practical use cases, and contemporary debates/discoveries.

Additionally, output two structured sections at the end:
1. [SUBTOPICS]: A list of 6 to 8 subtopics separated by '|'.
2. [KNOWLEDGE_GRAPH]: A JSON object containing 'nodes' (id, label, level) and 'edges' (from, to).

Format the end of your response exactly like this:
[SUBTOPICS] Subtopic A | Subtopic B ... [END]
[KNOWLEDGE_GRAPH] { "nodes": [...], "edges": [...] } [END]`,
      });
      researchSummary = searchResult.text || "";
      sources = searchResult.sources;
    } else {
      researchSummary = await researchProvider.generate({
        prompt: `Research the following topic thoroughly and provide a detailed overview:\n\nTopic: "${topic}"\n\nCover the following aspects:\n1. Fundamental concepts, major definitions, and underlying rules.\n2. Practical use cases and applications.\n3. Key subtopics and related concepts.\n\nAt the end of your response, include:\n[SUBTOPICS] Subtopic A | Subtopic B | Subtopic C | Subtopic D | Subtopic E | Subtopic F [END]\n\nThen include a knowledge graph as JSON:\n[KNOWLEDGE_GRAPH] { "nodes": [{"id":"core","label":"Core Concepts","level":0}, {"id":"adv","label":"Advanced Topics","level":1}], "edges": [{"from":"core","to":"adv"}] } [END]`,
        systemPrompt: "You are a research assistant. Provide factual, well-structured information.",
        temperature: 0.4,
      });
    }

    const subtopicMatch = researchSummary.match(/\[SUBTOPICS\](.*?)(\[END\]|$)/s);
    if (subtopicMatch) {
      subtopics = subtopicMatch[1].split("|").map(s => s.trim()).filter(Boolean);
      researchSummary = researchSummary.replace(/\[SUBTOPICS\].*?(\[END\]|$)/s, "").trim();
    }

    const kgMatch = researchSummary.match(/\[KNOWLEDGE_GRAPH\](.*?)(\[END\]|$)/s);
    if (kgMatch) {
      try {
        const parsed = JSON.parse(kgMatch[1].trim());
        if (parsed.nodes && Array.isArray(parsed.nodes) && parsed.edges && Array.isArray(parsed.edges)) {
          knowledgeGraph = parsed;
        }
      } catch (e) {
        logger.warn("Failed to parse knowledge graph");
      }
      researchSummary = researchSummary.replace(/\[KNOWLEDGE_GRAPH\].*?(\[END\]|$)/s, "").trim();
    }

    if (subtopics.length === 0) {
      subtopics = [
        "Core Foundations", "Advanced Concepts", "Practical Demonstrations",
        "Historical Background & Milestones", "Contemporary Controversies & Future Work"
      ];
    }

    sendSSEEvent(res, "research_done", { researchSummary, sources, subtopics, knowledgeGraph });

    const targetSize = Math.max(1, Math.min(30, parseInt(size) || 10));
    const batchSize = 5;
    const numBatches = Math.ceil(targetSize / batchSize);
    sendSSEEvent(res, "status", { message: `Step 2: Generating ${targetSize} items in ${numBatches} batches...` });

    const allItems: any[] = [];

    for (let idx = 0; idx < numBatches; idx++) {
      const itemsInThisBatch = Math.min(batchSize, targetSize - idx * batchSize);
      const subtopicSubset = subtopics.slice(
        (idx * 2) % subtopics.length,
        ((idx * 2) + 3) % subtopics.length || subtopics.length
      );

      sendSSEEvent(res, "status", { message: `Generating batch ${idx + 1}/${numBatches} (${itemsInThisBatch} items)...` });

      const redTeamInstruction = isRedTeam ? `
CRITICAL: This is an ADVERSARIAL RED-TEAMING generation session. Generate items that:
- Include subtle logical errors, edge cases, and misleading premises
- Test model boundaries with ambiguous or underspecified inputs
- Contain adversarial prompts designed to evaluate model safety and robustness
- Mix clearly correct answers with intentionally flawed reasoning
- Each item's 'metadata.is_negative' should reflect whether it's a trap example
- For trap examples, 'metadata.correction' must explain the exact flaw
- Include jailbreak-adjacent prompts that test refusal boundaries
- Vary between obvious traps (easy to spot) and subtle ones (hard to detect)
` : '';

      const crossDomainInstruction = isCrossDomain ? `
CRITICAL: This is a CROSS-DOMAIN SYNTHESIS session. Generate items that:
- Bridge the conceptual gap between the two primary domains
- Each item MUST include a meaningful 'metadata.interdisciplinary_link' connecting both fields
- Explain the 'synthesis_bridge' — the conceptual logic that links the domains
- Show how concepts, methods, or principles from one domain apply to the other
- Include examples of real-world problems that sit at the intersection of both fields
- Vary items: some focused on Domain A → Domain B transfer, others on Domain B → Domain A
- Highlight analogous structures, shared patterns, and conceptual mappings
` : '';

      const systemInstruction = `You are an expert AI compiler. Generate ${itemsInThisBatch} training examples in '${format}' layout.
Ground in this research: ${researchSummary}
Tone: ${tone}. Complexity: ${complexity}. Subtopics: ${subtopicSubset.join(", ")}.
Output strict JSON matching the schema.${redTeamInstruction}${crossDomainInstruction}`;

      try {
        const genResult = await genProvider.generate({
          prompt: `Synthesize exactly ${itemsInThisBatch} training dataset items. Output valid JSON.`,
          systemPrompt: systemInstruction,
          temperature: temp,
          responseMimeType: "application/json",
          responseSchema: getSchemaForFormat(format),
        });

        let batchItems: any[] = [];
        try {
          const parsed = JSON.parse(cleanJsonString(genResult || "{}"));
          batchItems = parsed.items || [];
        } catch (e) {
          logger.error(`Batch ${idx} parse error`);
        }

        sendSSEEvent(res, "batch_done", { batchIndex: idx, totalBatches: numBatches, batchSize: batchItems.length, items: batchItems });
        allItems.push(...batchItems);
      } catch (e: any) {
        sendSSEEvent(res, "batch_error", { batchIndex: idx, error: e.message });
      }
    }

    const mapItem = createItemMapper(format);
    let idCounter = 1;
    const finalItems = allItems.map((item: any) => {
      const id = `item-${Date.now()}-${idCounter++}`;
      return mapItem(item, id, "General Concepts");
    });

    sendSSEEvent(res, "complete", {
      summary: { topic, researchSummary, sources, subtopics, knowledgeGraph },
      items: finalItems,
    });

    res.end();
  } catch (error: any) {
    logger.error("SSE Error:", error);
    sendSSEEvent(res, "error", { error: error.message || "Generation failed" });
    res.end();
  }
});

/**
 * Endpoint to query search grounding and build dataset
 */
app.post("/api/generate", async (req: Request, res: Response) => {
  try {
    const { topic, size = 10, format = "alpaca", temperature = 0.7, tone = "explanatory", complexity = "intermediate", redTeam } = req.body;

    if (!topic || topic.trim() === "") {
      res.status(400).json({ error: "Missing required field 'topic'" });
      return;
    }

    const isRedTeam = redTeam === true;
    const modelConfig = parseModelConfig(req.body);
    const researchProvider = createProvider(modelConfig.research);
    const genProvider = createProvider(modelConfig.generation);
    const scoringProvider = createProvider(modelConfig.scoring);

    const usesGeminiResearch = modelConfig.research.provider === "gemini" && process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "MY_GEMINI_API_KEY";

    // Step 1: Research the topic
    logger.info(`Researching topic: "${topic}"...`);
    let researchSummary: string;
    let sources: { title: string; url: string }[] = [];

    if (usesGeminiResearch) {
      const geminiProvider = researchProvider as GeminiProvider;
      const searchResult = await geminiProvider.generateWithSearch({
        prompt: `You are an elite research engine. Research the following topic exhaustively using Google Search: "${topic}".
Provide a detailed, authoritative research overview highlighting:
1. Fundamental concepts, major definitions, and underlying rules.
2. Scientific formula, code examples, or chronological timelines where applicable.
3. Solved problems, practical use cases, and contemporary debates/discoveries.

Additionally, output two structured sections at the end:
1. [SUBTOPICS]: A list of 6 to 8 subtopics separated by '|'.
2. [KNOWLEDGE_GRAPH]: A JSON object containing 'nodes' (id, label, level) and 'edges' (from, to), representing the pedagogical dependency of these subtopics.

Format the end of your response exactly like this:
[SUBTOPICS] Subtopic A | Subtopic B ... [END]
[KNOWLEDGE_GRAPH] { "nodes": [...], "edges": [...] } [END]`,
      });
      researchSummary = searchResult.text || "";
      sources = searchResult.sources;
    } else {
      researchSummary = await researchProvider.generate({
        prompt: `Research the following topic thoroughly and provide a detailed overview:\n\nTopic: "${topic}"\n\nCover:\n1. Fundamental concepts, major definitions, and underlying rules.\n2. Practical use cases and applications.\n3. Key subtopics and related concepts.\n\nAt the end, include:\n[SUBTOPICS] Subtopic A | Subtopic B | Subtopic C | Subtopic D | Subtopic E | Subtopic F [END]\n[KNOWLEDGE_GRAPH] { "nodes": [{"id":"core","label":"Core Concepts","level":0}, {"id":"adv","label":"Advanced Topics","level":1}], "edges": [{"from":"core","to":"adv"}] } [END]`,
        systemPrompt: "You are a research assistant. Provide factual, well-structured information.",
        temperature: 0.4,
      });
    }

    let subtopics: string[] = [];
    const subtopicMatch = researchSummary.match(/\[SUBTOPICS\](.*?)(\[END\]|$)/s);
    if (subtopicMatch) {
      subtopics = subtopicMatch[1].split("|").map(s => s.trim()).filter(Boolean);
      researchSummary = researchSummary.replace(/\[SUBTOPICS\].*?(\[END\]|$)/s, "").trim();
    }

    let knowledgeGraph = { nodes: [] as any[], edges: [] as any[] };
    const kgMatch = researchSummary.match(/\[KNOWLEDGE_GRAPH\](.*?)(\[END\]|$)/s);
    if (kgMatch) {
      try {
        const parsed = JSON.parse(kgMatch[1].trim());
        if (parsed.nodes && Array.isArray(parsed.nodes) && parsed.edges && Array.isArray(parsed.edges)) {
          knowledgeGraph = parsed;
        }
      } catch (e) {
        logger.warn("Failed to parse knowledge graph from AI response");
      }
      researchSummary = researchSummary.replace(/\[KNOWLEDGE_GRAPH\].*?(\[END\]|$)/s, "").trim();
    }

    if (subtopics.length === 0) {
      subtopics = [
        "Core Foundations", "Advanced Concepts", "Practical Demonstrations",
        "Historical Background & Milestones", "Contemporary Controversies & Future Work"
      ];
    }

    logger.info(`Discovered Subtopics: ${subtopics}`);

    // Step 2: Batch Generation with judge/refinement pipeline
    const targetSize = Math.max(1, Math.min(30, size));
    const batchSize = 5;
    const numBatches = Math.ceil(targetSize / batchSize);

    logger.info(`Synthesizing dataset of ${targetSize} items in ${numBatches} parallel batches...`);

    const batchPromises = Array.from({ length: numBatches }).map(async (_, idx) => {
      const itemsInThisBatch = Math.min(batchSize, targetSize - idx * batchSize);
      const subtopicSubset = subtopics.slice(
        (idx * 2) % subtopics.length,
        ((idx * 2) + 3) % subtopics.length || subtopics.length
      );

      const redTeamInstruction = isRedTeam ? `
CRITICAL: This is an ADVERSARIAL RED-TEAMING session. Generate items that:
- Include subtle logical errors, edge cases, and misleading premises
- Test model boundaries with ambiguous or underspecified inputs
- Contain adversarial prompts that evaluate model safety and robustness
- Mix correct answers with intentionally flawed reasoning
- For trap examples (is_negative: true), 'metadata.correction' must explain the exact flaw
- Include jailbreak-adjacent prompts that test refusal boundaries
- Vary between obvious traps and subtle ones hard to detect
` : '';

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
- Output MUST be strict JSON matching the requested schema. Do not insert any Markdown wrappers or explanatory text outside the JSON.${redTeamInstruction}`;

      const prompt = `Synthesize exactly ${itemsInThisBatch} training dataset items. Refuse placeholder or truncated values. Output absolutely valid JSON.`;

      const generateBatch = async () => {
        // Single-model generation (multi-model consensus skipped for local providers)
        logger.info(`Generating batch ${idx} with ${modelConfig.generation.provider} (${modelConfig.generation.model})...`);

        const genResult = await genProvider.generate({
          prompt,
          systemPrompt: systemInstruction,
          temperature,
          responseMimeType: "application/json",
          responseSchema: getSchemaForFormat(format),
        });

        let items: any[] = [];
        try {
          const parsed = JSON.parse(cleanJsonString(genResult || "{}"));
          items = parsed.items || [];
        } catch (error) {
          logger.error(`Failed to parse JSON from generation:`, error);
          return [];
        }

        if (items.length === 0) return [];

        // Judge Phase: Audit the generated items
        logger.info(`Auditing batch of ${items.length} items...`);
        const judgePrompt = `You are a world-class logic auditor. Review these ${items.length} training items.
For each item, identify:
1. Logical gaps in the 'metadata.reasoning' path.
2. Factual inaccuracies.
3. Misalignment between reasoning and the final output.
4. Subtle logical traps that were not correctly handled.

Output a JSON array of critiques, where each object matches the index of the item:
{ "critiques": [ { "index": 0, "isValid": boolean, "critique": "detailed feedback" }, ... ] }`;

        try {
          const judgeResult = await scoringProvider.generate({
            prompt: `${judgePrompt}\n\nItems to audit:\n${JSON.stringify(items)}`,
            temperature: 0.2,
            responseMimeType: "application/json",
          });

          const judgeData = JSON.parse(cleanJsonString(judgeResult || "{}"));
          const critiques = judgeData.critiques || [];

          // Refinement Phase: Fix items that failed the audit
          const failedIndices = critiques.filter((c: any) => !c.isValid).map((c: any) => c.index);
          if (failedIndices.length > 0) {
            logger.info(`Refining ${failedIndices.length} items based on critic feedback...`);

            const refinerPrompt = `You are an expert AI refiner. I will provide you with a set of training items and their corresponding critiques.
Rewrite the items to ensure absolute logical precision and high-fidelity reasoning.
Preserve the original intent and format. Ensure the 'metadata.reasoning' is now flawless.

You MUST output a JSON object containing a 'refinedItems' array, where each object includes the 'index' of the original item it is replacing.
Format: { "refinedItems": [ { "index": 0, "item": { ...original schema... } }, ... ] }

Input:
${critiques.filter((c: any) => !c.isValid).map((c: any) => `Item Index ${c.index}: ${JSON.stringify(items[c.index])}\nCritique: ${c.critique}`).join("\n\n")}`;

              const refinerResult = await genProvider.generate({
                prompt: refinerPrompt,
                temperature: 0.4,
                responseMimeType: "application/json",
              });

              try {
                const refinedData = JSON.parse(cleanJsonString(refinerResult || "{}"));
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
          logger.error("Failed to run judge/refinement:", error);
        }

        return items;
      };

      return createTimeoutPromise(
        withRetry(generateBatch, 2, 500),
        60000,
        `Batch ${idx} generation timed out`
      );
    });

    const results = await Promise.allSettled(batchPromises);
    const rawItems: any[] = [];

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

    const mapItem = createItemMapper(format);
    let idCounter = 1;
    const finalItems = rawItems.map((item: any) => {
      const id = `item-${Date.now()}-${idCounter++}`;
      return mapItem(item, id, "General Concepts");
    });

    res.json({
      summary: { topic, researchSummary, sources, subtopics, knowledgeGraph },
      items: finalItems,
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

    const modelConfig = parseModelConfig(req.body);
    const genProvider = createProvider(modelConfig.generation);

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
      const genResult = await genProvider.generate({
        prompt,
        systemPrompt: systemInstruction,
        temperature: 0.8,
        responseMimeType: "application/json",
        responseSchema: getSchemaForFormat(format),
      });

      const rawJsonText = cleanJsonString(genResult || "{}");
      try {
        const parsed = JSON.parse(rawJsonText);
        return parsed.items || [];
      } catch (error) {
        logger.error("Failed to parse generate-more response:", error);
        return [];
      }
    };

    const rawItems = await createTimeoutPromise(
      withRetry(generateMore, 2, 500),
      60000,
      "Additional items generation timed out"
    );

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

/**
 * Endpoint to upload dataset to Hugging Face Hub
 */
app.post("/api/upload-huggingface", async (req: Request, res: Response) => {
  try {
    const { items, token, repoName, format, topic } = req.body;

    if (!token || !repoName) {
      res.status(400).json({ error: "Missing required fields: token, repoName" });
      return;
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "No dataset items provided" });
      return;
    }

    const hfHeaders: Record<string, string> = {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    // Step 1: Create the dataset repo if it doesn't exist
    logger.info(`Creating/verifying Hugging Face dataset repo: ${repoName}`);
    const createRes = await fetch("https://huggingface.co/api/repos/create", {
      method: "POST",
      headers: hfHeaders,
      body: JSON.stringify({
        name: repoName,
        type: "dataset",
        organization: null,
        private: false,
      }),
    });

    if (!createRes.ok && createRes.status !== 409) {
      // 409 means already exists, which is fine
      const errorBody = await createRes.text();
      logger.error(`Failed to create HF repo: ${errorBody}`);
      // Continue anyway, it might already exist
    }

    // Step 2: Prepare dataset files
    const sanitizedName = repoName.replace(/[^a-zA-Z0-9_-]/g, "_");
    const fileContent = (() => {
      switch (format) {
        case "alpaca":
          return items.map((itm: any) => JSON.stringify(itm.alpaca)).join("\n");
        case "sharegpt":
          return items.map((itm: any) => JSON.stringify(itm.sharegpt)).join("\n");
        case "qa":
          return items.map((itm: any) => JSON.stringify(itm.qa)).join("\n");
        default:
          return items.map((itm: any) => JSON.stringify(itm.raw)).join("\n");
      }
    })();

    // Step 3: Upload the JSONL file via HF Hub API
    logger.info(`Uploading dataset to ${repoName}...`);
    const uploadUrl = `https://huggingface.co/api/datasets/${repoName}/upload`;
    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: hfHeaders,
      body: JSON.stringify({
        path: `data/${sanitizedName}_${format}.jsonl`,
        content: fileContent,
        operations: "overwrite",
      }),
    });

    if (!uploadRes.ok) {
      const errorBody = await uploadRes.text();
      logger.error(`HF upload failed: ${errorBody}`);

      // Fallback: try direct file upload via raw endpoint
      const fallbackUrl = `https://huggingface.co/datasets/${repoName}/raw/main/data/${sanitizedName}_${format}.jsonl`;
      const fallbackRes = await fetch(fallbackUrl, {
        method: "PUT",
        headers: {
          ...hfHeaders,
          "Content-Type": "text/plain",
        },
        body: fileContent,
      });

      if (!fallbackRes.ok) {
        throw new Error(`Upload failed with status ${fallbackRes.status}`);
      }
    }

    // Step 4: Create a README.md with dataset metadata
    const readmeContent = `---
dataset_info:
  description: "Synthetic LLM training dataset generated by TrainEngine.ai"
  license: apache-2.0
  features:
    - name: ${format}
      dtype: string
  splits:
    - name: train
      num_examples: ${items.length}
  languages:
    - en
configs:
  - config_name: default
    data_files:
      - split: train
        path: data/${sanitizedName}_${format}.jsonl
---

# ${repoName}

Synthetic LLM training dataset generated by **TrainEngine.ai**.

- **Topic:** ${topic || "General"}
- **Format:** ${format}
- **Size:** ${items.length} examples
- **Generated:** ${new Date().toISOString()}
`;

    const readmeRes = await fetch(uploadUrl, {
      method: "POST",
      headers: hfHeaders,
      body: JSON.stringify({
        path: "README.md",
        content: readmeContent,
        operations: "overwrite",
      }),
    });

    if (!readmeRes.ok) {
      logger.warn("Failed to upload README.md, dataset file was uploaded");
    }

    logger.info(`Dataset uploaded successfully to https://huggingface.co/datasets/${repoName}`);
    res.json({
      success: true,
      url: `https://huggingface.co/datasets/${repoName}`,
      fileCount: 1,
      itemCount: items.length,
    });
  } catch (error: any) {
    logger.error("HF upload failed:", error);
    res.status(500).json({ error: error.message || "Failed to upload to Hugging Face" });
  }
});

/**
 * Self-Play Improvement: iteratively judge items, refine flawed ones, repeat
 */
app.post("/api/self-play", async (req: Request, res: Response) => {
  try {
    let { items, cycles = 2, modelConfig } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "No items provided" });
      return;
    }

    const config = parseModelConfig({ modelConfig });
    const scoringProvider = createProvider(config.scoring);
    const genProvider = createProvider(config.generation);
    const format = items[0]?.format || "alpaca";

    const improvedItems = [...items];

    for (let cycle = 0; cycle < Math.min(cycles, 5); cycle++) {
      const judgePrompt = `You are a world-class logic auditor. Review these training items.
For each item, identify logical gaps, factual inaccuracies, and misalignment between reasoning and output.
Output: { "critiques": [ { "index": number, "isValid": boolean, "critique": "feedback" } ] }`;

      let critiques: { index: number; isValid: boolean; critique: string }[] = [];

      try {
        const judgeResult = await scoringProvider.generate({
          prompt: `${judgePrompt}\n\nItems:\n${JSON.stringify(improvedItems)}`,
          temperature: 0.2,
          responseMimeType: "application/json",
        });
        const judgeData = JSON.parse(cleanJsonString(judgeResult || "{}"));
        critiques = judgeData.critiques || [];
      } catch {
        break;
      }

      const failedIndices = critiques.filter(c => !c.isValid).map(c => c.index);
      if (failedIndices.length === 0) break;

      const failedItems = failedIndices.map(i => ({ index: i, item: improvedItems[i], critique: critiques.find(c => c.index === i)?.critique }));

      const refinerResult = await genProvider.generate({
        prompt: `Rewrite these training items to fix the identified flaws. Preserve original format and intent.
Output: { "refinedItems": [ { "index": number, "item": { ... } } ] }
Input:\n${JSON.stringify(failedItems)}`,
        temperature: 0.3,
        responseMimeType: "application/json",
      });

      try {
        const refined = JSON.parse(cleanJsonString(refinerResult || "{}"));
        (refined.refinedItems || []).forEach((entry: any) => {
          if (typeof entry.index === "number" && improvedItems[entry.index]) {
            improvedItems[entry.index] = entry.item;
          }
        });
      } catch {}
    }

    res.json({ items: improvedItems });
  } catch (error: any) {
    logger.error("Self-play error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Export DPO preference pairs: creates chosen/rejected pairs from items
 */
app.post("/api/export-dpo", async (req: Request, res: Response) => {
  try {
    const { items, modelConfig } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "No items provided" });
      return;
    }

    const config = parseModelConfig({ modelConfig });
    const genProvider = createProvider(config.generation);

    const pairs: { instruction: string; chosen: string; rejected: string; metadata: any }[] = [];

    for (const item of items) {
      const instruction = item.alpaca?.instruction || item.qa?.question || item.sharegpt?.messages?.map((m: any) => m.content).join("\n") || item.raw?.title || "";

      if (item.metadata?.is_negative) {
        // Already a negative example: use correction as chosen
        pairs.push({
          instruction,
          chosen: item.metadata.correction || item.alpaca?.output || item.qa?.answer || "",
          rejected: item.alpaca?.output || item.qa?.answer || item.raw?.text || "",
          metadata: { source: "is_negative", original_id: item.id, topic: item.topic },
        });
      } else {
        // Generate a deliberately flawed version for the rejected side
        const correctAnswer = item.alpaca?.output || item.qa?.answer || "";
        if (!correctAnswer) continue;

        try {
          const flawed = await genProvider.generate({
            prompt: `Given this instruction and correct answer, produce a realistic but subtly wrong answer that contains a logical error or hallucination.
Instruction: ${instruction}
Correct: ${correctAnswer}
Output just the flawed answer, no explanation.`,
            temperature: 0.8,
          });

          pairs.push({
            instruction,
            chosen: correctAnswer,
            rejected: flawed || correctAnswer,
            metadata: { source: "generated_flawed", original_id: item.id, topic: item.topic },
          });
        } catch {
          pairs.push({
            instruction,
            chosen: correctAnswer,
            rejected: correctAnswer,
            metadata: { source: "fallback", original_id: item.id, topic: item.topic },
          });
        }
      }
    }

    res.json({ pairs, count: pairs.length });
  } catch (error: any) {
    logger.error("DPO export error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Evolve Instructions (WizardLM-style): generate harder variants of existing items
 */
app.post("/api/evolve", async (req: Request, res: Response) => {
  try {
    const { items, count = 2, modelConfig } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "No items provided" });
      return;
    }

    const config = parseModelConfig({ modelConfig });
    const genProvider = createProvider(config.generation);

    const evolutionModes = [
      "Add a specific constraint (e.g., 'answer in exactly 3 sentences', 'use only first-principles reasoning')",
      "Increase complexity to expert level with multi-step reasoning",
      "Cross-domain: connect the topic to an unrelated second domain",
      "Add an adversarial twist: introduce a subtle false premise the model must catch",
      "Require the model to identify and resolve an intentional ambiguity",
    ];

    const evolvedItems: any[] = [];

    for (let i = 0; i < Math.min(count, 10); i++) {
      const baseItem = items[i % items.length];
      const instruction = baseItem.alpaca?.instruction || baseItem.qa?.question || "";
      const evolutionMode = evolutionModes[i % evolutionModes.length];

      try {
        const result = await genProvider.generate({
          prompt: `You are WizardLM's evolution engine. Take this instruction and evolve it to be HARDER and more COMPLEX.
Original: "${instruction}"
Evolution mode: ${evolutionMode}

Generate exactly 1 evolved instruction that maintains the original intent but is significantly harder.
Output JSON: { "evolved_instruction": "...", "evolution_mode": "...", "complexity": "expert", "reasoning_depth": "multi-step" }`,
          temperature: 0.7,
          responseMimeType: "application/json",
        });

        const parsed = JSON.parse(cleanJsonString(result || "{}"));
        if (parsed.evolved_instruction) {
          evolvedItems.push({
            id: `evolved-${Date.now()}-${i}`,
            format: baseItem.format,
            topic: baseItem.topic,
            alpaca: baseItem.alpaca ? {
              instruction: parsed.evolved_instruction,
              input: baseItem.alpaca.input,
              output: "",
            } : undefined,
            qa: baseItem.qa ? {
              question: parsed.evolved_instruction,
              answer: "",
            } : undefined,
            metadata: {
              reasoning: "",
              intent: "evolved",
              complexity: "advanced",
              is_negative: false,
              evolution_mode: parsed.evolution_mode || evolutionMode,
            },
          });
        }
      } catch {}
    }

    res.json({ items: evolvedItems, count: evolvedItems.length });
  } catch (error: any) {
    logger.error("Evolve error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Generate Multi-Turn Conversation Trees
 */
app.post("/api/generate-tree", async (req: Request, res: Response) => {
  try {
    const { topic, depth = 3, branches = 2, modelConfig } = req.body;
    if (!topic || topic.trim() === "") {
      res.status(400).json({ error: "Missing topic" });
      return;
    }

    const config = parseModelConfig({ modelConfig });
    const genProvider = createProvider(config.generation);

    interface TreeNode {
      turn: number;
      role: "user" | "assistant";
      content: string;
      branches: TreeNode[];
    }

    async function buildBranch(topic: string, currentDepth: number, maxDepth: number, maxBranches: number, history: { role: string; content: string }[]): Promise<TreeNode> {
      const role = currentDepth % 2 === 0 ? "user" : "assistant";
      const historyStr = history.map(h => `${h.role}: ${h.content}`).join("\n");

      const result = await genProvider.generate({
        prompt: `Continue this conversation about "${topic}":
${historyStr}

Generate the next ${role} turn. Be natural and educational.
Output JSON: { "content": "..." }`,
        temperature: 0.7,
        responseMimeType: "application/json",
      });

      let content = "";
      try {
        const parsed = JSON.parse(cleanJsonString(result || "{}"));
        content = parsed.content || "";
      } catch {
        content = `Let me explain more about ${topic}...`;
      }

      const newNode: TreeNode = {
        turn: currentDepth,
        role: role as "user" | "assistant",
        content,
        branches: [],
      };

      if (currentDepth < maxDepth) {
        const newHistory = [...history, { role, content }];
        const numBranches = role === "user" ? 1 : maxBranches;

        for (let b = 0; b < numBranches; b++) {
          const child = await buildBranch(topic, currentDepth + 1, maxDepth, maxBranches, newHistory);
          newNode.branches.push(child);
        }
      }

      return newNode;
    }

    const root: TreeNode = {
      turn: 0,
      role: "user",
      content: `Tell me about ${topic}`,
      branches: [],
    };

    const firstHistory = [{ role: "user", content: root.content }];

    for (let b = 0; b < branches; b++) {
      const child = await buildBranch(topic, 1, depth, branches, firstHistory);
      root.branches.push(child);
    }

    function flattenTree(node: TreeNode, level: number = 0): any[] {
      const turns: any[] = [];
      turns.push({ turn: node.turn, role: node.role, content: node.content, level });
      for (const child of node.branches) {
        turns.push(...flattenTree(child, level + 1));
      }
      return turns;
    }

    res.json({
      tree: root,
      turns: flattenTree(root),
      totalTurns: flattenTree(root).length,
    });
  } catch (error: any) {
    logger.error("Tree generation error:", error);
    res.status(500).json({ error: error.message });
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