
import * as Parser from 'web-tree-sitter';
import { Language } from '../types';

class AstService {
  private parser: any = null;

  async initialize(language: Language) {
    try {
      // web-tree-sitter initialization
      const P = Parser as any;
      if (typeof P.init === 'function') {
        await P.init();
      }
      const parser = new P.Parser();
      const langUrl = `./${language === 'c' ? 'tree-sitter-c.wasm' : 'tree-sitter-cpp.wasm'}`;
      const lang = await P.Language.load(langUrl);
      parser.setLanguage(lang);
      this.parser = parser;
    } catch (error) {
      console.warn('[AstService] Failed to initialize AST parser:', error);
      // Continue without AST parser - it's not critical for visualization
      this.parser = null;
    }
  }

  parse(code: string): any | null {
    if (!this.parser) {
      console.error('AST parser has not been initialized.');
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
