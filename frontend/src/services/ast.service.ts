
import * as Parser from 'web-tree-sitter';
import { Language } from '../types';

class AstService {
  private parser: any | null = null;
  private isInitializing = false;

  async initialize(language: Language) {
    if (this.parser || this.isInitializing) return;
    this.isInitializing = true;

    try {
      // Cast to any to bypass TS namespace issues with web-tree-sitter
      let P = (Parser as any).default || Parser;
      
      // In some bundled environments, P might be the module object itself
      if (typeof P !== 'function' && P.Parser) {
        P = P.Parser;
      }

      console.log('[AstService] Using Parser:', typeof P, P?.name || 'anonymous');

      if (typeof P.init !== 'function') {
        throw new Error(`web-tree-sitter 'init' is not a function (found ${typeof P.init}). Check library version and ESM/CJS interop.`);
      }

      // Official web-tree-sitter init pattern for Vite/likely environments
      // We detect the base path (e.g., /resources/ in production) to ensure WASM files are found.
      const getBaseDir = () => {
        const path = window.location.pathname;
        return path.substring(0, path.lastIndexOf('/') + 1);
      };
      
      const baseDir = getBaseDir();

      await P.init({
        locateFile: (scriptName: string) => {
          return `${baseDir}${scriptName}`;
        },
      });
      
      const parser = new P();
      const langUrl = `${baseDir}${language === 'c' ? 'tree-sitter-c.wasm' : 'tree-sitter-cpp.wasm'}`;
      
      try {
        const Lang = await P.Language.load(langUrl);
        parser.setLanguage(Lang);
        this.parser = parser;
        console.log('[AstService] Parser initialized successfully');
      } catch (e) {
        console.warn(`[AstService] Failed to load language WASM from ${langUrl}:`, e);
      }
    } catch (error) {
      console.warn('[AstService] Failed to initialize AST parser:', error);
      // Continue without AST parser - it's not critical for visualization
      this.parser = null;
    } finally {
      this.isInitializing = false;
    }
  }
  
  parse(code: string): any | null {
    if (!this.parser) {
      // console.warn('AST parser has not been initialized.');
      return null;
    }
    return this.parser.parse(code);
  }

  getTreeSitter() {
    return this.parser;
  }

  isInitialized(): boolean {
    return this.parser !== null;
  }
}

export const astService = new AstService();
