import { Allotment } from 'allotment';
import TopBar from './TopBar';
import Sidebar from './Sidebar';
import EditorPanel from './EditorPanel';
import CanvasPanel from './CanvasPanel';
import ControlBar from './ControlBar';
import { useUIStore } from '@store/slices/uiSlice';

export default function MainLayout() {
  const { isSidebarOpen } = useUIStore();

  return (
    <div className="flex h-screen flex-col bg-[#e8ecef] dark:bg-slate-950">
      {/* Top Menu Bar */}
      <TopBar />

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden">
        <Allotment>
          {/* Left Sidebar (Collapsible) */}
          {isSidebarOpen && (
            <Allotment.Pane minSize={200} maxSize={400} preferredSize={250}>
              <Sidebar />
            </Allotment.Pane>
          )}

          {/* Center Editor Panel */}
          <Allotment.Pane minSize={300} preferredSize="25%">
            <EditorPanel />
          </Allotment.Pane>

          {/* Right Canvas Panel */}
          <Allotment.Pane minSize={400} preferredSize="60%">
            <CanvasPanel />
          </Allotment.Pane>
        </Allotment>
      </div>

      {/* Bottom Control Bar */}
      <ControlBar />
    </div>
  );
}