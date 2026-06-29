/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from "react";
import { DatasetGenerationConfig, DatasetItem, SearchResultSummary, APIResponse } from "./types";
import ConfigPanel from "./components/ConfigPanel";
import ResearchSources from "./components/ResearchSources";
import MetricsPanel from "./components/MetricsPanel";
import DatasetViewer from "./components/DatasetViewer";
import { Sparkles, Terminal, AlertTriangle, ArrowRight, Github, RefreshCw, Layers, Save, FolderOpen, Trash2 } from "lucide-react";
import { saveItems, loadItems, saveSummary, loadSummary, saveConfig, loadConfig, saveNamedDataset, loadAllDatasets, deleteNamedDataset, clearCurrentSession, SavedDataset } from "./utils/persistence";
import { computeAllScores } from "./utils/index";

export default function App() {
  const defaultConfig: DatasetGenerationConfig = {
    topic: "",
    secondaryTopic: "",
    size: 10,
    format: "alpaca",
    temperature: 0.7,
    systemPromptText: "You are a professional instructor. Generate detailed, structured instruction-following pairs.",
    tone: "explanatory",
    complexity: "intermediate",
    redTeam: false,
  };

  const [config, setConfig] = useState<DatasetGenerationConfig>(() => loadConfig() || defaultConfig);
  const [researchSummary, setResearchSummary] = useState<SearchResultSummary | null>(() => loadSummary());
  const [items, setItems] = useState<DatasetItem[]>(() => loadItems());
  
  // Loader States
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  // Saved datasets management
  const [savedDatasets, setSavedDatasets] = useState<SavedDataset[]>(() => loadAllDatasets());
  const [showSavedPanel, setShowSavedPanel] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveDatasetName, setSaveDatasetName] = useState("");

  // Auto-persist items and summary on change
  useEffect(() => { saveItems(items); }, [items]);
  useEffect(() => { if (researchSummary) saveSummary(researchSummary); }, [researchSummary]);
  useEffect(() => { saveConfig(config); }, [config]);

  const handleUpdateItems = useCallback((newItems: DatasetItem[]) => {
    setItems(newItems);
  }, []);

  const handleSaveDataset = () => {
    const name = saveDatasetName.trim() || `Dataset ${new Date().toLocaleDateString()}`;
    saveNamedDataset(name, items, researchSummary, config.topic || researchSummary?.topic || "", config.format);
    setSavedDatasets(loadAllDatasets());
    setSaveDialogOpen(false);
    setSaveDatasetName("");
  };

  const handleLoadDataset = (dataset: SavedDataset) => {
    setItems(dataset.items);
    if (dataset.summary) setResearchSummary(dataset.summary);
    setShowSavedPanel(false);
  };

  const handleDeleteDataset = (name: string) => {
    deleteNamedDataset(name);
    setSavedDatasets(loadAllDatasets());
  };

  const handleClearSession = () => {
    clearCurrentSession();
    setItems([]);
    setResearchSummary(null);
    setConfig(defaultConfig);
  };

  // TRIGGER FIRST MAIN GENERATION
  const handleGenerateDataset = () => {
    if (!config.topic.trim()) return;

    setIsLoading(true);
    setErrorCode(null);
    setItems([]);
    setResearchSummary(null);
    setLoadingStep("Connecting to generation stream...");

    // Build query params for SSE endpoint
    const effectiveTopic = config.secondaryTopic
      ? `Intersection of "${config.topic}" and "${config.secondaryTopic}"`
      : config.topic;

    const params = new URLSearchParams({
      topic: effectiveTopic,
      size: String(config.size),
      format: config.format,
      temperature: String(config.temperature),
      tone: config.tone,
      complexity: config.complexity,
      redTeam: config.redTeam ? "true" : "false",
      primaryTopic: config.topic,
      secondaryTopic: config.secondaryTopic || "",
    });

    const eventSource = new EventSource(`/api/generate/stream?${params}`);

    let summary: SearchResultSummary | null = null;

    eventSource.addEventListener("status", (e) => {
      const data = JSON.parse(e.data);
      setLoadingStep(data.message);
    });

    eventSource.addEventListener("research_done", (e) => {
      const data = JSON.parse(e.data);
      summary = {
        topic: config.topic,
        researchSummary: data.researchSummary,
        sources: data.sources,
        subtopics: data.subtopics,
        knowledgeGraph: data.knowledgeGraph,
      };
    });

    eventSource.addEventListener("batch_done", (e) => {
      const data = JSON.parse(e.data);
      const scored = computeAllScores(data.items);
      setItems(prev => [...prev, ...scored]);
      setLoadingStep(`Received batch ${data.batchIndex + 1}/${data.totalBatches} (${data.batchSize} items)`);
    });

    eventSource.addEventListener("complete", (e) => {
      const data = JSON.parse(e.data);
      if (data.summary) {
        setResearchSummary(data.summary);
      } else if (summary) {
        setResearchSummary(summary);
      }
      setLoadingStep("Generation complete!");
      eventSource.close();
      setIsLoading(false);
      setTimeout(() => setLoadingStep(""), 1500);
    });

    eventSource.addEventListener("error", (e) => {
      const data = (e as MessageEvent).data ? JSON.parse((e as MessageEvent).data) : { error: "Connection error" };
      setErrorCode(data.error || "Stream connection error");
      eventSource.close();
      setIsLoading(false);
      setLoadingStep("");
    });

    eventSource.onerror = () => {
      if (eventSource.readyState === EventSource.CLOSED) {
        setErrorCode("Stream disconnected unexpectedly");
        setIsLoading(false);
        setLoadingStep("");
      }
    };
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
      setItems(prevItems => [...computeAllScores(data.items), ...prevItems]);
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

            {/* Saved Datasets Management Panel */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-xs p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                  Saved Datasets
                </h2>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setSaveDialogOpen(!saveDialogOpen)}
                    disabled={items.length === 0}
                    className="flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-indigo-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Save current dataset"
                  >
                    <Save className="w-3 h-3" />
                    Save
                  </button>
                  <button
                    onClick={() => setShowSavedPanel(!showSavedPanel)}
                    disabled={savedDatasets.length === 0}
                    className="flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-indigo-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Browse saved datasets"
                  >
                    <FolderOpen className="w-3 h-3" />
                    Browse ({savedDatasets.length})
                  </button>
                  {items.length > 0 && (
                    <button
                      onClick={handleClearSession}
                      className="flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-red-500 transition-colors"
                      title="Clear current session"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Save Dialog */}
              {saveDialogOpen && (
                <div className="bg-indigo-50/30 border border-indigo-100 rounded-lg p-3 space-y-2">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    Dataset Name
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="flex-1 text-xs bg-white border border-slate-200 rounded-md py-1.5 px-2.5 text-slate-800 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      placeholder="e.g. Physics Q&A v1"
                      value={saveDatasetName}
                      onChange={(e) => setSaveDatasetName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveDataset()}
                    />
                    <button
                      onClick={handleSaveDataset}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors"
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}

              {/* Saved Datasets List */}
              {showSavedPanel && savedDatasets.length > 0 && (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {savedDatasets.map((ds) => (
                    <div
                      key={ds.id}
                      className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg p-2.5 group hover:border-indigo-200 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-slate-700 truncate">{ds.name}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {ds.topic || "Untitled"} · {ds.itemCount} items · {ds.format}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 ml-2 shrink-0">
                        <button
                          onClick={() => handleLoadDataset(ds)}
                          className="px-2 py-1 text-[10px] font-bold text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                        >
                          Load
                        </button>
                        <button
                          onClick={() => handleDeleteDataset(ds.name)}
                          className="p-1 text-slate-300 hover:text-red-500 rounded transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {showSavedPanel && savedDatasets.length === 0 && (
                <p className="text-[10px] text-slate-400 text-center py-3">
                  No saved datasets. Generate some data and save it.
                </p>
              )}
            </div>
          </div>

          {/* RIGHT VIEW column: 7/12 widths */}
          <div className="col-span-1 lg:col-span-7 space-y-6">
            {/* Visualizer and Token profiling metrics */}
            <MetricsPanel items={items} />

            {/* List and Actions Portal */}
            <DatasetViewer
              items={items}
              onUpdateItems={handleUpdateItems}
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
