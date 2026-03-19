/**
 * File Loader Component
 * Upload C/C++ files from disk
 */

import { Upload } from 'lucide-react';
import { fileOpen } from 'browser-fs-access';
import { useEditorStore } from '@store/slices/editorSlice';
import toast from 'react-hot-toast';

export default function FileLoader() {
  const { setCode, setFileName } = useEditorStore();

  /**
   * Handle file upload
   */
  const handleFileOpen = async () => {
    try {
      const file = await fileOpen({
        description: 'C/C++ Source Files',
        mimeTypes: ['text/plain', 'text/x-c', 'text/x-c++'],
        extensions: ['.c', '.cpp', '.h', '.hpp', '.cc', '.cxx'],
        multiple: false,
      });

      const content = await file.text();
      
      setCode(content);
      setFileName(file.name);
      
      toast.success(`Loaded ${file.name}`);
    } catch (error: any) {
      // User cancelled
      if (error.name === 'AbortError') {
        return;
      }
      
      console.error('Failed to load file:', error);
      toast.error('Failed to load file');
    }
  };

  return (
    <button
      onClick={handleFileOpen}
      className="flex items-center gap-1.5 rounded-lg px-3 py-[5px] text-xs font-medium text-t2 transition-colors hover:bg-bg3"
      style={{ border: '1px solid var(--bd2)' }}
      title="Open File"
    >
      <Upload className="h-3 w-3" />
      Open File
    </button>
  );
}