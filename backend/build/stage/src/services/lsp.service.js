import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import os from 'os';
import { toolchainService } from './toolchain.service.js';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { getBackendRoot, getRuntimeDir } from '../utils/project-paths.js';

const __filename = fileURLToPath(import.meta.url);
const backendRoot = getBackendRoot(import.meta.url);

class LSPService {
  constructor() {
    this.sessions = new Map(); // sessionId -> { process, tempDir, buffer }
  }

  /**
   * Initialize a clangd process for a session
   * @param {string} sessionId 
   */
  async initializeSession(sessionId) {
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId);
    }

    const runtimeDir = getRuntimeDir(backendRoot);
    const lspDir = path.join(runtimeDir, 'lsp', sessionId);
    
    if (!existsSync(lspDir)) {
      mkdirSync(lspDir, { recursive: true });
    }

    // Create compile_flags.txt
    const includeFlags = toolchainService.getIncludeFlags('cpp');
    // For clangd, compile_flags.txt is one flag per line
    const flagsContent = includeFlags.join('\n');
    await fs.writeFile(path.join(lspDir, 'compile_flags.txt'), flagsContent);

    const clangdPath = path.join(toolchainService.toolchainPath, os.platform() === 'win32' ? 'clangd.exe' : 'clangd');
    
    logger.info(`Starting clangd for session ${sessionId} at ${lspDir}`);

    const clangdProcess = spawn(clangdPath, [
      '--compile-commands-dir=' + lspDir,
      '--all-scopes-completion',
      '--completion-style=detailed',
      '--header-insertion=never',
      '--background-index=false' 
    ], {
      cwd: lspDir,
      env: toolchainService.getRuntimeEnv()
    });

    const sessionData = {
      process: clangdProcess,
      tempDir: lspDir,
      buffer: Buffer.alloc(0)
    };

    this.sessions.set(sessionId, sessionData);

    clangdProcess.on('exit', (code) => {
      logger.info(`clangd process for session ${sessionId} exited with code ${code}`);
      this.cleanupSession(sessionId);
    });

    clangdProcess.on('error', (err) => {
      logger.error(`clangd process for session ${sessionId} error:`, err);
    });

    return sessionData;
  }

  /**
   * Send a message to the clangd process
   * @param {string} sessionId 
   * @param {string} message JSON-RPC message
   */
  async sendMessage(sessionId, message) {
    const session = await this.initializeSession(sessionId);
    if (session && session.process.stdin.writable) {
      // Clangd expects the standard LSP header: Content-Length: <len>\r\n\r\n
      const body = typeof message === 'string' ? message : JSON.stringify(message);
      const header = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n`;
      session.process.stdin.write(header + body);
    }
  }

  /**
   * Set up a listener for messages FROM clangd
   * @param {string} sessionId 
   * @param {Function} callback 
   */
  async onMessage(sessionId, callback) {
    const session = await this.initializeSession(sessionId);
    if (session) {
      session.process.stdout.on('data', (chunk) => {
        // LSP Framing: accumulate data in buffer and extract full messages
        session.buffer = Buffer.concat([session.buffer, chunk]);
        
        while (true) {
          const content = session.buffer.toString('utf8');
          const headerMatch = content.match(/Content-Length: (\d+)\r\n\r\n/);
          
          if (!headerMatch) break;
          
          const contentLength = parseInt(headerMatch[1], 10);
          const headerSize = headerMatch[0].length;
          const totalSize = headerSize + contentLength;
          
          if (session.buffer.length < totalSize) break;
          
          // We have a full message
          const messageBody = session.buffer.subarray(headerSize, totalSize).toString('utf8');
          
          // Remove from buffer
          session.buffer = session.buffer.subarray(totalSize);
          
          // Send only the JSON body to the client
          callback(messageBody);
        }
      });
      
      session.process.stderr.on('data', (data) => {
        const msg = data.toString();
        if (msg.includes('error') || msg.includes('fail')) {
          logger.debug(`clangd [${sessionId}] stderr: ${msg}`);
        }
      });
    }
  }

  /**
   * Clean up session resources
   * @param {string} sessionId 
   */
  async cleanupSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    logger.info(`Cleaning up LSP session ${sessionId}`);

    try {
      if (!session.process.killed) {
        session.process.kill();
      }
    } catch (e) {
      logger.error(`Error killing clangd process for session ${sessionId}:`, e);
    }

    try {
      // Small delay to ensure process has released files
      await new Promise(resolve => setTimeout(resolve, 500));
      await fs.rm(session.tempDir, { recursive: true, force: true });
    } catch (e) {
      logger.error(`Error removing LSP temp dir for session ${sessionId}: ${e.message}`);
    }

    this.sessions.delete(sessionId);
  }
}

export const lspService = new LSPService();
export default lspService;
