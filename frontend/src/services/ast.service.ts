
import * as Parser from 'web-tree-sitter';
import { Language } from '../types';

class AstService {
  private parser: Parser.Parser | null = null;

  async initialize(language: Language) {
    try {
      // web-tree-sitter might not have init() in all versions
      if (typeof Parser.init === 'function') {
        await Parser.init();
      }
      const parser = new Parser.Parser();
      const langUrl = `/${language === 'c' ? 'tree-sitter-c.wasm' : 'tree-sitter-cpp.wasm'}`;
      const lang = await Parser.Language.load(langUrl);
      parser.setLanguage(lang);
      this.parser = parser;
    } catch (error) {
      console.warn('[AstService] Failed to initialize AST parser:', error);
      // Continue without AST parser - it's not critical for visualization
      this.parser = null;
    }
  }

  parse(code: string): Parser.Tree | null {
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
