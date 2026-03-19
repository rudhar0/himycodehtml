import VisualizationCanvas from '@components/canvas/VisualizationCanvas';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { useCanvasStore } from '@store/slices/canvasSlice';

export default function CanvasPanel() {
  const { zoom, resetView, zoomIn, zoomOut } = useCanvasStore();

  return (
    <div className="flex h-full flex-col bg-bg2">
      {/* Canvas Header — matches prototype .canvas-header */}
      <div className="flex items-center justify-between border-b border-bd bg-bg1 px-4"
           style={{ height: '34px' }}>
        <span className="text-xs font-medium text-t1">Visualization Canvas</span>

        {/* Canvas Controls */}
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-t3 mr-1">
            {Math.round(zoom * 100)}%
          </span>

          <button
            onClick={zoomOut}
            className="flex items-center justify-center w-5 h-5 hover:opacity-70 transition-opacity"
            title="Zoom Out"
          >
            <ZoomOut className="h-4 w-4 text-t3" />
          </button>

          <button
            onClick={zoomIn}
            className="flex items-center justify-center w-5 h-5 hover:opacity-70 transition-opacity"
            title="Zoom In"
          >
            <ZoomIn className="h-4 w-4 text-t3" />
          </button>

          <button
            onClick={resetView}
            className="flex items-center justify-center w-5 h-5 hover:opacity-70 transition-opacity"
            title="Reset View"
          >
            <Maximize2 className="h-4 w-4 text-t3" />
          </button>
        </div>
      </div>

      {/* Canvas Area */}
      <div className="flex-1 overflow-hidden">
        <VisualizationCanvas />
      </div>
    </div>
  );
}