import lspService from '../src/services/lsp.service.js';
import { toolchainService } from '../src/services/toolchain.service.js';
import path from 'path';
import fs from 'fs/promises';

async function testLSP() {
  const sessionId = 'test-session-' + Date.now();
  console.log(`Testing LSP for session: ${sessionId}`);

  try {
    // 1. Initialize session
    const session = await lspService.initializeSession(sessionId);
    console.log('✅ Session initialized');

    // 2. Setup listener
    let initialized = false;
    await lspService.onMessage(sessionId, (message) => {
      // console.log('Message from clangd:', message);
      if (message.includes('"result":')) {
        console.log('✅ Received initialization result');
        initialized = true;
      }
    });

    // 3. Send initialize request
    const initRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        processId: process.pid,
        rootUri: null,
        capabilities: {}
      }
    };
    
    // Header + JSON content for LSP protocol
    const content = JSON.stringify(initRequest);
    const header = `Content-Length: ${Buffer.byteLength(content, 'utf8')}\r\n\r\n`;
    
    await lspService.sendMessage(sessionId, header + content);
    console.log('📡 Sent initialize request');

    // Wait for response
    for (let i = 0; i < 20; i++) {
       if (initialized) break;
       await new Promise(r => setTimeout(r, 500));
    }

    if (!initialized) {
      throw new Error('Timeout waiting for LSP response');
    }

    // 4. Cleanup
    await lspService.cleanupSession(sessionId);
    console.log('✅ Session cleaned up');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ LSP Test failed:', error);
    process.exit(1);
  }
}

testLSP();
