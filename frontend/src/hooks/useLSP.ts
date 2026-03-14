import { useEffect } from 'react';
import { editor } from 'monaco-editor';
import { lspClientService } from '../services/lsp-client.service';

export const useLSP = (editorInstance: editor.IStandaloneCodeEditor | null) => {
  useEffect(() => {
    if (editorInstance) {
      lspClientService.initialize(editorInstance);
    }

    return () => {
      // We don't necessarily want to dispose here if the same client 
      // is reused across mounting/unmounting, but for now let's leave it.
      // lspClientService.dispose();
    };
  }, [editorInstance]);
};
