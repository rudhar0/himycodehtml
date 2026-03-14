import { MonacoLanguageClient } from 'monaco-languageclient';
import { socketService } from '../api/socket.service';
import { editor } from 'monaco-editor';
import { initialize } from '@codingame/monaco-vscode-api';
import 'vscode/localExtensionHost';

// Import necessary base classes and types from vscode-jsonrpc
// These are available as transitive dependencies
import { 
  AbstractMessageReader, 
  AbstractMessageWriter, 
  DataCallback, 
  Disposable, 
  Message 
} from 'vscode-jsonrpc/lib/browser/main.js';

class SocketMessageReader extends AbstractMessageReader {
  private decoder = new TextDecoder();
  private callback: DataCallback | undefined;

  constructor() {
    super();
    
    // Listen for LSP messages from the server via Socket.io
    socketService.on('lsp:message', (data: any) => {
      try {
        // Data might be string or ArrayBuffer depending on Socket.io config
        const message = typeof data === 'string' ? JSON.parse(data) : JSON.parse(this.decoder.decode(data));
        this.fireMessage(message);
      } catch (e) {
        console.error('[LSP] Failed to parse message:', e);
      }
    });

    socketService.on('disconnect', () => {
      this.fireClose();
    });

    socketService.on('connect_error', (err: any) => {
      this.fireError(err);
    });
  }

  listen(callback: DataCallback): Disposable {
    this.callback = callback;
    return Disposable.create(() => {
      this.callback = undefined;
    });
  }

  private fireMessage(message: any) {
    if (this.callback) {
      this.callback(message);
    }
  }
}

class SocketMessageWriter extends AbstractMessageWriter {
  constructor() {
    super();
  }

  async write(msg: Message): Promise<void> {
    try {
      socketService.emit('lsp:message', JSON.stringify(msg));
    } catch (e) {
      console.error('[LSP] Failed to write message:', e);
      this.fireError(e);
    }
  }

  end(): void {
    this.fireClose();
  }
}

class LSPClientService {
  private client: MonacoLanguageClient | null = null;
  private servicesInitialized = false;

  public async initialize(editorInstance: editor.IStandaloneCodeEditor) {
    if (this.client) return;

    if (!this.servicesInitialized) {
      try {
        await initialize({
          // Add service overrides here if needed
        });
        this.servicesInitialized = true;
        console.info('[LSP] Monaco VSCode services initialized');
      } catch (e) {
        console.error('[LSP] Failed to initialize Monaco VSCode services:', e);
        return;
      }
    }

    const reader = new SocketMessageReader();
    const writer = new SocketMessageWriter();

    const clientOptions: any = {
      documentSelector: ['cpp', 'c'],
      errorHandler: {
        error: () => ({ action: 2 }), // Shutdown
        closed: () => ({ action: 2 })
      }
    };

    this.client = new MonacoLanguageClient({
      id: 'cpp-language-client',
      name: 'C/C++ Language Client',
      clientOptions: clientOptions,
      messageTransports: { reader, writer }
    });
    
    try {
      await this.client.start();
      console.info('[LSP] C/C++ Language Client started');
    } catch (e) {
      console.error('[LSP] Failed to start C/C++ Language Client:', e);
    }
  }

  public dispose() {
    if (this.client) {
      this.client.stop();
      this.client = null;
    }
  }
}

export const lspClientService = new LSPClientService();
export default lspClientService;
