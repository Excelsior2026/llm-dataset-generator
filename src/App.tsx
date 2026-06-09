/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { DatasetGenerationConfig, DatasetItem, SearchResultSummary, APIResponse } from "./types";
import ConfigPanel from "./components/ConfigPanel";
import ResearchSources from "./components/ResearchSources";
import MetricsPanel from "./components/MetricsPanel";
import DatasetViewer from "./components/DatasetViewer";
import { Sparkles, Terminal, AlertTriangle, ArrowRight, Github, RefreshCw, Layers } from "lucide-react";

export default function App() {
  const [config, setConfig] = useState<DatasetGenerationConfig>({
    topic: "",
    size: 10,
    format: "alpaca",
    temperature: 0.7,
    systemPromptText: "You are a professional instructor. Generate detailed, structured instruction-following pairs.",
    tone: "explanatory",
    complexity: "intermediate"
  });

  const [researchSummary, setResearchSummary] = useState<SearchResultSummary | null>(null);
  const [items, setItems] = useState<DatasetItem[]>([]);
  
  // Loader States
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  // TRIGGER FIRST MAIN GENERATION
  const handleGenerateDataset = async () => {
    if (!config.topic.trim()) return;

    setIsLoading(true);
    setErrorCode(null);
    setLoadingStep("Step 1: Consulting search index for recent grounding facts...");

    try {
      // Small timeout interval simulated for dynamic loading progress
      const progressTimer = setTimeout(() => {
        setLoadingStep("Step 2: Dissecting subtopics and formatting schema filters...");
      }, 3500);

      const progressTimer2 = setTimeout(() => {
        setLoadingStep("Step 3: Compiling structured batches with parallelized Gemini synthesis...");
      }, 9000);

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config)
      });

      clearTimeout(progressTimer);
      clearTimeout(progressTimer2);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "A synthesis pipeline breakdown occurred.");
      }

      setResearchSummary(data.summary);
      setItems(data.items);
    } catch (err: any) {
      console.error(err);
      setErrorCode(err.message || "An unresolved error occurred down the pipeline.");
    } finally {
      setIsLoading(false);
      setLoadingStep("");
    }
  };

  // TRIGGER SYNTHETIC AGGREGATION TO EXPAND LOCAL DATAPOINTS
  const handleSynthesizeMore = async (count: number) => {
    if (!researchSummary) return;

    setIsLoadingMore(true);
    setErrorCode(null);

    // Extract already created prompts to send to model for redundancy checks
    const existingPrompts = items.map(itm => {
      if (itm.format === "alpaca" && itm.alpaca) return itm.alpaca.instruction;
      if (itm.format === "sharegpt" && itm.sharegpt) return itm.sharegpt.messages.map(m => m.content).join(" ");
      if (itm.format === "qa" && itm.qa) return itm.qa.question;
      return itm.raw?.title || "";
    });

    try {
      const response = await fetch("/api/generate-more", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: config.topic,
          researchSummary: researchSummary.researchSummary,
          format: config.format,
          count: count,
          tone: config.tone,
          complexity: config.complexity,
          existingPrompts: existingPrompts
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not generate additional synthetic instances.");
      }

      // Prepend additional records to list
      setItems(prevItems => [...data.items, ...prevItems]);
    } catch (err: any) {
      console.error(err);
      setErrorCode(err.message || "An unresolved breakdown occurred while expanding records.");
    } finally {
      setIsLoadingMore(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 selection:bg-indigo-100 selection:text-indigo-900 pb-12">
      
      {/* Upper Navigation Rail */}
      <HeaderBar errorCode={errorCode} />

      <main className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8 mt-6">
        
        {/* Error notification banner */}
        {errorCode && (
          <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-xl shadow-xs mb-6 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-bold text-amber-900">Synthesis Warning</h4>
              <p className="text-xs text-amber-700 mt-1 leading-relaxed">{errorCode}</p>
              {errorCode.includes("GEMINI_API_KEY") && (
                <p className="text-xs text-amber-700/80 mt-1.5 font-medium">
                  💡 Tips: You can attach your personal key under the <strong>Settings &gt; Secrets</strong> tab in the top-right option settings.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Master Two-Column Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* LEFT SIDEBAR COLUMN: 5/12 widths */}
          <div className="col-span-1 lg:col-span-5 space-y-6">
            <ConfigPanel
              config={config}
              onChangeConfig={setConfig}
              onSubmit={handleGenerateDataset}
              isLoading={isLoading}
              loadingStep={loadingStep}
            />

            {researchSummary && (
              <ResearchSources summary={researchSummary} />
            )}
          </div>

          {/* RIGHT VIEW column: 7/12 widths */}
          <div className="col-span-1 lg:col-span-7 space-y-6">
            {/* Visualizer and Token profiling metrics */}
            <MetricsPanel items={items} />

            {/* List and Actions Portal */}
            <DatasetViewer
              items={items}
              onUpdateItems={setItems}
              format={config.format}
              topic={config.topic || researchSummary?.topic || "Custom Corpus"}
              researchSummary={researchSummary?.researchSummary || ""}
              isLoadingMore={isLoadingMore}
              onSynthesizeMore={handleSynthesizeMore}
            />
          </div>

        </div>
      </main>
    </div>
  );
}

/**
 * Clean UI Header Card Sub-Component
 */
interface HeaderBarProps {
  errorCode: string | null;
}

function HeaderBar({ errorCode }: HeaderBarProps) {
  return (
    <header className="h-16 bg-white border-b border-slate-200 sticky top-0 z-40 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8 h-full flex items-center justify-between">
        
        {/* Brand identity */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shrink-0 shadow-sm shadow-indigo-600/10" id="brand-logo-frame">
            <div className="w-4 h-4 border-2 border-white rounded-xs" />
          </div>
          <div className="flex items-baseline gap-2">
            <h1 className="font-bold text-lg md:text-xl tracking-tight text-slate-800 leading-none" id="brand-title">
              TrainEngine<span className="text-indigo-600">.ai</span>
            </h1>
            <span className="text-[10px] md:text-xs text-slate-400 pl-2 border-l border-slate-200 font-medium hidden sm:inline-block" id="brand-subtitle">
              LLM Dataset Generator
            </span>
          </div>
        </div>

        {/* Environmental indicators and actions */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1 bg-slate-50 rounded-full border border-slate-200" id="badge-host-info">
            <div className={`w-2 h-2 rounded-full ${errorCode ? "bg-amber-500 animate-pulse" : "bg-emerald-500"}`} />
            <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">
              {errorCode ? "WARN" : "System Ready"}
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 text-slate-500 text-[10px] font-mono font-bold rounded-lg border border-slate-100" id="badge-port-info">
            <Terminal className="w-3.5 h-3.5 text-slate-400" />
            <span>PORT 3000</span>
          </div>

          <div className="w-8 h-8 rounded-full bg-linear-to-tr from-indigo-500 to-indigo-600 text-white font-bold text-xs flex items-center justify-center shadow-xs border border-white shrink-0">
            AI
          </div>
        </div>

      </div>
    </header>
  );
}
