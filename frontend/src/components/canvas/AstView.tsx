import React, { useEffect, useState, useMemo, useRef } from 'react';
import ELK, { ElkNode, ElkExtendedEdge } from 'elkjs/lib/elk.bundled.js';
import { astService } from '@services/ast.service';
import { useEditorStore } from '@store/slices/editorSlice';
import { clsx } from 'clsx';
import { Search, RotateCcw, ChevronDown, ChevronUp, MousePointer2, Zap } from 'lucide-react';

const elk = new ELK();

interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

interface CustomElkNode extends ElkNode {
  properties: {
    type: string;
    text: string;
    row: number;
    col: number;
  };
  children?: CustomElkNode[];
}

const NodeCategoryStyles: Record<string, { bg: string, border: string, header: string, text: string, glow: string }> = {
  // Declarations: Emerald/Teal
  'function_definition': { bg: 'bg-emerald-500/5', border: 'border-emerald-500/30', header: 'bg-gradient-to-r from-emerald-500 to-teal-500', text: 'text-emerald-400', glow: 'shadow-emerald-500/20' },
  'parameter_declaration': { bg: 'bg-teal-500/5', border: 'border-teal-500/30', header: 'bg-gradient-to-r from-teal-500 to-cyan-500', text: 'text-teal-400', glow: 'shadow-teal-500/20' },
  'variable_declaration': { bg: 'bg-cyan-500/5', border: 'border-cyan-500/30', header: 'bg-gradient-to-r from-cyan-500 to-blue-500', text: 'text-cyan-400', glow: 'shadow-cyan-500/20' },
  'declaration': { bg: 'bg-emerald-500/5', border: 'border-emerald-500/30', header: 'bg-gradient-to-r from-emerald-500 to-teal-500', text: 'text-emerald-400', glow: 'shadow-emerald-500/20' },
  
  // Expressions: Violet/Amber
  'call_expression': { bg: 'bg-violet-500/5', border: 'border-violet-500/30', header: 'bg-gradient-to-r from-violet-500 to-purple-500', text: 'text-violet-400', glow: 'shadow-violet-500/20' },
  'binary_expression': { bg: 'bg-purple-500/5', border: 'border-purple-500/30', header: 'bg-gradient-to-r from-purple-500 to-fuchsia-500', text: 'text-purple-400', glow: 'shadow-purple-500/20' },
  'identifier': { bg: 'bg-blue-500/5', border: 'border-blue-500/30', header: 'bg-gradient-to-r from-blue-500 to-indigo-500', text: 'text-blue-400', glow: 'shadow-blue-500/20' },
  'number_literal': { bg: 'bg-amber-500/5', border: 'border-amber-500/30', header: 'bg-gradient-to-r from-amber-500 to-orange-500', text: 'text-amber-400', glow: 'shadow-amber-500/20' },
  'string_literal': { bg: 'bg-orange-500/5', border: 'border-orange-500/30', header: 'bg-gradient-to-r from-orange-500 to-rose-500', text: 'text-orange-400', glow: 'shadow-orange-500/20' },
  
  // Statements: Rose/Indigo
  'compound_statement': { bg: 'bg-slate-500/5', border: 'border-slate-500/30', header: 'bg-gradient-to-r from-slate-500 to-slate-600', text: 'text-slate-400', glow: 'shadow-slate-500/10' },
  'return_statement': { bg: 'bg-rose-500/5', border: 'border-rose-500/30', header: 'bg-gradient-to-r from-rose-500 to-pink-500', text: 'text-rose-400', glow: 'shadow-rose-500/20' },
  'if_statement': { bg: 'bg-indigo-500/5', border: 'border-indigo-500/30', header: 'bg-gradient-to-r from-indigo-500 to-blue-600', text: 'text-indigo-400', glow: 'shadow-indigo-500/20' },
  'for_statement': { bg: 'bg-indigo-500/5', border: 'border-indigo-500/30', header: 'bg-gradient-to-r from-indigo-500 to-blue-600', text: 'text-indigo-400', glow: 'shadow-indigo-500/20' },
};

const DefaultStyle = { bg: 'bg-bg1', border: 'border-bd', header: 'bg-bg2', text: 'text-t2', glow: 'shadow-xl' };

