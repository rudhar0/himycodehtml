import { Toaster } from 'react-hot-toast';
import MainLayout from '@components/layout/MainLayout';
import { useSocket } from '@hooks/useSocket';
import { useEffect } from 'react';
import { APP_CONFIG } from '@config/app.config';
import { InputPromptModal } from '@components/modals/InputPromptModal';
import { useEditorStore } from '@store/slices/editorSlice';
import { astService } from '@services/ast.service';

function App() {
  const { connect, disconnect, isConnected } = useSocket();
  const { language } = useEditorStore();

  useEffect(() => {
    // Connect to Socket.io on mount
    connect();

    // Keep socket connection alive across React Strict Mode remounts
    // Only disconnect when the page is unloaded
    const handleBeforeUnload = () => disconnect();
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [connect, disconnect]);

  useEffect(() => {
    console.log(`Language changed to: ${language}. Initializing AST parser.`);
    astService.initialize(language);
  }, [language]);

  return (
    <>
      {/* Set page title */}
      <title>{APP_CONFIG.fullName}</title>
      
      <MainLayout />
      
      {/* Modals */}
      <InputPromptModal />

      {/* Toast notifications */}
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            background: '#1e293b',
            color: '#f1f5f9',
            border: '1px solid #334155',
          },
          success: {
            iconTheme: {
              primary: '#10b981',
              secondary: '#fff',
            },
          },
          error: {
            iconTheme: {
              primary: '#ef4444',
              secondary: '#fff',
            },
          },
        }}
      />

      {/* Connection status indicator */}
      {!isConnected && (
        <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-white shadow-lg">
          <div className="h-2 w-2 animate-pulse rounded-full bg-white" />
          <span className="text-sm font-medium">Connecting to server...</span>
        </div>
      )}
    </>
  );
}

export default App;