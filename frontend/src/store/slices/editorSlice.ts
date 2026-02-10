import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Language } from '@types/index';

export interface EditorState {
  // State
  code: string;
  language: Language;
  fileName: string | null;
  isDirty: boolean;
  errors: EditorError[];
  warnings: EditorWarning[];
  
  // Actions
  setCode: (code: string) => void;
  setLanguage: (language: Language) => void;
  setFileName: (fileName: string | null) => void;
  detectLanguage: (code: string) => void;
  setErrors: (errors: EditorError[]) => void;
  setWarnings: (warnings: EditorWarning[]) => void;
  clearErrors: () => void;
  reset: () => void;
}

export interface EditorError {
  line: number;
  column?: number;
  message: string;
  severity: 'error';
}

export interface EditorWarning {
  line: number;
  column?: number;
  message: string;
  severity: 'warning';
}

const detectLanguageFromCode = (code: string): Language => {
  // C++ indicators
  const cppPatterns = [
    /\#include\s*<iostream>/,
    /std::/,
    /\bclass\b/,
    /\bnamespace\b/,
    /\btemplate\s*</,
    /\bcout\b/,
    /\bcin\b/,
    /\busing\s+namespace/,
  ];

  for (const pattern of cppPatterns) {
    if (pattern.test(code)) {
      return 'cpp';
    }
  }

  return 'c';
};

export const useEditorStore = create<EditorState>()(
  immer((set) => ({
    // Initial state
    code: `#include <iostream>

int main() {
    std::cout << "Hello, World!" << std::endl;
    return 0;
}
`,
    language: 'cpp',
    fileName: null,
    isDirty: false,
    errors: [],
    warnings: [],

    // Actions
    setCode: (code: string) =>
      set((state) => {
        state.code = code;
        state.isDirty = true;
        // Auto-detect language on code change
        state.language = detectLanguageFromCode(code);
      }),

    setLanguage: (language: Language) =>
      set((state) => {
        state.language = language;
      }),

    setFileName: (fileName: string | null) =>
      set((state) => {
        state.fileName = fileName;
        if (fileName) {
          // Auto-detect language from file extension
          if (fileName.endsWith('.cpp') || fileName.endsWith('.hpp') || fileName.endsWith('.cc')) {
            state.language = 'cpp';
          } else if (fileName.endsWith('.c') || fileName.endsWith('.h')) {
            state.language = 'c';
          }
        }
      }),

    detectLanguage: (code: string) =>
      set((state) => {
        state.language = detectLanguageFromCode(code);
      }),

    setErrors: (errors: EditorError[]) =>
      set((state) => {
        state.errors = errors;
      }),

    setWarnings: (warnings: EditorWarning[]) =>
      set((state) => {
        state.warnings = warnings;
      }),

    clearErrors: () =>
      set((state) => {
        state.errors = [];
        state.warnings = [];
      }),

    reset: () =>
      set((state) => {
        state.code = '';
        state.language = 'c';
        state.fileName = null;
        state.isDirty = false;
        state.errors = [];
        state.warnings = [];
      }),
  }))
);