export default function AstView() {
  const { code } = useEditorStore();
  const [layout, setLayout] = useState<CustomElkNode | null>(null);
  const [viewport, setViewport] = useState<ViewportState>({ x: 50, y: 50, zoom: 0.8 });
  const [selectedNode, setSelectedNode] = useState<any | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastMousePos = useRef<{ x: number, y: number } | null>(null);

  // Fix whole-app zoom issue by using a non-passive wheel listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleRawWheel = (e: WheelEvent) => {
      // Always prevent default in the AST area if we want to handle zoom ourselves
      e.preventDefault();
      
      const delta = e.deltaY > 0 ? 0.92 : 1.08;
      setViewport(prev => ({
        ...prev,
        zoom: Math.max(0.05, Math.min(4, prev.zoom * delta))
      }));
    };

    container.addEventListener('wheel', handleRawWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleRawWheel);
  }, []);

  useEffect(() => {
    const tree = astService.parse(code);
    if (!tree) return;

    const nodes: CustomElkNode[] = [];
    const edges: ElkExtendedEdge[] = [];

    const traverse = (node: any) => {
      nodes.push({
        id: node.id.toString(),
        width: 140, // Slightly wider for better text fit
        height: 60, // Slightly taller
        properties: {
          type: node.type,
          text: node.text.length > 20 ? node.text.substring(0, 17) + '...' : node.text,
          row: node.startPosition.row,
          col: node.startPosition.column,
        }
      });

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        edges.push({
          id: `e-${node.id}-${child.id}`,
          sources: [node.id.toString()],
          targets: [child.id.toString()],
        } as ElkExtendedEdge);
        traverse(child);
      }
    };

    traverse(tree.rootNode);
    
    const graph: ElkNode = {
      id: 'root',
      children: nodes,
      edges: edges
    };
    
    elk.layout(graph, {
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'DOWN',
        'elk.spacing.nodeNode': '40',
        'elk.layered.spacing.nodeNodeLayered': '65',
        'elk.padding': '[top=50,left=50,bottom=50,right=50]',
      }
    }).then((res) => setLayout(res as CustomElkNode)).catch(console.error);
  }, [code]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsPanning(true);
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning && lastMousePos.current) {
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      setViewport(prev => ({
        ...prev,
        x: prev.x + dx,
        y: prev.y + dy
      }));
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    lastMousePos.current = null;
  };

  const resetView = () => {
    setViewport({ x: 50, y: 50, zoom: 0.8 });
  };

  return (
    <div 
      ref={containerRef}
      className="w-full h-full bg-bg0 relative overflow-hidden cursor-grab active:cursor-grabbing"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Grid Pattern */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-[0.05]"
        style={{
          backgroundImage: `radial-gradient(circle, #8b5cf6 1px, transparent 1px)`,
          backgroundSize: '24px 24px',
          transform: `translate(${viewport.x % 24}px, ${viewport.y % 24}px)`
        }}
      />

      {/* Toolbar */}
      <div className="absolute top-3 left-3 right-3 flex items-center gap-2 pointer-events-none z-10">
        <div className="bg-bg1/80 backdrop-blur-md border border-bd rounded-lg px-3 py-1.5 flex items-center gap-3 shadow-xl pointer-events-auto select-none">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded bg-acc/20">
              <Zap className="h-3 w-3 text-acc" />
            </div>
            <span className="text-[11px] font-black text-t1 uppercase tracking-wider whitespace-nowrap">AST Structure</span>
          </div>
          <div className="h-3 w-px bg-bd" />
          <span className="text-[10px] text-t3 font-mono opacity-80">P: ({Math.round(viewport.x)}, {Math.round(viewport.y)}) Z: {Math.round(viewport.zoom * 100)}%</span>
        </div>
        
        <div className="flex items-center gap-1 pointer-events-auto">
          <button onClick={resetView} className="p-1.5 bg-bg1/80 backdrop-blur-md border border-bd rounded-md text-t3 hover:text-t1 transition-all shadow-lg active:scale-95" title="Reset View">
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex-1" />

        <div className="bg-bg1/80 backdrop-blur-md border border-bd rounded-full px-4 py-1.5 text-[9px] font-bold text-t3/80 shadow-xl pointer-events-none uppercase tracking-widest flex items-center gap-2">
          <MousePointer2 className="h-2.5 w-2.5" />
          Drag to Pan · Scroll to Zoom
        </div>
      </div>

      {/* Stage */}
      <div 
        className="absolute w-full h-full"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          transformOrigin: '0 0',
          transition: isPanning ? 'none' : 'transform 0.1s ease-out'
        }}
      >
        {layout && <TreeRender node={layout} onSelect={setSelectedNode} selectedId={selectedNode?.id} />}
      </div>

      {/* Node Inspector */}
      {selectedNode && (
        <div className="absolute bottom-4 left-4 w-64 bg-bg1/90 backdrop-blur-xl border border-bd/50 rounded-2xl p-4 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-300 z-20 overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 via-violet-500 to-rose-500" />
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[9px] font-black text-t3 uppercase tracking-[0.2em]">Node Inspector</h3>
            <button onClick={() => setSelectedNode(null)} className="text-t3 hover:text-red-400 transition-colors bg-bg2 rounded p-0.5">
              <ChevronDown className="h-3 w-3" />
            </button>
          </div>
          <div className="space-y-3">
            <div className="flex flex-col gap-1">
              <span className="text-[8px] text-t3 font-black uppercase tracking-wider opacity-60">Type</span>
              <span className="text-[11px] text-acc font-mono font-black truncate bg-acc/5 px-2 py-1 rounded border border-acc/20 tracking-tight">{(selectedNode as any).properties.type}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[8px] text-t3 font-black uppercase tracking-wider opacity-60">Value / Token</span>
              <div className="text-[12px] text-t1 font-mono break-all bg-bg0/80 p-2.5 rounded-lg border border-bd/50 leading-relaxed max-h-32 overflow-auto shadow-inner">{(selectedNode as any).properties.text}</div>
            </div>
            <div className="flex items-center gap-4 pt-1">
              <div className="flex flex-col gap-0.5">
                <span className="text-[8px] text-t3 font-black uppercase tracking-wider opacity-60">Line</span>
                <span className="text-[11px] text-t2 font-mono font-bold">{(selectedNode as any).properties.row + 1}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[8px] text-t3 font-black uppercase tracking-wider opacity-60">Column</span>
                <span className="text-[11px] text-t2 font-mono font-bold">{(selectedNode as any).properties.col + 1}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TreeRender({ node, onSelect, selectedId }: { node: CustomElkNode, onSelect: (n: any) => void, selectedId?: string }) {
  return (
    <>
      {/* Edges */}
      <svg className="absolute inset-0 pointer-events-none overflow-visible">
        <defs>
          <linearGradient id="edge-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#ec4899" stopOpacity="0.1" />
          </linearGradient>
          <marker id="ast-arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orientation="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#8b5cf6" opacity="0.4" />
          </marker>
        </defs>
        {node.edges?.map(edge => {
          const source = node.children?.find(c => c.id === edge.sources[0]);
          const target = node.children?.find(c => c.id === edge.targets[0]);
          if (!source || !target) return null;
          
          const sX = (source.x || 0) + (source.width || 0) / 2;
          const sY = (source.y || 0) + (source.height || 0);
          const tX = (target.x || 0) + (target.width || 0) / 2;
          const tY = (target.y || 0);
          
          const cY = sY + (tY - sY) * 0.5;
          
          return (
            <path 
              key={edge.id}
              d={`M ${sX} ${sY} C ${sX} ${cY}, ${tX} ${cY}, ${tX} ${tY}`}
              stroke="url(#edge-gradient)"
              strokeWidth="1.5"
              fill="none"
              markerEnd="url(#ast-arrowhead)"
              className="transition-all duration-300"
            />
          );
        })}
      </svg>

      {/* Nodes */}
      {node.children?.map(child => {
        const type = child.properties.type;
        const style = NodeCategoryStyles[type] || (type.includes('expression') ? NodeCategoryStyles['call_expression'] : (type.includes('statement') ? NodeCategoryStyles['compound_statement'] : DefaultStyle));
        const isSelected = selectedId === child.id;

        return (
          <div 
            key={child.id}
            className="absolute transition-all duration-200"
            style={{ 
              left: child.x, 
              top: child.y, 
              width: child.width, 
              height: child.height 
            }}
          >
            <div 
              onClick={(e) => { e.stopPropagation(); onSelect(child); }}
              className={clsx(
                "w-full h-full rounded-xl border transition-all duration-200  group cursor-pointer overflow-hidden",
                style.bg,
                style.border,
                style.glow,
                isSelected 
                  ? "scale-105 ring-2 ring-acc/50 shadow-2xl z-10 brightness-110" 
                  : "hover:-translate-y-1 hover:brightness-105"
              )}
            >
              {/* Header */}
              <div className={clsx(
                "px-2.5 py-1.5 flex items-center gap-1.5",
                style.header
              )}>
                <div className="h-1.5 w-1.5 rounded-full bg-white shadow-sm" />
                <span className="text-[8px] font-black text-white/95 uppercase tracking-[0.15em] truncate">
                  {type.replace(/_/g, ' ')}
                </span>
              </div>
              
              {/* Body */}
              <div className="p-2.5 flex flex-col justify-center min-h-[35px]">
                <span className={clsx("text-[10px] font-mono font-black truncate", style.text)}>
                  {child.properties.text || '∅'}
                </span>
                <div className="flex items-center gap-2 mt-0.5 opacity-50">
                  <span className="text-[7px] font-mono text-t3 uppercase tracking-tighter">Line {child.properties.row + 1}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
