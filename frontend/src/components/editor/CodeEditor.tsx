// frontend/src/components/editor/CodeEditor.tsx
import React, { useEffect } from 'react';
import { Editor, OnMount } from '@monaco-editor/react';
import { useCodeEditor } from '../../hooks/useCodeEditor';
import { useLSP } from '../../hooks/useLSP';
import ExecutionHighlighter from './ExecutionHighlighter';
import { useEditorStore } from '../../store/slices/editorSlice';
import { useExecutionStore } from '../../store/slices/executionSlice';
import { useThemeStore } from '../../store/slices/themeSlice';

const CodeEditor: React.FC = () => {
  const { editor, handleEditorDidMount: originalHandleEditorDidMount } = useCodeEditor();
  useLSP(editor);
  
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
    // Define dark theme — prototype palette
    monaco.editor.defineTheme('visualizer-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        // Keywords: purple #C084FC
        { token: 'keyword',                foreground: 'C084FC', fontStyle: 'bold' },
        { token: 'keyword.cpp',            foreground: 'C084FC', fontStyle: 'bold' },
        { token: 'keyword.control',        foreground: 'C084FC', fontStyle: 'bold' },
        { token: 'keyword.operator',       foreground: 'C084FC' },
        { token: 'keyword.directive',      foreground: 'C084FC' }, // prototype uses purple for #include? Wait, prototype shows green for #include. Let's check.
        // Types
        { token: 'type.cpp',               foreground: 'C084FC' },
        { token: 'storage.type.cpp',       foreground: 'C084FC' },
        
        // Functions / Identifiers: blue #60A5FA
        { token: 'identifier',             foreground: '60A5FA' },
        { token: 'entity.name.function',   foreground: '60A5FA' },
        { token: 'function',               foreground: '60A5FA' },
        
        // Strings: green #34D399
        { token: 'string',                 foreground: '34D399' },
        { token: 'string.quoted',          foreground: '34D399' },
        { token: 'string.include',         foreground: '34D399' },
        
        // Numbers / namespaces: amber #F59E0B
        { token: 'number',                 foreground: 'F59E0B' },
        { token: 'constant.numeric',       foreground: 'F59E0B' },
        { token: 'namespace',              foreground: 'F59E0B' },
        
        // Punctuation / delimiters: secondary text #94A3B8
        { token: 'delimiter',              foreground: '94A3B8' },
        { token: 'operator',               foreground: '94A3B8' },
        
        // Comments: muted #4A5568
        { token: 'comment',                foreground: '4A5568', fontStyle: 'italic' },
      ],
      colors: {
        'editor.background':                '#08070F',
        'editor.foreground':                '#94A3B8',
        'editor.lineHighlightBackground':   '#7C3AED12',
        'editorLineNumber.foreground':      '#4A5568',
        'editorLineNumber.activeForeground': '#7C3AED',
        'editorCursor.foreground':          '#9F67FF',
        'editor.selectionBackground':       '#7C3AED33',
        'editorGutter.background':          '#08070F', // matches prototype
      },
    });

    // Define light theme — prototype light palette
    monaco.editor.defineTheme('visualizer-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'keyword',                foreground: '7C3AED', fontStyle: 'bold' },
        { token: 'identifier',             foreground: '2563EB' },
        { token: 'string',                 foreground: '059669' },
        { token: 'number',                 foreground: 'F59E0B' },
        { token: 'comment',                foreground: '94A3B8', fontStyle: 'italic' },
      ],
      colors: {
        'editor.background':                '#F4F6FA',
        'editor.foreground':                '#0F172A',
        'editorLineNumber.foreground':      '#94A3B8',
        'editorLineNumber.activeForeground': '#7C3AED',
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
