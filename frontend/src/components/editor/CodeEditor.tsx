// frontend/src/components/editor/CodeEditor.tsx
import React, { useEffect } from 'react';
import { Editor, OnMount } from '@monaco-editor/react';
import type * as MonacoTypes from 'monaco-editor';
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

  const handleEditorDidMount: OnMount = (editorInstance, monaco) => {
    // ── Theme: dark ──────────────────────────────────────────────────────
    monaco.editor.defineTheme('visualizer-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword',                foreground: 'C084FC', fontStyle: 'bold' },
        { token: 'keyword.cpp',            foreground: 'C084FC', fontStyle: 'bold' },
        { token: 'keyword.control',        foreground: 'C084FC', fontStyle: 'bold' },
        { token: 'keyword.operator',       foreground: 'C084FC' },
        { token: 'keyword.directive',      foreground: 'C084FC' },
        { token: 'type.cpp',               foreground: 'C084FC' },
        { token: 'storage.type.cpp',       foreground: 'C084FC' },
        { token: 'identifier',             foreground: '60A5FA' },
        { token: 'entity.name.function',   foreground: '60A5FA' },
        { token: 'function',               foreground: '60A5FA' },
        { token: 'string',                 foreground: '34D399' },
        { token: 'string.quoted',          foreground: '34D399' },
        { token: 'string.include',         foreground: '34D399' },
        { token: 'number',                 foreground: 'F59E0B' },
        { token: 'constant.numeric',       foreground: 'F59E0B' },
        { token: 'namespace',              foreground: 'F59E0B' },
        { token: 'delimiter',              foreground: '94A3B8' },
        { token: 'operator',               foreground: '94A3B8' },
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
        'editorGutter.background':          '#08070F',
      },
    });

    // ── Theme: light ────────────────────────────────────────────────────
    monaco.editor.defineTheme('visualizer-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'keyword',   foreground: '7C3AED', fontStyle: 'bold' },
        { token: 'identifier',foreground: '2563EB' },
        { token: 'string',    foreground: '059669' },
        { token: 'number',    foreground: 'F59E0B' },
        { token: 'comment',   foreground: '94A3B8', fontStyle: 'italic' },
      ],
      colors: {
        'editor.background':                '#F4F6FA',
        'editor.foreground':                '#0F172A',
        'editorLineNumber.foreground':      '#94A3B8',
        'editorLineNumber.activeForeground': '#7C3AED',
      },
    });

    monaco.editor.setTheme(theme === 'dark' ? 'visualizer-dark' : 'visualizer-light');

    // ── C/C++ completion items ──────────────────────────────────────────
    const CK = monaco.languages.CompletionItemKind;

    const CPP_COMPLETIONS: MonacoTypes.languages.CompletionItem[] = [
      // Control-flow snippets (High priority)
      {
        label: 'if', kind: CK.Snippet, detail: 'if (cond) { ... }',
        insertText: 'if (${1:condition}) {\n\t$0\n}',
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        sortText: '001',
        range: undefined as any,
      },
      {
        label: 'for', kind: CK.Snippet, detail: 'for (...) { ... }',
        insertText: 'for (${1:int i = 0}; ${2:i < n}; ${3:i++}) {\n\t$0\n}',
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        sortText: '002',
        range: undefined as any,
      },
      {
        label: 'while', kind: CK.Snippet, detail: 'while (cond) { ... }',
        insertText: 'while (${1:condition}) {\n\t$0\n}',
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        sortText: '003',
        range: undefined as any,
      },
      {
        label: 'main', kind: CK.Snippet, detail: 'int main() { ... }',
        insertText: 'int main() {\n\t$0\n\treturn 0;\n}',
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        sortText: '004',
        range: undefined as any,
      },
      {
        label: 'cout', kind: CK.Snippet, detail: 'std::cout << ... << std::endl;',
        insertText: 'std::cout << ${1:"text"} << std::endl;',
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        sortText: '005',
        range: undefined as any,
      },
      {
        label: 'cin', kind: CK.Snippet, detail: 'std::cin >> ...;',
        insertText: 'std::cin >> ${1:variable};',
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        sortText: '006',
        range: undefined as any,
      },
      {
        label: 'include', kind: CK.Snippet, detail: '#include <...>',
        insertText: '#include <${1:iostream}>',
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        sortText: '007',
        range: undefined as any,
      },

      // Type keywords
      ...['int', 'float', 'double', 'char', 'bool', 'void', 'long', 'short',
          'unsigned', 'signed', 'const', 'static', 'extern', 'auto',
          'struct', 'class', 'enum', 'union', 'namespace', 'template',
          'typename', 'inline', 'virtual', 'override', 'nullptr', 'true',
          'false', 'new', 'delete', 'sizeof', 'typedef', 'using'].map(kw => ({
        label: kw, kind: CK.Keyword,
        insertText: kw, detail: 'type',
        sortText: '100' + kw,
        range: undefined as any,
      })),
      
      // Control-flow keywords (backup)
      ...['else', 'do', 'switch', 'case', 'break', 'continue', 'return', 'goto', 'default'].map(kw => ({
        label: kw, kind: CK.Keyword,
        insertText: kw, detail: 'keyword',
        sortText: '110' + kw,
        range: undefined as any,
      })),

      // std:: functions / objects
      ...['std::cout', 'std::cin', 'std::endl', 'std::string', 'std::vector',
          'std::map', 'std::set', 'std::pair', 'std::make_pair', 'std::array',
          'std::stack', 'std::queue', 'std::deque', 'std::list',
          'std::sort', 'std::find', 'std::max', 'std::min', 'std::swap',
          'std::move', 'std::unique_ptr', 'std::shared_ptr',
          'std::to_string', 'std::stoi', 'std::stod'].map(fn => ({
        label: fn, kind: CK.Function,
        insertText: fn, detail: 'std library',
        sortText: '200' + fn,
        range: undefined as any,
      })),
      
      // Common C functions
      ...['printf', 'scanf', 'malloc', 'calloc', 'free', 'realloc',
          'strlen', 'strcpy', 'strcat', 'strcmp', 'memset', 'memcpy',
          'fopen', 'fclose', 'fread', 'fwrite', 'fprintf', 'fscanf',
          'abs', 'pow', 'sqrt', 'floor', 'ceil', 'rand', 'srand', 'exit'].map(fn => ({
        label: fn, kind: CK.Function,
        insertText: fn, detail: 'C stdlib',
        sortText: '210' + fn,
        range: undefined as any,
      })),

      // Common headers
      ...['<iostream>', '<cstdio>', '<cstdlib>', '<string>', '<vector>',
          '<map>', '<set>', '<algorithm>', '<cmath>', '<cassert>',
          '<fstream>', '<sstream>', '<memory>', '<utility>'].map(h => ({
        label: h, kind: CK.Module,
        insertText: h, detail: 'header',
        sortText: '300' + h,
        range: undefined as any,
      })),
    ];

    // Register popup-dropdown completion provider for c and cpp
    const completionDisposable = monaco.languages.registerCompletionItemProvider(['c', 'cpp'], {
      triggerCharacters: ['.', ':', '#', '<', '"'],
      provideCompletionItems(model, position) {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber:   position.lineNumber,
          startColumn:     word.startColumn,
          endColumn:       position.column,
        };
        // Give each item the correct range
        const items = CPP_COMPLETIONS.map(item => ({ ...item, range }));

        // Also add words already present in the document
        const content = model.getValue();
        const wordPattern = /\b[a-zA-Z_][a-zA-Z0-9_]{2,}\b/g;
        const seen = new Set(items.map(i => i.label as string));
        let m: RegExpExecArray | null;
        while ((m = wordPattern.exec(content)) !== null) {
          const w = m[0];
          if (!seen.has(w)) {
            seen.add(w);
            items.push({ 
              label: w, 
              kind: CK.Text, 
              insertText: w, 
              detail: 'word in file', 
              sortText: '999' + w,
              range 
            });
          }
        }
        return { suggestions: items };
      },
    });

    // Register inline ghost-text provider (the light-gray VS Code style)
    const inlineDisposable = monaco.languages.registerInlineCompletionsProvider(['c', 'cpp'], {
      provideInlineCompletions(model, position) {
        const word = model.getWordUntilPosition(position);
        if (word.word.length < 2) return { items: [] };

        const prefix = word.word.toLowerCase();
        
        // Find the best match from our completions
        const bestItem = CPP_COMPLETIONS.find(item => {
          const label = (item.label as string).toLowerCase();
          return label.startsWith(prefix) && label !== prefix;
        });

        if (!bestItem) return { items: [] };

        let insertText = bestItem.label as string;
        
        // If it's a snippet, we show the bracket part as ghost text
        if (bestItem.kind === CK.Snippet) {
           if (bestItem.label === 'if') insertText = 'if (condition) { }';
           else if (bestItem.label === 'for') insertText = 'for (int i=0; i<n; i++) { }';
           else if (bestItem.label === 'while') insertText = 'while (cond) { }';
           else if (bestItem.label === 'main') insertText = 'int main() { }';
        }

        return { 
          items: [{
            insertText: insertText.slice(word.word.length),
            range: {
              startLineNumber: position.lineNumber,
              endLineNumber:   position.lineNumber,
              startColumn:     position.column,
              endColumn:       position.column,
            },
          }] 
        };
      },
      freeInlineCompletions() { /* nothing to free */ },
      disposeInlineCompletions() { /* nothing to free */ },
    } as any);

    // Clean up providers when editor is disposed
    editorInstance.onDidDispose(() => {
      completionDisposable.dispose();
      inlineDisposable.dispose();
    });

    originalHandleEditorDidMount(editorInstance);
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
        path={language === 'cpp' ? 'main.cpp' : 'main.c'}
        value={code}
        onMount={handleEditorDidMount}
        onChange={handleEditorChange}
        options={{
          readOnly: false,
          domReadOnly: false,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,

          // ── Bracket features ────────────────────────────────────────────
          autoClosingBrackets: 'always',
          autoClosingQuotes: 'always',
          autoSurround: 'languageDefined',
          bracketPairColorization: { enabled: true },
          matchBrackets: 'always',

          // ── Inline ghost-text suggestions (the light-gray VS Code style) ─
          inlineSuggest: { enabled: true, mode: 'prefix' },

          // ── Word-based completions from the open file ────────────────────
          suggest: {
            showWords: true,
            localityBonus: true,
            snippetsPreventQuickSuggestions: false,
          },
          quickSuggestions: { other: true, comments: false, strings: false },
          quickSuggestionsDelay: 100,

          // ── Red squiggles for syntax errors ─────────────────────────────
          renderValidationDecorations: 'on',

          // ── Auto-formatting ──────────────────────────────────────────────
          formatOnPaste: true,
          autoIndent: 'full',
        }}
      />
      {editor && <ExecutionHighlighter editor={editor} currentLine={currentLine} />}
    </div>
  );
};

export default CodeEditor;
