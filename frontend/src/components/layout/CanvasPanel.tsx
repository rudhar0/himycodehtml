import VisualizationCanvas from '@components/canvas/VisualizationCanvas';
import AstView from '../canvas/AstView';
import TokensView from '../canvas/TokensView';
import SymbolsView from '../canvas/SymbolsView';
import { ZoomIn, ZoomOut, Maximize2, Box, Share2, Binary, List } from 'lucide-react';
import { useCanvasStore } from '@store/slices/canvasSlice';
import { clsx } from 'clsx';

export default function CanvasPanel() {
  const { zoom, resetView, zoomIn, zoomOut, viewMode, setViewMode } = useCanvasStore();

  const tabs = [
    { id: 'canvas', label: 'Visualization Canvas', icon: Box },
    { id: 'ast', label: 'AST', icon: Share2 },
    { id: 'tokens', label: 'Tokens', icon: Binary },
    { id: 'symbols', label: 'Symbols', icon: List },
  ] as const;

  return (
    <div className="flex h-full flex-col bg-bg2">
      {/* Canvas Header — matches prototype .canvas-header */}
      <div className="flex items-center justify-between border-b border-bd bg-bg1 px-2"
           style={{ height: '34px' }}>
        
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setViewMode(tab.id as any)}
              className={clsx(
                "flex items-center gap-1.5 px-3 h-[28px] rounded-md text-[11px] font-medium transition-all relative group",
                viewMode === tab.id 
                  ? "bg-acc/10 text-acc" 
                  : "text-t3 hover:bg-bg3 hover:text-t2"
              )}
            >
              <tab.icon className={clsx("h-3.5 w-3.5", viewMode === tab.id ? "text-acc" : "text-t3 group-hover:text-t2")} />
              <span>{tab.label}</span>
              
              {viewMode === tab.id && (
                <div className="absolute -bottom-[3px] left-0 right-0 h-[2px] bg-acc rounded-t-sm animate-in slide-in-from-bottom-1 duration-200" />
              )}
            </button>
          ))}
        </div>

        {/* Canvas Controls — only visible for canvas and ast modes */}
        {(viewMode === 'canvas' || viewMode === 'ast') && (
          <div className="flex items-center gap-1 pr-2">
            <span className="text-[11px] font-mono text-t3 mr-1">
              {Math.round(zoom * 100)}%
            </span>

            <button
              onClick={zoomOut}
              className="flex items-center justify-center w-6 h-6 rounded hover:bg-bg3 transition-colors"
              title="Zoom Out"
            >
              <ZoomOut className="h-4 w-4 text-t3" />
            </button>

            <button
              onClick={zoomIn}
              className="flex items-center justify-center w-6 h-6 rounded hover:bg-bg3 transition-colors"
              title="Zoom In"
            >
              <ZoomIn className="h-4 w-4 text-t3" />
            </button>

            <button
              onClick={resetView}
              className="flex items-center justify-center w-6 h-6 rounded hover:bg-bg3 transition-colors"
              title="Reset View"
            >
              <Maximize2 className="h-4 w-4 text-t3" />
            </button>
          </div>
        )}
      </div>

      {/* View Area */}
      <div className="flex-1 overflow-hidden relative">
        {viewMode === 'canvas' && <VisualizationCanvas />}
        {viewMode === 'ast' && <AstView />}
        {viewMode === 'tokens' && <TokensView />}
        {viewMode === 'symbols' && <SymbolsView />}
      </div>
    </div>
  );
}