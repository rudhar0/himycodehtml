import React, { useMemo, useState } from 'react';
import { astService } from '@services/ast.service';
import { useEditorStore } from '@store/slices/editorSlice';
import { Search, Binary, X } from 'lucide-react';
import { clsx } from 'clsx';

const TokenTypeColors: Record<string, string> = {
  'keyword': 'text-[#C084FC]',
  'identifier': 'text-[#60A5FA]',
  'string_literal': 'text-[#34D399]',
  'system_lib_string': 'text-[#34D399]',
  'number_literal': 'text-[#FB923C]',
  'comment': 'text-t3 italic',
  'operator': 'text-[#F59E0B]',
  'punctuation': 'text-t2',
};

type FilterType = 'all' | 'keyword' | 'identifier' | 'literal';

export default function TokensView() {
  const { code } = useEditorStore();
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  const allTokens = useMemo(() => {
    return astService.getTokens(code);
  }, [code]);

  const filteredTokens = useMemo(() => {
    return allTokens.filter(token => {
      const matchesSearch = token.text.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           token.type.toLowerCase().includes(searchQuery.toLowerCase());
      
      if (!matchesSearch) return false;
      if (filterType === 'all') return true;
      if (filterType === 'keyword') return token.type === 'keyword';
      if (filterType === 'identifier') return token.type === 'identifier';
      if (filterType === 'literal') return token.type.includes('literal') || token.type.includes('string');
      
      return true;
    });
  }, [allTokens, filterType, searchQuery]);

  return (
    <div className="flex flex-col h-full bg-bg2 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-bd bg-bg1 flex-shrink-0">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-t3" />
          <input 
            type="text" 
            placeholder="Filter tokens..." 
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
            { id: 'keyword', label: 'Keywords' },
            { id: 'identifier', label: 'Identifiers' },
            { id: 'literal', label: 'Literals' }
          ].map(f => (
            <button 
              key={f.id}
              onClick={() => setFilterType(f.id as FilterType)}
              className={clsx(
                "px-2 py-1 rounded border text-[10px] font-bold uppercase tracking-wider transition-all",
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
          {filteredTokens.length} {filteredTokens.length === 1 ? 'token' : 'tokens'}
        </span>
      </div>

      {/* Token List */}
      <div className="flex-1 overflow-auto p-4">
        <div className="grid gap-1.5 auto-rows-max">
          {filteredTokens.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-t3 opacity-50">
              <Binary className="h-10 w-10 mb-2" />
              <p className="text-sm font-medium">{allTokens.length === 0 ? 'No tokens found' : 'No matches found'}</p>
              <p className="text-xs">{allTokens.length === 0 ? 'Try writing some code in the editor' : 'Adjust your search or filter'}</p>
            </div>
          ) : (
            filteredTokens.map((token, idx) => {
              const colorClass = TokenTypeColors[token.type] || 'text-t1';
              return (
                <div key={idx} className="grid grid-cols-[40px_110px_1fr_90px] gap-0 border border-bd rounded overflow-hidden font-mono text-[11px] hover:border-bd2 transition-colors group">
                  <div className="bg-bg0 px-2 py-1.5 text-t3 text-right border-r border-bd group-hover:bg-bg1">
                    {token.startPosition.row + 1}
                  </div>
                  <div className={clsx("bg-bg1 px-3 py-1.5 font-bold border-r border-bd truncate uppercase text-[9px]", colorClass)}>
                    {token.type.replace(/_/g, ' ')}
                  </div>
                  <div className={clsx("bg-bg1 px-3 py-1.5 truncate flex-1", colorClass)}>
                    {token.text}
                  </div>
                  <div className="bg-bg1 px-3 py-1.5 text-t3 text-right border-l border-bd text-[10px]">
                    {token.startPosition.row + 1}:{token.startPosition.column + 1}
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

