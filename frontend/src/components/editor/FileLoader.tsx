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
      className="flex items-center gap-2 rounded-lg bg-[#c8d0d8] dark:bg-slate-700 px-3 py-1.5 text-sm font-medium text-[#1a2332] dark:text-slate-200 hover:bg-[#b0bac4] dark:hover:bg-slate-600 transition-colors"
      title="Open File"
    >
      <Upload className="h-4 w-4" />
      <span>Open File</span>
    </button>
  );
}