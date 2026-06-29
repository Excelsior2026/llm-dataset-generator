/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { DatasetGenerationConfig, DatasetFormat, ProviderType, ModelFunctionConfig } from "../types";
import { Settings, Sliders, Play, RotateCcw, HelpCircle, FileJson, MessageSquare, HelpCircleIcon, Layers, ChevronRight, Cpu } from "lucide-react";

interface ConfigPanelProps {
  config: DatasetGenerationConfig;
  onChangeConfig: (newConfig: DatasetGenerationConfig) => void;
  onSubmit: () => void;
  isLoading: boolean;
  loadingStep: string;
}

export default function ConfigPanel({ config, onChangeConfig, onSubmit, isLoading, loadingStep }: ConfigPanelProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showModelConfig, setShowModelConfig] = useState(false);

  const mc = config.modelConfig || {
    research: { provider: "ollama" as ProviderType, model: "llama3.2:3b", baseUrl: "http://localhost:11434" },
    generation: { provider: "ollama" as ProviderType, model: "qwen2.5:7b", baseUrl: "http://localhost:11434" },
    scoring: { provider: "ollama" as ProviderType, model: "llama3.2:3b", baseUrl: "http://localhost:11434" },
  };

  const updateModelFunc = (func: "research" | "generation" | "scoring", partial: Partial<ModelFunctionConfig>) => {
    onChangeConfig({
      ...config,
      modelConfig: { ...mc, [func]: { ...mc[func], ...partial } },
    });
  };

  // Suggested high-quality training topics to inspire users
  const suggestions = [
    "Quantum Computation and Shor's Algorithm",
    "History of the Ottoman Empire (1299–1922)",
    "Rust Memory Safety and Rule of Three",
    "Photosynthesis Light-Dependent Reactions",
    "Akaike Information Criterion (AIC) derivation",
    "Roman Architecture & Aqueduct Engineering"
  ];

  const setTopic = (topic: string) => {
    onChangeConfig({ ...config, topic });
  };

  const handleFormatChange = (format: DatasetFormat) => {
    // Autofill an appropriate system prompt configuration based on format choice
    let systemPromptText = config.systemPromptText;
    if (format === "alpaca") {
      systemPromptText = "You are a professional instructor. Generate detailed, structured instruction-following pairs.";
    } else if (format === "sharegpt") {
      systemPromptText = "You are simulating natural human chat interactions. Compile conversational multi-turn logs.";
    } else if (format === "qa") {
      systemPromptText = "You are an expert tutor. Provide accurate, clear question and answer pairs.";
    } else if (format === "raw") {
      systemPromptText = "You are textbook editor. Compose encyclopedic, highly educational raw literature passages.";
    }
    onChangeConfig({ ...config, format, systemPromptText });
  };

  return (
    <div id="config-panel" className="bg-white border border-slate-200 rounded-xl shadow-xs p-5 space-y-5">
      <div className="border-b border-slate-100 pb-3">
        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest" id="header-config">
          Topic Extraction & Sourcing
        </h2>
        <p className="text-[11px] text-slate-500 mt-1">Configure search grounding constraints</p>
      </div>

      <div className="space-y-4">
        {/* Sourcing Topic Name */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="input-topic">
            Research Topic
          </label>
          <div className="relative">
            <input
              id="input-topic"
              type="text"
              className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-600 outline-none font-medium text-slate-850 placeholder:text-slate-400 transition-all"
              placeholder="e.g., Photosynthesis mechanics, ancient history, coding standards..."
              value={config.topic}
              onChange={(e) => onChangeConfig({ ...config, topic: e.target.value })}
              disabled={isLoading}
            />
          </div>

          {/* Preset Suggestions */}
          <div className="mt-2.5" id="preset-suggestions">
            <p className="text-[10px] text-slate-400 mb-1.5 font-bold uppercase tracking-wider">✨ Recommended Sources:</p>
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
              {suggestions.map((suggestion, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setTopic(suggestion)}
                  disabled={isLoading}
                  className="text-[10px] text-slate-600 bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-md px-2 py-1 font-medium transition-all text-left truncate max-w-full hover:bg-slate-100 active:scale-95 disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Cross-Domain Secondary Topic (Optional) */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5" htmlFor="input-secondary-topic">
            Cross-Domain Synthesis <span className="text-[10px] text-slate-400 font-normal">(Optional)</span>
          </label>
          <div className="relative">
            <input
              id="input-secondary-topic"
              type="text"
              className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-600 outline-none font-medium text-slate-850 placeholder:text-slate-400 transition-all"
              placeholder="e.g., Economics, Biology, Music Theory..."
              value={config.secondaryTopic || ""}
              onChange={(e) => onChangeConfig({ ...config, secondaryTopic: e.target.value })}
              disabled={isLoading}
            />
          </div>
          {config.secondaryTopic && (
            <p className="text-[10px] text-indigo-600 font-medium mt-1">
              Dataset will explore the intersection of &ldquo;{config.topic}&rdquo; and &ldquo;{config.secondaryTopic}&rdquo;
            </p>
          )}
        </div>

        {/* Dataset Formats Select */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5" id="lbl-format">
            Training Output Structure
          </label>
          <div className="grid grid-cols-2 gap-2" id="format-grid">
            <button
              type="button"
              id="format-alpaca"
              onClick={() => handleFormatChange("alpaca")}
              disabled={isLoading}
              className={`flex items-center gap-2 p-2.5 text-left border rounded-lg transition-all ${
                config.format === "alpaca"
                  ? "bg-indigo-50/50 border-indigo-600 text-indigo-900 ring-2 ring-indigo-500/10"
                  : "border-slate-200 text-slate-600 hover:border-slate-300 bg-slate-50/40"
              }`}
            >
              <FileJson className="w-4 h-4 shrink-0 text-indigo-500" />
              <div>
                <p className="text-xs font-bold">Alpaca Format</p>
                <p className="text-[9px] text-slate-400">Prompt / Input / Output</p>
              </div>
            </button>

            <button
              type="button"
              id="format-sharegpt"
              onClick={() => handleFormatChange("sharegpt")}
              disabled={isLoading}
              className={`flex items-center gap-2 p-2.5 text-left border rounded-lg transition-all ${
                config.format === "sharegpt"
                  ? "bg-indigo-50/50 border-indigo-600 text-indigo-900 ring-2 ring-indigo-500/10"
                  : "border-slate-200 text-slate-600 hover:border-slate-300 bg-slate-50/40"
              }`}
            >
              <MessageSquare className="w-4 h-4 shrink-0 text-emerald-500" />
              <div>
                <p className="text-xs font-bold">ShareGPT Chat</p>
                <p className="text-[9px] text-slate-400">System / User / Assistant</p>
              </div>
            </button>

            <button
              type="button"
              id="format-qa"
              onClick={() => handleFormatChange("qa")}
              disabled={isLoading}
              className={`flex items-center gap-2 p-2.5 text-left border rounded-lg transition-all ${
                config.format === "qa"
                  ? "bg-indigo-50/50 border-indigo-600 text-indigo-900 ring-2 ring-indigo-500/10"
                  : "border-slate-200 text-slate-600 hover:border-slate-300 bg-slate-50/40"
              }`}
            >
              <HelpCircle className="w-4 h-4 shrink-0 text-amber-500" />
              <div>
                <p className="text-xs font-bold">General Q&A</p>
                <p className="text-[9px] text-slate-400">Standalone Q / A Pairs</p>
              </div>
            </button>

            <button
              type="button"
              id="format-raw"
              onClick={() => handleFormatChange("raw")}
              disabled={isLoading}
              className={`flex items-center gap-2 p-2.5 text-left border rounded-lg transition-all ${
                config.format === "raw"
                  ? "bg-indigo-50/50 border-indigo-600 text-indigo-900 ring-2 ring-indigo-500/10"
                  : "border-slate-200 text-slate-600 hover:border-slate-300 bg-slate-50/40"
              }`}
            >
              <Layers className="w-4 h-4 shrink-0 text-slate-500" />
              <div>
                <p className="text-xs font-bold">Pretraining Raw</p>
                <p className="text-[9px] text-slate-400">Educational Prose Textbook</p>
              </div>
            </button>
          </div>
        </div>

        {/* Sliders for Size & Temperature */}
        <div className="grid grid-cols-2 gap-3" id="sliders-grid">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="select-size">
              Dataset Size (Items)
            </label>
            <select
              id="select-size"
              value={config.size}
              onChange={(e) => onChangeConfig({ ...config, size: Number(e.target.value) })}
              disabled={isLoading}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 font-medium focus:ring-2 focus:ring-indigo-600 outline-none"
            >
              <option value="5">5 Examples</option>
              <option value="10">10 Examples (Balanced)</option>
              <option value="15">15 Examples</option>
              <option value="20">20 Examples (Comprehensive)</option>
              <option value="30">30 Examples (Exhaustive)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Temperature ({config.temperature})
            </label>
            <input
              type="range"
              min="0.2"
              max="1.0"
              step="0.1"
              value={config.temperature}
              onChange={(e) => onChangeConfig({ ...config, temperature: Number(e.target.value) })}
              disabled={isLoading}
              className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600 mt-3.5 disabled:opacity-50"
            />
          </div>
        </div>

        {/* Split Parameters */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="select-complexity">
              Complexity Level
            </label>
            <select
              id="select-complexity"
              value={config.complexity}
              onChange={(e) => onChangeConfig({ ...config, complexity: e.target.value as any })}
              disabled={isLoading}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 font-medium focus:ring-2 focus:ring-indigo-600 outline-none"
            >
              <option value="basic">Basic / Direct Retrieval</option>
              <option value="intermediate">Intermediate / Reasoning</option>
              <option value="advanced">Advanced / Reasoning & Math</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="select-tone">
              Response Tone Profile
            </label>
            <select
              id="select-tone"
              value={config.tone}
              onChange={(e) => onChangeConfig({ ...config, tone: e.target.value as any })}
              disabled={isLoading}
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg py-2 px-3 font-medium focus:ring-2 focus:ring-indigo-600 outline-none"
            >
              <option value="explanatory">Explanatory / Instructive</option>
              <option value="technical">Highly Technical / Code-rich</option>
              <option value="academic">Academic / Formal Citations</option>
              <option value="casual">Conversational / Assistant-like</option>
              <option value="socratic">Socratic Tutor / Prompting</option>
            </select>
          </div>
        </div>

        {/* Red-Teaming Mode Toggle */}
        <div className="border-t border-slate-100 pt-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-500">Adversarial Red-Teaming</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Generate adversarial edge cases and safety evaluation examples</p>
            </div>
            <button
              onClick={() => onChangeConfig({ ...config, redTeam: !config.redTeam })}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                config.redTeam ? "bg-red-500" : "bg-slate-200"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-xs transition-transform ${
                  config.redTeam ? "translate-x-5" : ""
                }`}
              />
            </button>
          </div>
        </div>

        {/* Collapsible Advanced Options */}
        <div className="border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-slate-700 transition-colors uppercase tracking-widest"
            id="toggle-advanced-cfg"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Customize Core Instruction</span>
          </button>
          
          {showAdvanced && (
            <div className="mt-2.5 space-y-2 animate-fade" id="advanced-config-inputs">
              <label className="block text-[11px] text-slate-400 font-medium leading-relaxed" htmlFor="text-system-prompt">
                Provide custom guidelines for the model synthesis output structure.
              </label>
              <textarea
                id="text-system-prompt"
                rows={3}
                disabled={isLoading}
                className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-600 outline-none text-slate-700 transition"
                value={config.systemPromptText}
                onChange={(e) => onChangeConfig({ ...config, systemPromptText: e.target.value })}
                placeholder="Customize details (e.g. Include custom markdown tables, restrict sentences...)"
              />
            </div>
          )}
        </div>

        {/* Model Configuration */}
        <div className="border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={() => setShowModelConfig(!showModelConfig)}
            className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-slate-700 transition-colors uppercase tracking-widest"
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>Model Configuration</span>
          </button>

          {showModelConfig && (
            <div className="mt-2.5 space-y-3 animate-fade">
              {(["research", "generation", "scoring"] as const).map((func) => (
                <div key={func} className="bg-slate-50 rounded-lg p-3 border border-slate-200 space-y-2">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider capitalize">{func}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-400 font-medium">Provider</label>
                      <select
                        value={mc[func].provider}
                        onChange={(e) => updateModelFunc(func, { provider: e.target.value as ProviderType })}
                        className="w-full text-xs bg-white border border-slate-200 rounded-lg py-1.5 px-2 focus:ring-2 focus:ring-indigo-600 outline-none"
                      >
                        <option value="ollama">Ollama</option>
                        <option value="llamacpp">llama.cpp</option>
                        <option value="gemini">Gemini (Cloud)</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 font-medium">Model</label>
                      <input
                        type="text"
                        value={mc[func].model}
                        onChange={(e) => updateModelFunc(func, { model: e.target.value })}
                        className="w-full text-xs bg-white border border-slate-200 rounded-lg py-1.5 px-2 focus:ring-2 focus:ring-indigo-600 outline-none"
                        placeholder="model name"
                      />
                    </div>
                  </div>
                  {mc[func].provider !== "gemini" ? (
                    <div>
                      <label className="text-[10px] text-slate-400 font-medium">Base URL</label>
                      <input
                        type="text"
                        value={mc[func].baseUrl || (mc[func].provider === "ollama" ? "http://localhost:11434" : "http://localhost:8080")}
                        onChange={(e) => updateModelFunc(func, { baseUrl: e.target.value })}
                        className="w-full text-xs bg-white border border-slate-200 rounded-lg py-1.5 px-2 focus:ring-2 focus:ring-indigo-600 outline-none"
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="text-[10px] text-slate-400 font-medium">API Key</label>
                      <input
                        type="password"
                        value={mc[func].apiKey || ""}
                        onChange={(e) => updateModelFunc(func, { apiKey: e.target.value })}
                        className="w-full text-xs bg-white border border-slate-200 rounded-lg py-1.5 px-2 focus:ring-2 focus:ring-indigo-600 outline-none"
                        placeholder="GEMINI_API_KEY"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Big Action Submit Button */}
        <button
          type="button"
          onClick={onSubmit}
          disabled={isLoading || !config.topic.trim()}
          id="btn-trigger-synthesis"
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99] text-white rounded-lg font-semibold text-sm shadow-md transition-all duration-150 cursor-pointer flex items-center justify-center gap-2 hover:shadow-lg disabled:bg-slate-100 disabled:text-slate-450 disabled:border-slate-200 disabled:cursor-not-allowed disabled:shadow-none"
        >
          {isLoading ? (
            <div className="flex flex-col items-center gap-0.5 py-0.5">
              <div className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4 text-slate-650" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span className="font-bold text-slate-700">Synthesizing Dataset...</span>
              </div>
              <p className="text-[10px] text-slate-400 font-medium animate-pulse">{loadingStep}</p>
            </div>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Synthesize Dataset</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
