/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { SearchResultSummary } from "../types";
import { Search, Globe, ChevronDown, ChevronUp, BookOpen, Layers } from "lucide-react";
import KnowledgeGraph from "./KnowledgeGraph";

interface ResearchSourcesProps {
  summary: SearchResultSummary;
}

export default function ResearchSources({ summary }: ResearchSourcesProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (!summary) return null;

  return (
    <div id="research-info" className="bg-white border border-slate-200 rounded-xl shadow-xs p-5 transition-all">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
        <div>
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest" id="header-research">
            Foundational Research
          </h2>
          <p className="text-[11px] text-slate-500 mt-1" id="sub-research">
            Topic grounded using Google Search
          </p>
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-50 transition-colors"
          id="btn-toggle-research"
        >
          {isExpanded ? <ChevronUp className="w-4.5 h-4.5" /> : <ChevronDown className="w-4.5 h-4.5" />}
        </button>
      </div>

      {isExpanded && (
        <div className="space-y-4">
          {/* Research text */}
          <div className="prose prose-slate max-w-none">
            <h3 className="text-sm font-semibold text-slate-800 tracking-tight capitalize" id="research-title">
              {summary.topic}
            </h3>
            
            <div className="mt-2 text-sm text-slate-600 leading-relaxed max-h-60 overflow-y-auto pr-2 bg-slate-50 rounded-lg p-3.5 border border-slate-100">
              {summary.researchSummary.split("\n\n").map((par, i) => (
                <p key={i} className={i > 0 ? "mt-3" : ""}>
                   {par}
                </p>
              ))}
            </div>
          </div>

          {/* Subtopics */}
          {summary.subtopics && summary.subtopics.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Layers className="w-3.5 h-3.5 text-slate-450" />
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest" id="lbl-subtopics">
                  Identified Subtopics
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5" id="subtopic-pills">
                {summary.subtopics.map((sub, idx) => (
                  <span
                    key={idx}
                    className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded-full font-medium transition-colors cursor-default border border-slate-200"
                  >
                    {sub}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Sources */}
          {summary.sources && summary.sources.length > 0 && (
            <div className="border-t border-slate-100 pt-3 mt-2">
              <div className="flex items-center gap-1.5 mb-2">
                <Globe className="w-3.5 h-3.5 text-slate-450" />
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest" id="lbl-sources">
                  Verified Citations ({summary.sources.length})
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" id="grid-sources">
                {summary.sources.map((src, idx) => (
                  <a
                    key={idx}
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-xs bg-slate-50 hover:bg-slate-100 border border-slate-200 p-2.5 rounded-lg text-slate-700 font-medium transition-all group overflow-hidden max-w-full"
                    title={src.title}
                  >
                    <BookOpen className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <div className="truncate shrink">
                      <p className="font-semibold group-hover:underline truncate">{src.title}</p>
                      <p className="text-[10px] text-slate-450 truncate">{src.url}</p>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Knowledge Graph */}
          {summary.knowledgeGraph && summary.knowledgeGraph.nodes && summary.knowledgeGraph.nodes.length > 0 && (
            <div className="pt-3 mt-2">
              <KnowledgeGraph
                nodes={summary.knowledgeGraph.nodes}
                edges={summary.knowledgeGraph.edges}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
