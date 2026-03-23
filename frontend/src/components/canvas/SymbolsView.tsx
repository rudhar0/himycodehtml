import React, { useMemo, useState } from 'react';
import { astService } from '@services/ast.service';
import { useEditorStore } from '@store/slices/editorSlice';
import { Search, Code, Variable, Layers, Hash, X, Filter } from 'lucide-react';
import { clsx } from 'clsx';

const SymbolStyles: Record<string, { icon: any, color: string, bg: string, border: string }> = {
  function: { icon: Code, color: 'text-violet-400', bg: 'bg-violet-400/10', border: 'border-violet-400/20' },
  variable: { icon: Variable, color: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/20' },
  field: { icon: Hash, color: 'text-cyan-400', bg: 'bg-cyan-400/10', border: 'border-cyan-400/20' },
  struct: { icon: Layers, color: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/20' },
  class: { icon: Layers, color: 'text-pink-400', bg: 'bg-pink-400/10', border: 'border-pink-400/20' },
  enum: { icon: Layers, color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/20' },
};

type FilterType = 'all' | 'function' | 'variable' | 'type';

export default function SymbolsView() {
  const { code } = useEditorStore();
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  const allSymbols = useMemo(() => {
    return astService.getSymbols(code);
  }, [code]);

  const filteredSymbols = useMemo(() => {
    return allSymbols.filter(symbol => {
      const matchesSearch = symbol.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           symbol.signature.toLowerCase().includes(searchQuery.toLowerCase());
      
      if (!matchesSearch) return false;
      if (filterType === 'all') return true;
      if (filterType === 'function') return symbol.kind === 'function';
      if (filterType === 'variable') return symbol.kind === 'variable' || symbol.kind === 'field';
      if (filterType === 'type') return ['struct', 'class', 'enum'].includes(symbol.kind);
      
      return true;
    });
  }, [allSymbols, filterType, searchQuery]);

  return (
    <div className="flex flex-col h-full bg-bg2 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-bd bg-bg1 flex-shrink-0">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-t3" />
          <input 
            type="text" 
            placeholder="Search symbols..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-bg3 border border-bd rounded-md pl-9 pr-8 py-1.5 text-[11px] text-t1 outline-none focus:border-acc transition-colors font-mono"
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-t3 hover:text-t1 transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        
        <div className="flex items-center gap-1">
          {[
            { id: 'all', label: 'All' },
            { id: 'function', label: 'Functions' },
            { id: 'variable', label: 'Variables' },
            { id: 'type', label: 'Types' }
          ].map(f => (
            <button 
              key={f.id}
              onClick={() => setFilterType(f.id as FilterType)}
              className={clsx(
                "px-2.5 py-1 rounded border text-[10px] font-bold uppercase tracking-wider transition-all",
                filterType === f.id 
                  ? "bg-acc/10 border-acc text-acc" 
                  : "hover:bg-bg3 border-bd text-t3"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        
        <span className="text-[11px] text-t3 font-medium ml-auto">
          {filteredSymbols.length} {filteredSymbols.length === 1 ? 'symbol' : 'symbols'}
        </span>
      </div>

      {/* Symbol Table Header */}
      <div className="grid grid-cols-[45px_100px_160px_1fr] gap-0 bg-bg1 border-b border-bd px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-t3 select-none">
        <div>Line</div>
        <div>Kind</div>
        <div>Name</div>
        <div>Signature / Type</div>
      </div>

      {/* Symbol List */}
      <div className="flex-1 overflow-auto p-4 pt-2">
        <div className="grid gap-1.5 auto-rows-max">
          {filteredSymbols.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-t3 opacity-50">
              <Code className="h-10 w-10 mb-2" />
              <p className="text-sm font-medium">{allSymbols.length === 0 ? 'No symbols found' : 'No matches found'}</p>
              <p className="text-xs">{allSymbols.length === 0 ? 'Symbols like functions and classes will appear here' : 'Adjust your search or filter'}</p>
            </div>
          ) : (
            filteredSymbols.map((symbol, idx) => {
              const style = SymbolStyles[symbol.kind] || SymbolStyles.variable;
              const Icon = style.icon;
              
              return (
                <div key={idx} className="grid grid-cols-[45px_100px_160px_1fr] gap-0 border border-bd rounded-lg overflow-hidden font-mono text-[11px] hover:border-bd2 transition-all group hover:bg-bg1/40">
                  <div className="bg-bg0/30 px-3 py-2.5 text-t3 text-right border-r border-bd group-hover:bg-bg0/60 transition-colors">
                    {symbol.line}
                  </div>
                  <div className={clsx("px-3 py-2.5 flex items-center gap-1.5 border-r border-bd font-bold truncate uppercase text-[9px]", style.color, style.bg)}>
                    <Icon className="h-3 w-3" />
                    {symbol.kind}
                  </div>
                  <div className="px-4 py-2.5 font-bold text-t1 truncate border-r border-bd">
                    {symbol.name}
                  </div>
                  <div className="px-4 py-2.5 text-t2 truncate italic text-[10px]">
                    {symbol.signature}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
