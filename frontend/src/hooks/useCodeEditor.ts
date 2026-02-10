// frontend/src/hooks/useCodeEditor.ts
import { useState, useRef } from 'react';
import { editor } from 'monaco-editor';

export const useCodeEditor = () => {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [editor, setEditor] = useState<editor.IStandaloneCodeEditor | null>(null);

  const handleEditorDidMount = (editorInstance: editor.IStandaloneCodeEditor) => {
    editorRef.current = editorInstance;
    setEditor(editorInstance);
  };

  return { editor, editorRef, handleEditorDidMount };
};
