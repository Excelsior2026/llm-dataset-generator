import React, { useMemo } from "react";
import { SubtopicNode, DependencyEdge } from "../types";

interface KnowledgeGraphProps {
  nodes: SubtopicNode[];
  edges: DependencyEdge[];
  className?: string;
}

function computeLayout(
  nodes: SubtopicNode[],
  edges: DependencyEdge[]
): { x: number; y: number }[] {
  const positions: { x: number; y: number }[] = nodes.map((_, i) => {
    const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
    const radius = 180 + (nodes[i].level || 0) * 40;
    return { x: 200 + radius * Math.cos(angle), y: 150 + radius * Math.sin(angle) };
  });

  // Simple force-directed iterations
  for (let iter = 0; iter < 30; iter++) {
    const forces = positions.map(() => ({ fx: 0, fy: 0 }));

    // Repulsion between all nodes
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = positions[j].x - positions[i].x;
        const dy = positions[j].y - positions[i].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = 3000 / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        forces[i].fx -= fx;
        forces[i].fy -= fy;
        forces[j].fx += fx;
        forces[j].fy += fy;
      }
    }

    // Attraction along edges
    for (const edge of edges) {
      const fromIdx = nodes.findIndex((n) => n.id === edge.from);
      const toIdx = nodes.findIndex((n) => n.id === edge.to);
      if (fromIdx === -1 || toIdx === -1) continue;

      const dx = positions[toIdx].x - positions[fromIdx].x;
      const dy = positions[toIdx].y - positions[fromIdx].y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const force = dist / 30;
      forces[toIdx].fx -= (dx / dist) * force;
      forces[toIdx].fy -= (dy / dist) * force;
      forces[fromIdx].fx += (dx / dist) * force;
      forces[fromIdx].fy += (dy / dist) * force;
    }

    // Apply forces with damping
    for (let i = 0; i < nodes.length; i++) {
      positions[i].x += forces[i].fx * 0.1;
      positions[i].y += forces[i].fy * 0.1;
    }
  }

  return positions;
}

export default function KnowledgeGraph({ nodes, edges, className = "" }: KnowledgeGraphProps) {
  const layout = useMemo(() => computeLayout(nodes, edges), [nodes, edges]);

  if (!nodes || nodes.length === 0) return null;

  const svgWidth = 450;
  const svgHeight = 320;

  // Determine edge paths with arrow markers
  const edgePaths = edges
    .map((edge) => {
      const fromIdx = nodes.findIndex((n) => n.id === edge.from);
      const toIdx = nodes.findIndex((n) => n.id === edge.to);
      if (fromIdx === -1 || toIdx === -1) return null;

      const from = layout[fromIdx];
      const to = layout[toIdx];
      if (!from || !to) return null;

      return { from, to: { x: to.x, y: to.y }, key: `${edge.from}-${edge.to}` };
    })
    .filter(Boolean);

  return (
    <div className={`bg-white border border-slate-200 rounded-xl shadow-xs p-4 ${className}`}>
      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
        <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
        Knowledge Graph
      </h3>
      <svg width="100%" viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="bg-slate-50/50 rounded-lg border border-slate-100" style={{ maxHeight: svgHeight }}>
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
          </marker>
        </defs>

        {edgePaths.map((ep) =>
          ep ? (
            <line
              key={ep.key}
              x1={ep.from.x} y1={ep.from.y}
              x2={ep.to.x} y2={ep.to.y}
              stroke="#cbd5e1"
              strokeWidth={1.5}
              markerEnd="url(#arrowhead)"
            />
          ) : null
        )}

        {nodes.map((node, i) => {
          const pos = layout[i];
          if (!pos) return null;
          const levelColors = ["#4f46e5", "#7c3aed", "#a855f7", "#d946ef"];
          const color = levelColors[node.level] || "#64748b";

          return (
            <g key={node.id}>
              <circle cx={pos.x} cy={pos.y} r={18} fill="white" stroke={color} strokeWidth={2} />
              <circle cx={pos.x} cy={pos.y} r={5} fill={color} />
              <text
                x={pos.x}
                y={pos.y + 34}
                textAnchor="middle"
                fontSize={9}
                fill="#475569"
                fontWeight="600"
              >
                {node.label.length > 16 ? node.label.substring(0, 14) + ".." : node.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}