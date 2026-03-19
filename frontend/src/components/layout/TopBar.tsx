import { useMemo, useState } from 'react';
import { Menu, Play, Settings, Sun, Moon } from 'lucide-react';
import { useUIStore } from '@store/slices/uiSlice';
import { useExecutionStore } from '@store/slices/executionSlice';
import { useEditorStore } from '@store/slices/editorSlice';
import { useThemeStore } from '@store/slices/themeSlice';
import { useSocket } from '@hooks/useSocket';
import FileLoader from '@components/editor/FileLoader';
import { APP_CONFIG } from '@config/app.config';
import SequentialInputDialog from '@components/modals/SequentialInputDialog';
import {
  InputRequirement,
  defaultInputValue,
  detectInputRequirements,
} from '@utils/inputRequirements';
import { ensureInputDialogHost } from '@utils/inputDialogHost';

type PendingInputState = {
  code: string;
  language: 'c' | 'cpp';
  requirements: InputRequirement[];
  values: string[];
  entered: Array<{ variable: string; value: string; type: 'int' | 'float' | 'char' | 'string' }>;
  index: number;
};

export default function TopBar() {
  const { isSidebarOpen, toggleSidebar } = useUIStore();
  const { isAnalyzing } = useExecutionStore();
  const { code } = useEditorStore();
  const { theme, toggleTheme } = useThemeStore();
  const { generateTrace, isConnected } = useSocket();
  const [pendingInput, setPendingInput] = useState<PendingInputState | null>(null);

  const runTrace = (runCode: string, language: 'c' | 'cpp', inputs: Array<string | number>) => {
    generateTrace(runCode, language, inputs);
  };

  const handleRun = () => {
    if (!code.trim()) return;
    if (!isConnected) { alert('Not connected to server'); return; }
    const language: 'c' | 'cpp' = code.includes('iostream') || code.includes('std::') ? 'cpp' : 'c';
    const requirements = detectInputRequirements(code);
    if (requirements.length === 0) { runTrace(code, language, []); return; }
    if (!ensureInputDialogHost()) {
      runTrace(code, language, requirements.map((req) => defaultInputValue(req.type)));
      return;
    }
    setPendingInput({ code, language, requirements, values: [], entered: [], index: 0 });
  };

  const currentRequirement = useMemo(() => {
    if (!pendingInput) return null;
    return pendingInput.requirements[pendingInput.index] || null;
  }, [pendingInput]);

  const submitInputValue = (value: string) => {
    setPendingInput((prev) => {
      if (!prev) return prev;
      const req = prev.requirements[prev.index];
      const values = [...prev.values, value];
      const entered = [...prev.entered, { variable: req.variable, value, type: req.type }];
      const nextIndex = prev.index + 1;
      if (nextIndex >= prev.requirements.length) { runTrace(prev.code, prev.language, values); return null; }
      return { ...prev, values, entered, index: nextIndex };
    });
  };

  const backInputStep = () => {
    setPendingInput((prev) => {
      if (!prev || prev.index <= 0) return prev;
      return { ...prev, index: prev.index - 1, values: prev.values.slice(0, -1), entered: prev.entered.slice(0, -1) };
    });
  };

  const cancelInputDialog = () => {
    setPendingInput((prev) => {
      if (!prev) return prev;
      runTrace(prev.code, prev.language, prev.requirements.map((req) => defaultInputValue(req.type)));
      return null;
    });
  };

  return (
    /**
     * Prototype titlebar layout:
     * [logo-icon logo-text]   ──flex-1 spacer──   [Run] [OpenFile] [Divider] [Connected] [☀] [⚙]
     */
    <div className="flex h-11 items-center border-b border-bd bg-bg1 px-3 flex-shrink-0">

      {/* ── LEFT: Sidebar Toggle + Logo ── */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleSidebar}
          className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-bg3 transition-colors"
          title={isSidebarOpen ? 'Hide Sidebar' : 'Show Sidebar'}
        >
          <Menu className="h-4 w-4 text-t2" />
        </button>

        <div className="flex items-center gap-2">
          <div
            className="flex h-[22px] w-[22px] items-center justify-center rounded-md flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #7C3AED, #4F46E5)' }}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <path d="M4 3.5L8.5 7L4 10.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="10.5" cy="7" r="1.5" fill="#9F67FF"/>
            </svg>
          </div>
          <div className="flex flex-col gap-px">
            <span className="text-[14px] font-semibold leading-none text-t1">{APP_CONFIG.name}</span>
            <span className="text-[10px] leading-none text-t3">{APP_CONFIG.tagline}</span>
          </div>
        </div>
      </div>

      {/* ── SPACER ── */}
      <div className="flex-1" />

      {/* ── RIGHT: Run + File + Status + Utils ── */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleRun}
          disabled={!code.trim() || isAnalyzing || !isConnected}
          className="flex items-center gap-1.5 rounded-lg bg-acc2 px-4 py-[5px] text-xs font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          style={{ animation: 'runPulse 2s infinite' }}
        >
          <Play className="h-3 w-3 fill-white" />
          {isAnalyzing ? 'Analyzing...' : 'Run'}
        </button>

        <FileLoader />

        <div className="w-px h-5 bg-bd mx-1 flex-shrink-0" />

        <div className="flex items-center gap-1.5 px-1">
          <div
            className={`h-[7px] w-[7px] rounded-full flex-shrink-0 ${isConnected ? 'bg-acc2' : 'bg-red-500'}`}
            style={{ animation: 'breathe 2s infinite' }}
          />
          <span className={`text-[11px] font-medium ${isConnected ? 'text-acc2' : 'text-red-500'}`}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        <button
          onClick={toggleTheme}
          className="flex items-center justify-center w-7 h-7 hover:opacity-70 transition-opacity"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="h-[18px] w-[18px] text-t3" /> : <Moon className="h-[18px] w-[18px] text-t3" />}
        </button>

        <button
          className="flex items-center justify-center w-7 h-7 hover:opacity-70 transition-opacity"
          title="Settings"
        >
          <Settings className="h-[18px] w-[18px] text-t3" />
        </button>
      </div>

      <SequentialInputDialog
        isOpen={!!pendingInput}
        requirement={currentRequirement}
        index={pendingInput?.index || 0}
        total={pendingInput?.requirements.length || 0}
        entered={pendingInput?.entered || []}
        onSubmit={submitInputValue}
        onBack={backInputStep}
        onCancel={cancelInputDialog}
      />
    </div>
  );
}
