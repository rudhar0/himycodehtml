import { Globe, SquareFunction, Box, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useExecutionStore } from '@store/slices/executionSlice';
import { useCanvasStore } from '@store/slices/canvasSlice';
import { COLORS } from '@config/theme.config';
  
export default function SymbolNavigator() {
  const { executionTrace } = useExecutionStore();
  const { selectElement } = useCanvasStore();
  const [expandedSections, setExpandedSections] = useState({
    globals: true,
    functions: true,
  });

  const [globals, setGlobals] = useState<Record<string, any>>({});
  const [functions, setFunctions] = useState<string[]>([]);

  useEffect(() => {
    if (executionTrace) {
      // Use the top-level globals and functions from the trace object
      const traceGlobals = executionTrace.globals || [];
      const formattedGlobals = traceGlobals.reduce((acc, globalVar) => {
        acc[globalVar.name] = { type: globalVar.type, value: globalVar.value };
        return acc;
      }, {} as Record<string, any>);
      setGlobals(formattedGlobals);

      const traceFunctions = executionTrace.functions || [];
      setFunctions(traceFunctions.map(f => f.name));
    } else {
      setGlobals({});
      setFunctions([]);
    }
  }, [executionTrace]);

  const toggleSection = (section: 'globals' | 'functions') => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const handleSymbolClick = (symbolName: string, _type: 'global' | 'function') => {
    selectElement(symbolName);
    // TODO: Highlight in canvas and center view
  };

  if (!executionTrace || !executionTrace.steps || executionTrace.steps.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="text-center text-sm text-[#5a6a7a] dark:text-slate-500">
          <Box className="mx-auto mb-2 h-8 w-8 opacity-50" />
          <p>No symbols available</p>
          <p className="mt-1 text-xs">Run code to see symbols</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-3">
      {/* Globals Section */}
      <div className="mb-4">
        <button
          onClick={() => toggleSection('globals')}
          className="mb-2 flex w-full items-center gap-2 rounded px-2 py-1 hover:bg-[#c8d0d8] dark:hover:bg-slate-800 transition-colors"
        >
          <ChevronRight
            className={`h-4 w-4 text-[#8a9aaa] dark:text-slate-400 transition-transform ${
              expandedSections.globals ? 'rotate-90' : ''
            }`}
          />
          <Globe className="h-4 w-4" style={{ color: COLORS.memory.global.DEFAULT }} />
          <span className="text-sm font-semibold text-[#1a2332] dark:text-slate-200">
            Global Variables
          </span>
          <span className="ml-auto text-xs text-[#5a6a7a] dark:text-slate-500">
            {Object.keys(globals).length}
          </span>
        </button>

        {expandedSections.globals && (
          <div className="ml-6 space-y-1">
            {Object.entries(globals).map(([name, variable]: [string, any]) => (
              <button 
                key={name}
                onClick={() => handleSymbolClick(name, 'global')}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-[#c8d0d8] dark:hover:bg-slate-800 transition-colors group"
              >
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: COLORS.memory.global.DEFAULT }}
                />
                <span className="text-sm text-[#5a6a7a] dark:text-slate-300 group-hover:text-[#1a2332] dark:group-hover:text-white">
                  {name}
                </span>
                <span className="ml-auto text-xs text-[#8a9aaa] dark:text-slate-500">
                  {variable.type}
                </span>
              </button>
            ))}
            {Object.keys(globals).length === 0 && (
              <div className="px-2 py-1 text-xs text-[#8a9aaa] dark:text-slate-500">
                No global variables
              </div>
            )}
          </div>
        )}
      </div>

      {/* Functions Section */}
      <div>
        <button
          onClick={() => toggleSection('functions')}
          className="mb-2 flex w-full items-center gap-2 rounded px-2 py-1 hover:bg-[#c8d0d8] dark:hover:bg-slate-800 transition-colors"
        >
          <ChevronRight
            className={`h-4 w-4 text-[#8a9aaa] dark:text-slate-400 transition-transform ${
              expandedSections.functions ? 'rotate-90' : ''
            }`}
          />
          <SquareFunction className="h-4 w-4" style={{ color: COLORS.memory.stack.DEFAULT }} />
          <span className="text-sm font-semibold text-[#1a2332] dark:text-slate-200">
            Functions
          </span>
          <span className="ml-auto text-xs text-[#5a6a7a] dark:text-slate-500">
            {functions.length}
          </span>
        </button>

        {expandedSections.functions && (
          <div className="ml-6 space-y-1">
            {functions.map((funcName) => (
              <button 
                key={funcName}
                onClick={() => handleSymbolClick(funcName, 'function')}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-[#c8d0d8] dark:hover:bg-slate-800 transition-colors group"
              >
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: COLORS.memory.stack.DEFAULT }}
                />
                <span className="text-sm text-[#5a6a7a] dark:text-slate-300 group-hover:text-[#1a2332] dark:group-hover:text-white">
                  {funcName}()
                </span>
                {funcName === 'main' && (
                  <span className="ml-auto text-xs text-blue-600 dark:text-blue-400 font-medium">
                    entry
                  </span>
                )}
              </button>
            ))}
            {functions.length === 0 && (
              <div className="px-2 py-1 text-xs text-[#8a9aaa] dark:text-slate-500">
                No functions
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}