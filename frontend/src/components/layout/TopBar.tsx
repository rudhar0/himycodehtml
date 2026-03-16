import { useMemo, useState } from 'react';
import { Menu, Play, FileCode, Settings, Sun, Moon } from 'lucide-react';
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
    if (!code.trim()) {
      return;
    }
    
    if (!isConnected) {
      alert('Not connected to server');
      return;
    }
    
    // Auto-detect language
    const language: 'c' | 'cpp' = code.includes('iostream') || code.includes('std::') ? 'cpp' : 'c';
    const requirements = detectInputRequirements(code);
    if (requirements.length === 0) {
      runTrace(code, language, []);
      return;
    }

    if (!ensureInputDialogHost()) {
      const defaults = requirements.map((req) => defaultInputValue(req.type));
      console.warn('[InputDialog] Failed to render input dialog host, using default inputs.');
      runTrace(code, language, defaults);
      return;
    }

    setPendingInput({
      code,
      language,
      requirements,
      values: [],
      entered: [],
      index: 0,
    });
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
      if (nextIndex >= prev.requirements.length) {
        runTrace(prev.code, prev.language, values);
        return null;
      }
      return { ...prev, values, entered, index: nextIndex };
    });
  };

  const backInputStep = () => {
    setPendingInput((prev) => {
      if (!prev || prev.index <= 0) return prev;
      return {
        ...prev,
        index: prev.index - 1,
        values: prev.values.slice(0, -1),
        entered: prev.entered.slice(0, -1),
      };
    });
  };

  const cancelInputDialog = () => {
    setPendingInput((prev) => {
      if (!prev) return prev;
      const defaults = prev.requirements.map((req) => defaultInputValue(req.type));
      runTrace(prev.code, prev.language, defaults);
      return null;
    });
  };

  return (
    <div className="flex h-12 items-center justify-between border-b border-[#1a2540] bg-[#0f1629] px-4">
      {/* Left Section */}
      <div className="flex items-center gap-2">
        {/* Sidebar Toggle */}
        <button
          onClick={toggleSidebar}
          className="rounded p-2 hover:bg-[#c8d0d8] dark:hover:bg-slate-800 transition-colors"
          title={isSidebarOpen ? 'Hide Sidebar' : 'Show Sidebar'}
        >
          <Menu className="h-5 w-5 text-[#5a6a7a] dark:text-slate-300" />
        </button>

        {/* App Title */}
        <div className="flex items-center gap-2 ml-2">
          <FileCode className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          <div className="flex flex-col">
            <span className="font-semibold text-[#1a2332] dark:text-slate-200">{APP_CONFIG.name}</span>
            <span className="text-xs text-[#5a6a7a] dark:text-slate-500">{APP_CONFIG.tagline}</span>
          </div>
        </div>
      </div>

      {/* Center Section */}
      <div className="flex items-center gap-4">
        {/* Run Button */}
        <button
          onClick={handleRun}
          disabled={!code.trim() || isAnalyzing || !isConnected}
          className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Play className="h-4 w-4" />
          {isAnalyzing ? 'Analyzing...' : 'Run'}
        </button>

        {/* File Loader */}
        <FileLoader />
      </div>

      {/* Right Section */}
      <div className="flex items-center gap-3">
        {/* Connection Status */}
        <div className="flex items-center gap-2 text-xs">
          <div className={`h-2 w-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-[#5a6a7a] dark:text-slate-400">{isConnected ? 'Connected' : 'Disconnected'}</span>
        </div>

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="rounded-lg p-2 hover:bg-[#c8d0d8] dark:hover:bg-[#1a2540] transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#dde3e8] dark:focus:ring-offset-[#0f1629]"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-pressed={theme === 'dark'}
        >
          {theme === 'dark' ? (
            <Sun className="h-5 w-5 text-yellow-500 transition-transform hover:rotate-12" />
          ) : (
            <Moon className="h-5 w-5 text-[#5a6a7a] transition-transform hover:-rotate-12" />
          )}
        </button>
        
        {/* Settings */}
        <button
          className="rounded p-2 hover:bg-[#c8d0d8] dark:hover:bg-slate-800 transition-colors"
          title="Settings"
        >
          <Settings className="h-5 w-5 text-[#5a6a7a] dark:text-slate-300" />
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
