// frontend/src/components/editor/CodeEditor.tsx
import React, { useEffect } from 'react';
import { Editor, OnMount } from '@monaco-editor/react';
import { useCodeEditor } from '../../hooks/useCodeEditor';
import ExecutionHighlighter from './ExecutionHighlighter';
import { useEditorStore } from '../../store/slices/editorSlice';
import { useExecutionStore } from '../../store/slices/executionSlice';
import { useThemeStore } from '../../store/slices/themeSlice';

const CodeEditor: React.FC = () => {
  const { editor, handleEditorDidMount: originalHandleEditorDidMount } = useCodeEditor();
  
  const code = useEditorStore((state) => state.code);
  const language = useEditorStore((state) => state.language);
  const setCode = useEditorStore((state) => state.setCode);
  const { theme } = useThemeStore();
  
  const currentLine = useExecutionStore(
    (state) => state.executionTrace?.steps[state.currentStep]?.line || 0
  );

  const handleEditorChange = (value: string | undefined) => {
    setCode(value || '');
  };

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    // Define dark theme
    monaco.editor.defineTheme('visualizer-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#0f172a',
        'editor.foreground': '#f8fafc',
        'editorLineNumber.foreground': '#475569',
        'editorLineNumber.activeForeground': '#a855f7',
        'editorCursor.foreground': '#a855f7',
        'editor.selectionBackground': '#a855f733',
      },
    });

    // Define light theme with soft gray background
    monaco.editor.defineTheme('visualizer-light', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#f5f7f9',
        'editor.foreground': '#1a2332',
        'editorLineNumber.foreground': '#8a9aaa',
        'editorLineNumber.activeForeground': '#7c3aed',
        'editorCursor.foreground': '#7c3aed',
        'editor.selectionBackground': '#a855f733',
        'editorGutter.background': '#e8ecef',
      },
    });

    // Set initial theme
    monaco.editor.setTheme(theme === 'dark' ? 'visualizer-dark' : 'visualizer-light');
    originalHandleEditorDidMount(editor);
  };

  // Switch Monaco theme when app theme changes
  useEffect(() => {
    if (editor) {
      const monaco = (window as any).monaco;
      if (monaco) {
        monaco.editor.setTheme(theme === 'dark' ? 'visualizer-dark' : 'visualizer-light');
      }
    }
  }, [theme, editor]);

  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <Editor
        height="100%"
        language={language}
        value={code}
        onMount={handleEditorDidMount}
        onChange={handleEditorChange}
        options={{
          readOnly: false,
          domReadOnly: false,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
        }}
      />
      {editor && <ExecutionHighlighter editor={editor} currentLine={currentLine} />}
    </div>
  );
};

export default CodeEditor;
