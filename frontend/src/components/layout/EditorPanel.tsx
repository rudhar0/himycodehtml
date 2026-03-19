import CodeEditor from '@components/editor/CodeEditor';
import { useEditorStore } from '@store/slices/editorSlice';

export default function EditorPanel() {
  const { language } = useEditorStore();

  return (
    <div className="flex h-full flex-col bg-bg2">
      {/* Editor Header — matches prototype .editor-header */}
      <div className="flex items-center justify-between border-b border-bd bg-bg1 border-t-2 border-t-acc px-4"
           style={{ height: '34px' }}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-t1">Code Editor</span>
          <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold font-mono text-acc3"
                style={{ background: 'var(--bg0)', border: '1px solid var(--bd2)' }}>
            {language === 'cpp' ? 'C++' : 'C'}
          </span>
        </div>
      </div>

      {/* Monaco Editor Container — use bg-bg0 for inner editor body */}
      <div className="flex-1 overflow-hidden bg-bg0">
        <CodeEditor />
      </div>
    </div>
  );
}