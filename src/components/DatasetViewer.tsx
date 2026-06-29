/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { DatasetItem, DatasetFormat, AlpacaItem, ShareGPTItem, QAItem, RawItem } from "../types";
import { 
  Download, Copy, ClipboardCheck, Trash2, Edit3, PlusCircle, Check, 
  X, Sparkles, Filter, ChevronDown, ChevronUp, CopyIcon, Layers, Eye, RefreshCw, FileText, Upload, Loader
} from "lucide-react";

interface DatasetViewerProps {
  items: DatasetItem[];
  onUpdateItems: (newItems: DatasetItem[]) => void;
  format: DatasetFormat;
  topic: string;
  researchSummary: string;
  isLoadingMore: boolean;
  onSynthesizeMore: (count: number) => void;
}

export default function DatasetViewer({ 
  items, 
  onUpdateItems, 
  format, 
  topic, 
  researchSummary, 
  isLoadingMore, 
  onSynthesizeMore 
}: DatasetViewerProps) {
  
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSubtopic, setSelectedSubtopic] = useState("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  
  // Custom Addition States
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTopic, setNewTopic] = useState("");
  // Form elements depending on format
  const [alpacaInstruction, setAlpacaInstruction] = useState("");
  const [alpacaInput, setAlpacaInput] = useState("");
  const [alpacaOutput, setAlpacaOutput] = useState("");
  
  const [qaQuestion, setQaQuestion] = useState("");
  const [qaAnswer, setQaAnswer] = useState("");
  
  const [rawTitle, setRawTitle] = useState("");
  const [rawText, setRawText] = useState("");
  
  const [messagesJson, setMessagesJson] = useState(`[
  {"role": "system", "content": "You are an expert AI."},
  {"role": "user", "content": "What is the primary factor?"},
  {"role": "assistant", "content": "The primary factor is..."}
]`);

  // Editing Mode States
  const [editingItem, setEditingItem] = useState<DatasetItem | null>(null);

  // Synthetic More state
  const [syntheticCount, setSyntheticCount] = useState(2);

  // Hugging Face upload state
  const [showHFDialog, setShowHFDialog] = useState(false);
  const [hfToken, setHfToken] = useState("");
  const [hfRepoName, setHfRepoName] = useState("");
  const [hfUploading, setHfUploading] = useState(false);
  const [hfResult, setHfResult] = useState<{ success: boolean; url?: string; error?: string } | null>(null);

  // Get distinct subtopics from items
  const subtopicsList = Array.from(new Set(items.map(item => item.topic || "Core Concepts")));

  if (!items || items.length === 0) {
    return (
      <div id="viewer-empty" className="bg-white border border-slate-200 rounded-xl p-12 text-center shadow-sm">
        <Sparkles className="w-12 h-12 mx-auto text-indigo-500 mb-3 animate-bounce" style={{ animationDuration: "3s" }} />
        <h3 className="text-base font-bold text-slate-800">No Dataset Generated Yet</h3>
        <p className="text-xs text-slate-500 mt-1.5 max-w-md mx-auto leading-relaxed">
          Input your theme in the sidebar research panel and trigger synthesis to gather live search grounding facts and craft instruction matrices.
        </p>
      </div>
    );
  }

  // Escape helper for CSV export
  const escapeCSV = (val: string) => {
    if (val === undefined || val === null) return '""';
    const clean = val.toString().replace(/"/g, '""');
    return `"${clean}"`;
  };

  // EXPORT PIPELINES
  const handleExportJSON = () => {
    // Format appropriately before printing
    let output = "";
    if (format === "alpaca") {
      const alpacaOnly = items.map(itm => itm.alpaca);
      output = JSON.stringify(alpacaOnly, null, 2);
    } else if (format === "sharegpt") {
      const shareGptOnly = items.map(itm => itm.sharegpt);
      output = JSON.stringify(shareGptOnly, null, 2);
    } else if (format === "qa") {
      const qaOnly = items.map(itm => itm.qa);
      output = JSON.stringify(qaOnly, null, 2);
    } else {
      const rawOnly = items.map(itm => itm.raw);
      output = JSON.stringify(rawOnly, null, 2);
    }
    triggerDownload(`${topic.toLowerCase().replace(/\s+/g, "_")}_dataset.json`, output, "application/json");
  };

  const handleExportJSONL = () => {
    let output = "";
    if (format === "alpaca") {
      output = items.map(itm => JSON.stringify(itm.alpaca)).join("\n");
    } else if (format === "sharegpt") {
      output = items.map(itm => JSON.stringify(itm.sharegpt)).join("\n");
    } else if (format === "qa") {
      output = items.map(itm => JSON.stringify(itm.qa)).join("\n");
    } else {
      output = items.map(itm => JSON.stringify(itm.raw)).join("\n");
    }
    triggerDownload(`${topic.toLowerCase().replace(/\s+/g, "_")}_dataset.jsonl`, output, "application/x-jsonlines");
  };

  const handleExportCSV = () => {
    let output = "";
    if (format === "alpaca") {
      output = "Category,Instruction,Input,Output\n";
      items.forEach(itm => {
        output += `${escapeCSV(itm.topic || "")},${escapeCSV(itm.alpaca?.instruction || "")},${escapeCSV(itm.alpaca?.input || "")},${escapeCSV(itm.alpaca?.output || "")}\n`;
      });
    } else if (format === "sharegpt") {
      output = "Category,MessagesJSON\n";
      items.forEach(itm => {
        output += `${escapeCSV(itm.topic || "")},${escapeCSV(JSON.stringify(itm.sharegpt?.messages))}\n`;
      });
    } else if (format === "qa") {
      output = "Category,Question,Answer\n";
      items.forEach(itm => {
        output += `${escapeCSV(itm.topic || "")},${escapeCSV(itm.qa?.question || "")},${escapeCSV(itm.qa?.answer || "")}\n`;
      });
    } else {
      output = "Category,Title,TextContent\n";
      items.forEach(itm => {
        output += `${escapeCSV(itm.topic || "")},${escapeCSV(itm.raw?.title || "")},${escapeCSV(itm.raw?.text || "")}\n`;
      });
    }
    triggerDownload(`${topic.toLowerCase().replace(/\s+/g, "_")}_dataset.csv`, output, "text/csv");
  };

  const handleExportTXT = () => {
    let output = "#################################################################\n";
    output += `## SYSTEM TEXT DESIGN FOR LLM PRE-TRAINING / SENSING: ${topic.toUpperCase()}\n`;
    output += "#################################################################\n\n";

    items.forEach((itm, idx) => {
      output += `--- EXAMPLE ${idx + 1} | CATEGORY: ${(itm.topic || "").toUpperCase()} ---\n`;
      if (itm.format === "alpaca" && itm.alpaca) {
        output += `[INSTRUCTION]:\n${itm.alpaca.instruction}\n`;
        if (itm.alpaca.input) {
          output += `[CONTEXT INPUT]:\n${itm.alpaca.input}\n`;
        }
        output += `[COMPLETION RESPONSE]:\n${itm.alpaca.output}\n`;
      } else if (itm.format === "sharegpt" && itm.sharegpt) {
        itm.sharegpt.messages.forEach(msg => {
          output += `[${msg.role.toUpperCase()}]:\n${msg.content}\n`;
        });
      } else if (itm.format === "qa" && itm.qa) {
        output += `[QUESTION]:\n${itm.qa.question}\n`;
        output += `[ANSWER]:\n${itm.qa.answer}\n`;
      } else if (itm.format === "raw" && itm.raw) {
        output += `[TITLE]: ${itm.raw.title}\n`;
        output += `${itm.raw.text}\n`;
      }
      output += "\n";
    });

    triggerDownload(`${topic.toLowerCase().replace(/\s+/g, "_")}_doc_pretrain.txt`, output, "text/plain");
  };

  const triggerDownload = (filename: string, content: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // LOCAL STATE ACTIONS
  const handleDeleteItem = (id: string) => {
    onUpdateItems(items.filter(item => item.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const handleFeedback = (itemId: string, type: 'positive' | 'negative') => {
    const updated = items.map(itm =>
      itm.id === itemId
        ? { ...itm, feedback: itm.feedback === type ? undefined : type }
        : itm
    );
    onUpdateItems(updated);
  };

  const handleDuplicateItem = (item: DatasetItem) => {
    const duplicated: DatasetItem = {
      ...item,
      id: `item-dup-${Date.now()}-${Math.floor(Math.random() * 100)}`
    };
    onUpdateItems([...items, duplicated]);
  };

  const handleCopyItemText = (item: DatasetItem) => {
    let text = "";
    if (item.format === "alpaca" && item.alpaca) {
      text = `Instruction: ${item.alpaca.instruction}\nInput: ${item.alpaca.input}\nOutput: ${item.alpaca.output}`;
    } else if (item.format === "sharegpt" && item.sharegpt) {
      text = JSON.stringify(item.sharegpt.messages, null, 2);
    } else if (item.format === "qa" && item.qa) {
      text = `Question: ${item.qa.question}\nAnswer: ${item.qa.answer}`;
    } else if (item.format === "raw" && item.raw) {
      text = `Section: ${item.raw.title}\nText: ${item.raw.text}`;
    }

    navigator.clipboard.writeText(text);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  // CREATE CUSTOM ITEM SUBMITHANDLER
  const handleAddCustomItem = (e: React.FormEvent) => {
    e.preventDefault();
    const itemTopic = newTopic.trim() || "Manual Curation";
    const base: DatasetItem = {
      id: `item-manual-${Date.now()}`,
      format,
      topic: itemTopic,
      metadata: {
        reasoning: "Manual entry",
        intent: "User-defined",
        complexity: "intermediate",
        is_negative: false
      }
    };

    if (format === "alpaca") {
      if (!alpacaInstruction.trim()) return;
      base.alpaca = {
        instruction: alpacaInstruction,
        input: alpacaInput,
        output: alpacaOutput
      };
      setAlpacaInstruction("");
      setAlpacaInput("");
      setAlpacaOutput("");
    } else if (format === "sharegpt") {
      try {
        const msgs = JSON.parse(messagesJson);
        base.sharegpt = { messages: msgs };
      } catch (err) {
        alert("Invalid JSON format for dialog turn sequence.");
        return;
      }
    } else if (format === "qa") {
      if (!qaQuestion.trim()) return;
      base.qa = {
        question: qaQuestion,
        answer: qaAnswer
      };
      setQaQuestion("");
      setQaAnswer("");
    } else {
      if (!rawTitle.trim()) return;
      base.raw = {
        title: rawTitle,
        text: rawText
      };
      setRawTitle("");
      setRawText("");
    }

    onUpdateItems([base, ...items]);
    setNewTopic("");
    setShowAddForm(false);
  };

  // UPDATE IN-PLACE EDIT SAVER
  const handleSaveEdit = () => {
    if (!editingItem) return;

    const updated = items.map(itm => {
      if (itm.id === editingItem.id) {
        return editingItem;
      }
      return itm;
    });

    onUpdateItems(updated);
    setEditingItem(null);
  };

  // HUGGING FACE UPLOAD HANDLER
  const handleUploadToHF = async () => {
    if (!hfToken.trim() || !hfRepoName.trim() || items.length === 0) return;

    setHfUploading(true);
    setHfResult(null);

    try {
      const response = await fetch("/api/upload-huggingface", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items,
          token: hfToken.trim(),
          repoName: hfRepoName.trim(),
          format,
          topic,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setHfResult({ success: true, url: data.url });
      } else {
        setHfResult({ success: false, error: data.error || "Upload failed" });
      }
    } catch (err: any) {
      setHfResult({ success: false, error: err.message || "Network error" });
    } finally {
      setHfUploading(false);
    }
  };

  // SEARCH AND FILTERING
  const filteredItems = items.filter(item => {
    // Subtopic filter
    if (selectedSubtopic !== "all" && item.topic !== selectedSubtopic) {
      return false;
    }

    // Search query matches
    if (!searchTerm.trim()) return true;
    const query = searchTerm.toLowerCase();
    
    const topicMatch = (item.topic || "").toLowerCase().includes(query);
    
    let contentMatch = false;
    if (item.format === "alpaca" && item.alpaca) {
      contentMatch = item.alpaca.instruction.toLowerCase().includes(query) || 
                     item.alpaca.input.toLowerCase().includes(query) || 
                     item.alpaca.output.toLowerCase().includes(query);
    } else if (item.format === "sharegpt" && item.sharegpt) {
      contentMatch = item.sharegpt.messages.some(m => m.content.toLowerCase().includes(query));
    } else if (item.format === "qa" && item.qa) {
      contentMatch = item.qa.question.toLowerCase().includes(query) || 
                     item.qa.answer.toLowerCase().includes(query);
    } else if (item.format === "raw" && item.raw) {
      contentMatch = item.raw.title.toLowerCase().includes(query) || 
                     item.raw.text.toLowerCase().includes(query);
    }

    return topicMatch || contentMatch;
  });

  return (
    <div id="dataset-curator-view" className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden flex flex-col">
      
      {/* File Action Controls with Sleek background styling */}
      <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-50/50">
        <div>
          <h3 className="font-bold text-slate-700 text-sm" id="header-records">
            Generated Artifacts Dataset ({items.length} records)
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {(() => {
              const pos = items.filter(i => i.feedback === 'positive').length;
              const neg = items.filter(i => i.feedback === 'negative').length;
              if (pos + neg === 0) return "Fine-tune, curate, and download compiled target vectors";
              return `${pos} approved · ${neg} rejected · ${items.length - pos - neg} unreviewed`;
            })()}
          </p>
        </div>

        {/* Action downloads list in clean minimal style */}
        <div className="flex flex-wrap items-center gap-2 self-stretch sm:self-auto" id="download-actions">
          <button
            onClick={handleExportJSON}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg py-1.5 px-3.5 shadow-xs hover:bg-slate-50 transition cursor-pointer"
            id="download-json"
          >
            <Download className="w-3.5 h-3.5 text-slate-400" />
            <span>JSON</span>
          </button>
          
          <button
            onClick={handleExportJSONL}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-650 bg-white border border-slate-200 rounded-lg py-1.5 px-3.5 shadow-xs hover:bg-slate-50 transition cursor-pointer"
            id="download-jsonl"
          >
            <FileText className="w-3.5 h-3.5 text-slate-400" />
            <span>JSONL</span>
          </button>

          <button
            onClick={handleExportCSV}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-650 bg-white border border-slate-200 rounded-lg py-1.5 px-3.5 shadow-xs hover:bg-slate-50 transition cursor-pointer"
            id="download-csv"
          >
            <FileText className="w-3.5 h-3.5 text-slate-400" />
            <span>CSV</span>
          </button>

          <button
            onClick={handleExportTXT}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-650 bg-white border border-slate-200 rounded-lg py-1.5 px-3.5 shadow-xs hover:bg-slate-50 transition cursor-pointer"
            id="download-txt"
          >
            <Layers className="w-3.5 h-3.5 text-slate-400" />
            <span>TXT</span>
          </button>

          {/* Hugging Face Upload Button */}
          <button
            onClick={() => { setShowHFDialog(true); setHfResult(null); }}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg py-1.5 px-3.5 hover:bg-indigo-100 transition cursor-pointer"
            id="upload-hf"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>HF Hub</span>
          </button>
        </div>
      </div>

      {/* Searching & Filter Bar */}
      <div className="p-4 flex flex-col md:flex-row items-stretch gap-3 bg-white border-b border-slate-100">
        <div className="relative flex-1">
          <input
            type="text"
            className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg py-2.5 pl-8 pr-3 focus:outline-none focus:ring-2 focus:ring-indigo-600 font-medium text-slate-800 transition"
            placeholder="Search records contents..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <Filter className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-3" />
        </div>

        {subtopicsList.length > 0 && (
          <select
            value={selectedSubtopic}
            onChange={(e) => setSelectedSubtopic(e.target.value)}
            className="text-xs bg-slate-55 border border-slate-200 rounded-lg py-2.5 px-3 font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-600"
          >
            <option value="all">📁 All Categories ({items.length})</option>
            {subtopicsList.map((sub, idx) => (
              <option key={idx} value={sub}>
                {sub}
              </option>
            ))}
          </select>
        )}

        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shrink-0"
        >
          <PlusCircle className="w-3.5 h-3.5" />
          <span>New Example</span>
        </button>
      </div>

      {/* ADD CUSTOM EXAMPLE POP-IN FORM */}
      {showAddForm && (
        <form onSubmit={handleAddCustomItem} className="border border-indigo-100 bg-indigo-50/20 p-4 rounded-xl space-y-3 animation-fade">
          <div className="flex items-center justify-between border-b border-indigo-100/50 pb-2 mb-1">
            <h3 className="text-xs font-bold text-indigo-900 uppercase tracking-wider">Append Grounded Example</h3>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Category Subtopic</label>
              <input
                type="text"
                className="w-full text-xs bg-white border border-slate-200 rounded-md py-1.5 px-2.5 text-slate-800 font-medium"
                placeholder="e.g. Math Definition, Historical Fact"
                value={newTopic}
                onChange={(e) => setNewTopic(e.target.value)}
                required
              />
            </div>
            <div className="flex items-end text-[10px] text-slate-400 font-medium pb-2">
              Appending a custom record will update dataset benchmarks in real-time.
            </div>
          </div>

          {/* Form items based on format */}
          {format === "alpaca" && (
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Instruction / Prompt Command</label>
                <textarea
                  rows={2}
                  className="w-full text-xs bg-white border border-slate-200 rounded-md p-2.5 text-slate-800"
                  placeholder="Explain Shor's algorithm step-by-step..."
                  value={alpacaInstruction}
                  onChange={(e) => setAlpacaInstruction(e.target.value)}
                  required
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Input Context (Optional)</label>
                  <textarea
                    rows={2}
                    className="w-full text-xs bg-white border border-slate-200 rounded-md p-2.5 text-slate-800"
                    placeholder="Enter support texts..."
                    value={alpacaInput}
                    onChange={(e) => setAlpacaInput(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Synthesized Output Response</label>
                  <textarea
                    rows={2}
                    className="w-full text-xs bg-white border border-slate-200 rounded-md p-2.5 text-slate-800"
                    placeholder="Provide the completion training result..."
                    value={alpacaOutput}
                    onChange={(e) => setAlpacaOutput(e.target.value)}
                    required
                  />
                </div>
              </div>
            </div>
          )}

          {format === "sharegpt" && (
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">JSON Conversation Thread (Role / Content)</label>
              <textarea
                rows={5}
                className="w-full text-xs bg-white border border-slate-200 font-mono rounded-md p-2.5 text-slate-800"
                value={messagesJson}
                onChange={(e) => setMessagesJson(e.target.value)}
                required
              />
            </div>
          )}

          {format === "qa" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Target Question</label>
                <textarea
                  rows={3}
                  className="w-full text-xs bg-white border border-slate-200 rounded-md p-2.5 text-slate-800"
                  placeholder="Insert question here..."
                  value={qaQuestion}
                  onChange={(e) => setQaQuestion(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Target Answer</label>
                <textarea
                  rows={3}
                  className="w-full text-xs bg-white border border-slate-200 rounded-md p-2.5 text-slate-800"
                  placeholder="Insert answer here..."
                  value={qaAnswer}
                  onChange={(e) => setQaAnswer(e.target.value)}
                  required
                />
              </div>
            </div>
          )}

          {format === "raw" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Pasage Title</label>
                <input
                  type="text"
                  className="w-full text-xs bg-white border border-slate-200 rounded-md py-1.5 px-2 text-slate-800"
                  placeholder="Secton header..."
                  value={rawTitle}
                  onChange={(e) => setRawTitle(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Pasage Body Prose</label>
                <textarea
                  rows={3}
                  className="w-full text-xs bg-white border border-slate-200 rounded-md p-2 text-slate-800"
                  placeholder="Enter detailed facts..."
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  required
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pr-1 pt-1">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-3.5 py-1.5 text-slate-500 hover:text-slate-800 text-xs font-semibold rounded"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
            >
              Add Record
            </button>
          </div>
        </form>
      )}

      {/* MAIN RECORDS GRID LIST */}
      <div className="p-4 space-y-3" id="records-list">
        {filteredItems.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs bg-slate-50/50 rounded-xl border border-dashed text-slate-500 border-slate-200">
            No dataset records matched your search query or subtopic filter.
          </div>
        ) : (
          filteredItems.map((item, idx) => {
            const isExpanded = expandedId === item.id;
            
            // Extract display titles and details
            let title = "";
            let preview = "";

            if (item.format === "alpaca" && item.alpaca) {
              title = item.alpaca.instruction;
              preview = item.alpaca.output;
            } else if (item.format === "sharegpt" && item.sharegpt) {
              const uMsg = item.sharegpt.messages.find(m => m.role === "user");
              const aMsg = item.sharegpt.messages.find(m => m.role === "assistant");
              title = uMsg ? uMsg.content : "Dialogue Sequence";
              preview = aMsg ? aMsg.content : "No Assistant Dialog";
            } else if (item.format === "qa" && item.qa) {
              title = item.qa.question;
              preview = item.qa.answer;
            } else if (item.format === "raw" && item.raw) {
              title = item.raw.title;
              preview = item.raw.text;
            }

            return (
              <div 
                key={item.id} 
                className={`border rounded-xl transition-all ${
                  isExpanded ? "border-indigo-200 shadow-sm" : "border-slate-100 hover:border-slate-200 bg-white"
                }`}
              >
                {/* Header row */}
                <div className="flex items-center justify-between p-3.5 cursor-pointer select-none" onClick={() => setExpandedId(isExpanded ? null : item.id)}>
                  <div className="flex items-start gap-3 min-w-0 flex-1 pr-4">
                    <span className="text-[10px] font-mono text-slate-400 font-bold bg-slate-50 px-2 py-0.5 rounded shrink-0" id={`id-tag-${idx}`}>
                      #{idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-800 truncate" id={`title-text-${idx}`}>{title}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-medium capitalize">
                          {item.topic || "Research Fact"}
                        </span>
                        {preview && (
                          <span className="text-[10px] text-slate-400 truncate hidden sm:inline">
                            • {preview.substring(0, 80)}...
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {/* Copy Button */}
                    <button
                      onClick={() => handleCopyItemText(item)}
                      className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-md transition-colors"
                      title="Copy item clipboard"
                    >
                      {copiedId === item.id ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                    </button>

                    {/* Edit Button */}
                    <button
                      onClick={() => setEditingItem(item)}
                      className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50/50 rounded-md transition-colors"
                      title="Edit dataset item"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>

                    {/* Duplicate button */}
                    <button
                      onClick={() => handleDuplicateItem(item)}
                      className="p-1.5 text-slate-400 hover:text-amber-500 hover:bg-amber-50 rounded-md transition-colors"
                      title="Clone record"
                    >
                      <Layers className="w-4 h-4" />
                    </button>

                    {/* Delete button */}
                    <button
                      onClick={() => handleDeleteItem(item.id)}
                      className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                      title="Delete record"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>

                    <button 
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      className="p-1.5 text-slate-400 hover:text-slate-600 rounded-md"
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Expanded fields */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-1 border-t border-slate-50 bg-slate-50/40 rounded-b-xl space-y-3 font-sans">
                    
                    {/* Logic & Reasoning Section */}
                    <div className="grid grid-cols-1 gap-2 p-3 bg-indigo-900/5 border border-indigo-100 rounded-lg">
                      <div className="flex items-center justify-between">
                        <h4 className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider flex items-center gap-1">
                          <Layers className="w-3 h-3" /> Reasoning Path
                        </h4>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-0.5 mr-1">
                            <button
                              onClick={() => handleFeedback(item.id, 'positive')}
                              className={`p-0.5 rounded transition-colors ${
                                item.feedback === 'positive' ? 'text-emerald-600 bg-emerald-50' : 'text-slate-300 hover:text-emerald-500 hover:bg-emerald-50'
                              }`}
                              title="Mark as high quality"
                            >
                              <svg className="w-3.5 h-3.5" fill={item.feedback === 'positive' ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleFeedback(item.id, 'negative')}
                              className={`p-0.5 rounded transition-colors ${
                                item.feedback === 'negative' ? 'text-red-500 bg-red-50' : 'text-slate-300 hover:text-red-500 hover:bg-red-50'
                              }`}
                              title="Mark as low quality"
                            >
                              <svg className="w-3.5 h-3.5" fill={item.feedback === 'negative' ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.096c.5 0 .905-.405.905-.904 0-.715.211-1.413.608-2.008L17 13V4m-7 10h2" />
                              </svg>
                            </button>
                          </div>
                          <span className="text-[9px] font-bold bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded uppercase">
                            {item.metadata?.intent || "General"}
                          </span>
                          <span className="text-[9px] font-bold bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded uppercase">
                            {item.metadata?.complexity || "Intermediate"}
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-slate-700 italic leading-relaxed bg-white border border-indigo-50 p-2 rounded shadow-sm whitespace-pre-wrap">
                        {item.metadata?.reasoning || "No reasoning path generated."}
                      </p>
                      {item.metadata?.trajectory && item.metadata.trajectory.length > 0 && (
                        <div className="mt-3 space-y-2">
                          <h5 className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-1">
                            <RefreshCw className="w-3 h-3" /> Thought Trajectory
                          </h5>
                          {item.metadata.trajectory.map((t, i) => (
                            <div key={i} className="text-xs p-2 rounded-lg border border-indigo-100 bg-indigo-50/30 leading-relaxed">
                              <span className="font-bold text-indigo-600 text-[9px] uppercase block mb-1">
                                {t.phase.replace('_', ' ')} (Step {t.step})
                              </span>
                              <p className="text-slate-700 whitespace-pre-wrap">{t.content}</p>
                              {t.thought_process && (
                                <p className="text-[10px] text-slate-400 mt-1 italic">Internal Monologue: {t.thought_process}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {item.metadata?.persona && (
                        <div className="mt-3 p-2 bg-slate-100 border border-slate-200 rounded text-xs text-slate-600 italic">
                          <strong className="text-[10px] uppercase font-bold block mb-1 text-slate-500">Persona Profile:</strong>
                          {item.metadata.persona.role} | {item.metadata.persona.mental_state} | {item.metadata.persona.constraint}
                        </div>
                      )}
                      {item.metadata?.interdisciplinary_link && (
                        <div className="mt-3 p-2 bg-emerald-50 border border-emerald-100 rounded text-xs text-emerald-800 leading-relaxed">
                          <strong className="text-[10px] uppercase font-bold block mb-1 text-emerald-600">Interdisciplinary Bridge:</strong>
                          {item.metadata.interdisciplinary_link.domain_a} $\rightarrow$ {item.metadata.interdisciplinary_link.domain_b}
                          <p className="mt-1 text-emerald-700">{item.metadata.interdisciplinary_link.synthesis_bridge}</p>
                        </div>
                      )}
                      {item.metadata?.is_negative && (
                        <div className="mt-2 p-2 bg-red-50 border border-red-100 rounded text-xs text-red-800 leading-relaxed">
                          <strong className="text-[10px] uppercase font-bold block mb-1">Correction Loop:</strong>
                          {item.metadata.correction || "No correction provided."}
                        </div>
                      )}
                    </div>

                    {item.format === "alpaca" && item.alpaca && (
                      <div className="space-y-2 text-sm leading-relaxed text-slate-600">
                        {item.alpaca.input && (
                          <div className="bg-white border border-slate-100 rounded-lg p-2.5">
                            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Input Sequence</h4>
                            <p className="text-xs text-slate-700 font-medium whitespace-pre-wrap">{item.alpaca.input}</p>
                          </div>
                        )}
                        <div className="bg-white border border-slate-100 rounded-lg p-3 shadow-2xs">
                          <h4 className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider mb-1">Synthesized System Response</h4>
                          <p className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">{item.alpaca.output}</p>
                        </div>
                      </div>
                    )}
                    
                    {item.format === "sharegpt" && item.sharegpt && (
                      <div className="space-y-2">
                        {item.sharegpt.messages.map((msg, mIdx) => {
                          const bg = msg.role === "user" ? "bg-indigo-50/30 border-indigo-100" : msg.role === "system" ? "bg-slate-100 border-slate-200" : "bg-white border-slate-100";
                          const labelColor = msg.role === "user" ? "text-indigo-600" : msg.role === "system" ? "text-slate-600" : "text-emerald-600";
                          return (
                            <div key={mIdx} className={`border p-2.5 rounded-lg ${bg}`}>
                             <h4 className={`text-[9px] font-bold uppercase tracking-wider mb-1 ${labelColor}`}>
                               {msg.role}
                             </h4>
                             <p className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    
                    {item.format === "qa" && item.qa && (
                      <div className="space-y-2 text-sm text-slate-600 leading-relaxed">
                        <div className="bg-white border border-slate-100 rounded-lg p-3">
                          <h4 className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider mb-1">Tutor Question</h4>
                          <p className="text-xs text-slate-800 whitespace-pre-wrap font-semibold">{item.qa.question}</p>
                        </div>
                        <div className="bg-white border border-slate-100 rounded-lg p-3 shadow-2xs">
                          <h4 className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider mb-1">Tutor Answer</h4>
                          <p className="text-xs text-slate-800 whitespace-pre-wrap">{item.qa.answer}</p>
                        </div>
                      </div>
                    )}
                    
                    {item.format === "raw" && item.raw && (
                      <div className="bg-white border border-slate-100 rounded-lg p-3 shadow-2xs text-sm">
                        <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Textbook Passages Body</h4>
                        <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">{item.raw.text}</p>
                      </div>
                    )}
                  </div>
                )}

              </div>
            );
          })
        )}
      </div>

      {/* SYNTHETIC DATAPOINT EXPANSION PANEL */}
      {researchSummary && (
        <div className="px-4 pb-4 border-t border-slate-100 pt-4" id="expansion-pannel">
          <div className="bg-indigo-50/20 border border-indigo-150 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-indigo-500" />
                <span>Synthetic Expansion Engine</span>
              </h3>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Appends brand-new, non-overlapping examples based on search grounding context with active redundancy filtering.
              </p>
            </div>

            <div className="flex items-center gap-2 pr-1 self-end md:self-auto">
              <span className="text-xs font-semibold text-slate-500 shrink-0">Count:</span>
              <select
                value={syntheticCount}
                onChange={(e) => setSyntheticCount(Number(e.target.value))}
                className="text-xs bg-white border border-slate-200 rounded-md p-1.5 font-bold focus:outline-none"
              >
                <option value="2">2 Records (+)</option>
                <option value="5">5 Records</option>
                <option value="10">10 Records (Recommended)</option>
              </select>

              <button
                type="button"
                onClick={() => onSynthesizeMore(syntheticCount)}
                disabled={isLoadingMore}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-100 text-white disabled:text-slate-400 py-1.5 px-3.5 rounded-lg text-xs font-bold transition-all shadow-sm cursor-pointer flex items-center gap-1 justify-center shrink-0"
              >
                {isLoadingMore ? (
                  <>
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    <span>Expanding...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3 h-3 text-white fill-current animate-pulse" />
                    <span>Synthesize</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HUGGING FACE UPLOAD DIALOG */}
      {showHFDialog && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white border border-slate-100 rounded-xl max-w-md w-full p-5 space-y-4 shadow-xl shadow-slate-900/10">
            <div className="flex items-center justify-between border-b pb-3 border-slate-100">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Upload className="w-4 h-4 text-indigo-500" />
                <span>Upload to Hugging Face Hub</span>
              </h3>
              <button onClick={() => setShowHFDialog(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                  Hugging Face Token
                </label>
                <input
                  type="password"
                  className="w-full text-xs bg-slate-50 border border-slate-200 rounded-md py-1.5 px-2.5 font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  placeholder="hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={hfToken}
                  onChange={(e) => setHfToken(e.target.value)}
                />
                <p className="text-[9px] text-slate-400 mt-1">
                  Create at{" "}
                  <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noopener noreferrer" className="text-indigo-500 underline">
                    huggingface.co/settings/tokens
                  </a>
                </p>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                  Dataset Repository Name
                </label>
                <input
                  type="text"
                  className="w-full text-xs bg-slate-50 border border-slate-200 rounded-md py-1.5 px-2.5 font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  placeholder="my-llm-dataset"
                  value={hfRepoName}
                  onChange={(e) => setHfRepoName(e.target.value)}
                />
                <p className="text-[9px] text-slate-400 mt-1">
                  Will be created at huggingface.co/datasets/{"<repo>"}
                </p>
              </div>

              {items.length > 0 && (
                <div className="bg-slate-50 rounded-lg p-2.5 text-[10px] text-slate-600">
                  <span className="font-bold">{items.length}</span> items in <span className="font-bold">{format}</span> format will be uploaded.
                </div>
              )}

              {hfResult && (
                <div className={`p-2.5 rounded-lg text-xs ${
                  hfResult.success ? "bg-emerald-50 border border-emerald-200 text-emerald-800" : "bg-red-50 border border-red-200 text-red-800"
                }`}>
                  {hfResult.success ? (
                    <div>
                      <p className="font-bold mb-1">Upload successful!</p>
                      <a href={hfResult.url} target="_blank" rel="noopener noreferrer" className="underline text-indigo-600">
                        {hfResult.url}
                      </a>
                    </div>
                  ) : (
                    <div>
                      <p className="font-bold mb-1">Upload failed</p>
                      <p>{hfResult.error}</p>
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={handleUploadToHF}
                disabled={hfUploading || !hfToken.trim() || !hfRepoName.trim()}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                {hfUploading ? (
                  <>
                    <Loader className="w-3.5 h-3.5 animate-spin" />
                    <span>Uploading...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload to Hugging Face</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL EDIT DIALOG SCREEN */}
      {editingItem && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white border border-slate-100 rounded-xl max-w-2xl w-full p-5 space-y-4 shadow-xl shadow-slate-900/10">
            <div className="flex items-center justify-between border-b pb-3 border-slate-100">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Edit3 className="w-4 h-4 text-indigo-500" />
                <span>Edit Dataset Example Vector</span>
              </h3>
              <button onClick={() => setEditingItem(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

               <div className="space-y-3">
                 {/* Common Topic Change */}
                 <div className="grid grid-cols-2 gap-3">
                   <div>
                     <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Discovered Subtopic</label>
                     <input
                       type="text"
                       className="w-full text-xs bg-slate-50 border border-slate-200 rounded-md py-1.5 px-2.5 font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                       value={editingItem.topic || ""}
                       onChange={(e) => setEditingItem({ ...editingItem, topic: e.target.value })}
                     />
                   </div>
                   <div>
                     <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Cognitive Intent</label>
                     <input
                       type="text"
                       className="w-full text-xs bg-slate-50 border border-slate-200 rounded-md py-1.5 px-2.5 font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                       value={editingItem.metadata?.intent || ""}
                       onChange={(e) => setEditingItem({ 
                         ...editingItem, 
                         metadata: { ...editingItem.metadata!, intent: e.target.value } 
                       })}
                     />
                   </div>
                 </div>
 
                 <div className="grid grid-cols-1 gap-3">
                   <div>
                     <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Logical Reasoning Path (CoT)</label>
                     <textarea
                       rows={4}
                       className="w-full text-xs border border-slate-200 rounded-md p-2 text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-indigo-50/20"
                       value={editingItem.metadata?.reasoning || ""}
                       onChange={(e) => setEditingItem({ 
                         ...editingItem, 
                         metadata: { ...editingItem.metadata!, reasoning: e.target.value } 
                       })}
                     />
                   </div>
                   <div className="flex items-center gap-3">
                     <div className="flex items-center gap-2">
                       <input 
                         type="checkbox" 
                         checked={editingItem.metadata?.is_negative || false}
                         onChange={(e) => setEditingItem({ 
                           ...editingItem, 
                           metadata: { ...editingItem.metadata!, is_negative: e.target.checked } 
                         })}
                         className="w-3 h-3 text-indigo-600"
                       />
                       <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Is Logical Trap (Negative Example)</label>
                     </div>
                   </div>
                   {editingItem.metadata?.is_negative && (
                     <div>
                       <label className="block text-[10px] font-bold text-red-500 uppercase tracking-wider mb-1">Correction / Ground Truth</label>
                       <textarea
                         rows={3}
                         className="w-full text-xs border border-red-200 rounded-md p-2 text-slate-800 focus:outline-none focus:ring-1 focus:ring-red-500 bg-red-50/20"
                         value={editingItem.metadata?.correction || ""}
                         onChange={(e) => setEditingItem({ 
                           ...editingItem, 
                           metadata: { ...editingItem.metadata!, correction: e.target.value } 
                         })}
                       />
                     </div>
                   )}
                 </div>

                {editingItem.format === "alpaca" && editingItem.alpaca && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Instruction / Prompt</label>
                    <textarea
                      rows={3}
                      className="w-full text-xs border border-slate-200 rounded-md p-2 text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      value={editingItem.alpaca.instruction}
                      onChange={(e) => setEditingItem({
                        ...editingItem,
                        alpaca: { ...editingItem.alpaca!, instruction: e.target.value }
                      })}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Supporting Input (Optional)</label>
                    <textarea
                      rows={2}
                      className="w-full text-xs border border-slate-200 rounded-md p-2 text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      value={editingItem.alpaca.input}
                      onChange={(e) => setEditingItem({
                        ...editingItem,
                        alpaca: { ...editingItem.alpaca!, input: e.target.value }
                      })}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Completion Output</label>
                    <textarea
                      rows={4}
                      className="w-full text-xs border border-slate-200 rounded-md p-2 text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      value={editingItem.alpaca.output}
                      onChange={(e) => setEditingItem({
                        ...editingItem,
                        alpaca: { ...editingItem.alpaca!, output: e.target.value }
                      })}
                    />
                  </div>
                </div>
              )}

              {editingItem.format === "sharegpt" && editingItem.sharegpt && (
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Messages JSON Grid</label>
                  <textarea
                    rows={8}
                    className="w-full text-xs border border-slate-200 font-mono rounded-md p-2 text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    value={JSON.stringify(editingItem.sharegpt.messages, null, 2)}
                    onChange={(e) => {
                      try {
                        const parsed = JSON.parse(e.target.value);
                        setEditingItem({
                          ...editingItem,
                          sharegpt: { messages: parsed }
                        });
                      } catch (err) {
                        // Let typing occur
                      }
                    }}
                  />
                </div>
              )}

              {editingItem.format === "qa" && editingItem.qa && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Question Content</label>
                    <textarea
                      rows={3}
                      className="w-full text-xs border border-slate-200 rounded-md p-2 text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      value={editingItem.qa.question}
                      onChange={(e) => setEditingItem({
                        ...editingItem,
                        qa: { ...editingItem.qa!, question: e.target.value }
                      })}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Answer Content</label>
                    <textarea
                      rows={5}
                      className="w-full text-xs border border-slate-200 rounded-md p-2 text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      value={editingItem.qa.answer}
                      onChange={(e) => setEditingItem({
                        ...editingItem,
                        qa: { ...editingItem.qa!, answer: e.target.value }
                      })}
                    />
                  </div>
                </div>
              )}

              {editingItem.format === "raw" && editingItem.raw && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Section Title</label>
                    <input
                      type="text"
                      className="w-full text-xs border border-slate-200 rounded-md py-1.5 px-2 text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      value={editingItem.raw.title}
                      onChange={(e) => setEditingItem({
                        ...editingItem,
                        raw: { ...editingItem.raw!, title: e.target.value }
                      })}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Text Passages</label>
                    <textarea
                      rows={7}
                      className="w-full text-xs border border-slate-200 rounded-md p-2 text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      value={editingItem.raw.text}
                      onChange={(e) => setEditingItem({
                        ...editingItem,
                        raw: { ...editingItem.raw!, text: e.target.value }
                      })}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pr-1 pt-3 border-t border-slate-100">
              <button
                onClick={() => setEditingItem(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 rounded"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg cursor-pointer shadow-sm shadow-indigo-600/10 transition-colors"
                id="save-edit-btn"
              >
                Save Polish
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
