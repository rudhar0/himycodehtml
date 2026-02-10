// frontend/src/components/editor/ExecutionHighlighter.tsx
import React, { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import { editor } from 'monaco-editor';

interface ExecutionHighlighterProps {
  editor: editor.IStandaloneCodeEditor;
  currentLine: number;
}

const ExecutionHighlighter: React.FC<ExecutionHighlighterProps> = ({ editor, currentLine }) => {
  const decorationsRef = useRef<string[]>([]);
  const last5LinesRef = useRef<number[]>([]);

  useEffect(() => {
    if (currentLine > 0) {
      // Update trail of last 5 lines
      const newTrail = [...last5LinesRef.current];
      if (!newTrail.includes(currentLine)) {
        newTrail.push(currentLine);
        if (newTrail.length > 6) { // Current line + 5 previous
          newTrail.shift();
        }
        last5LinesRef.current = newTrail;
      }

      const newDecorations: editor.IModelDeltaDecoration[] = [];

      // Green for executed, yellow for current
      const trailLines = last5LinesRef.current.slice(0, -1);
      const currentExecutingLine = last5LinesRef.current.slice(-1)[0];


      // Trail decorations (fading effect) - green color
      trailLines.forEach((line) => {
        newDecorations.push({
          range: new monaco.Range(line, 1, line, 1),
          options: {
            isWholeLine: true,
            inlineClassName: 'executed-line-inline',
            className: 'executed-line',
            minimap: {
              color: '#dcfce7',
              position: 1,
            },
          },
        });
      });

      // Current line decoration - yellow color
      newDecorations.push({
        range: new monaco.Range(currentExecutingLine, 1, currentExecutingLine, 1),
        options: {
          isWholeLine: true,
          inlineClassName: 'current-execution-line-inline',
          className: 'current-execution-line',
          glyphMarginClassName: 'current-line-glyph',
          minimap: {
            color: '#fefcbf',
            position: 1,
          },
          overviewRuler: {
            color: '#facc15',
            position: 3,
          },
        },
      });

      decorationsRef.current = editor.deltaDecorations(
        decorationsRef.current,
        newDecorations
      );

      editor.revealLineInCenterIfOutsideViewport(currentLine, monaco.editor.ScrollType.Smooth);
    } else {
      // Clear all decorations if execution is finished (currentLine is 0 or less)
       editor.deltaDecorations(decorationsRef.current, []);
       decorationsRef.current = [];
       last5LinesRef.current = [];
    }

  }, [editor, currentLine]);

  return null; // This component does not render anything itself
};

export default ExecutionHighlighter;
