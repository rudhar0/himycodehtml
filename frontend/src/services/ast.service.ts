
import * as Parser from 'web-tree-sitter';
import { Language } from '../types';

class AstService {
  private parser: any | null = null;
  private isInitializing = false;

  async initialize(language: Language) {
    if (this.parser || this.isInitializing) return;
    this.isInitializing = true;

    try {
      let P = (Parser as any).default || Parser;
      if (typeof P !== 'function' && P.Parser) {
        P = P.Parser;
      }

      console.log('[AstService] Initializing with language:', language);

      if (typeof P.init !== 'function') {
        throw new Error(`web-tree-sitter 'init' is not a function. Check library version.`);
      }

      // Robust base directory detection
      const getBaseDir = () => {
        try {
          // If we're in a browser/Neutralino environment
          const path = window.location.pathname;
          const directory = path.substring(0, path.lastIndexOf('/') + 1);
          // Ensure it starts with / if it doesn't look like a protocol-relative or absolute path
          return directory || './';
        } catch {
          return './';
        }
      };
      
      const baseDir = getBaseDir();
      console.log('[AstService] Base directory for WASM:', baseDir);

      await P.init({
        locateFile: (scriptName: string) => {
          const url = `${baseDir}${scriptName}`.replace(/\/+/g, '/');
          // Fix for file:// protocol on Windows which might result in extra leading slash
          if (window.location.protocol === 'file:' && url.startsWith('//')) {
             return url.substring(1);
          }
          return url;
        },
      });
      
      const parser = new P();
      const langFile = language === 'c' ? 'tree-sitter-c.wasm' : 'tree-sitter-cpp.wasm';
      const langUrl = `${baseDir}${langFile}`.replace(/\/+/g, '/');
      
      console.log('[AstService] Loading language WASM from:', langUrl);
      
      try {
        const Lang = await P.Language.load(langUrl);
        parser.setLanguage(Lang);
        this.parser = parser;
        console.log('[AstService] Parser initialized successfully for', language);
      } catch (e) {
        console.error(`[AstService] Failed to load language WASM (${langUrl}):`, e);
        // Try fallback to root if baseDir was nested
        if (baseDir !== '/' && baseDir !== './') {
          console.log('[AstService] Retrying from root...');
          try {
            const Lang = await P.Language.load(`/${langFile}`);
            parser.setLanguage(Lang);
            this.parser = parser;
            console.log('[AstService] Parser initialized successfully from root');
          } catch (retryErr) {
            console.error('[AstService] Fallback also failed:', retryErr);
          }
        }
      }
    } catch (error) {
      console.error('[AstService] Critical initialization error:', error);
      this.parser = null;
    } finally {
      this.isInitializing = false;
    }
  }
  
  parse(code: string): any | null {
    if (code) this.lastCode = code;
    if (!this.parser) {
      return null;
    }
    return this.parser.parse(code);
  }

  getTokens(code?: string): any[] {
    if (code) this.lastCode = code;
    if (!this.parser) {
      console.warn('[AstService] Parser not initialized while calling getTokens');
      return [];
    }
    
    try {
      const tree = this.parser.parse(this.lastCode || '');
      const tokens: any[] = [];
      
      const traverse = (node: any) => {
        if (node.childCount === 0 && node.text.trim().length > 0) {
          tokens.push({
            type: node.type,
            text: node.text,
            startPosition: node.startPosition,
            endPosition: node.endPosition,
          });
        }
        for (let i = 0; i < node.childCount; i++) {
          traverse(node.child(i));
        }
      };
      
      traverse(tree.rootNode);
      return tokens;
    } catch (e) {
      console.error('[AstService] Error during tokenization:', e);
      return [];
    }
  }

  getSymbols(code?: string): any[] {
    if (code) this.lastCode = code;
    if (!this.parser) return [];
    
    try {
      const tree = this.parser.parse(this.lastCode || '');
      const symbols: any[] = [];
      
      const traverse = (node: any) => {
        let symbol: any = null;

        if (node.type === 'function_definition') {
          // Find identifier in the declarator
          const declarator = node.childForFieldName('declarator');
          const identifier = this.findFirstIdentifier(declarator);
          symbol = {
            name: identifier ? identifier.text : 'anonymous',
            kind: 'function',
            nodeType: node.type,
            line: node.startPosition.row + 1,
            signature: node.text.split('{')[0].trim() || 'void function()',
          };
        } else if (node.type === 'declaration' || node.type === 'field_declaration') {
          // Check if it's a variable or just a type
          const declarator = node.childForFieldName('declarator') || node.children.find((c: any) => c.type === 'init_declarator');
          if (declarator) {
             const identifier = this.findFirstIdentifier(declarator);
             if (identifier) {
               symbol = {
                 name: identifier.text,
                 kind: node.type === 'field_declaration' ? 'field' : 'variable',
                 nodeType: node.type,
                 line: node.startPosition.row + 1,
                 signature: node.text.replace(';', '').trim(),
               };
             }
          }
        } else if (node.type === 'struct_specifier' || node.type === 'class_specifier' || node.type === 'enum_specifier') {
          const nameNode = node.childForFieldName('name');
          if (nameNode) {
            symbol = {
              name: nameNode.text,
              kind: node.type.replace('_specifier', ''),
              nodeType: node.type,
              line: node.startPosition.row + 1,
              signature: node.text.split('{')[0].trim(),
            };
          }
        }

        if (symbol) {
          symbols.push(symbol);
        }

        for (let i = 0; i < node.childCount; i++) {
          traverse(node.child(i));
        }
      };
      
      traverse(tree.rootNode);
      return symbols;
    } catch (e) {
      console.error('[AstService] Error during symbol extraction:', e);
      return [];
    }
  }

  private findFirstIdentifier(node: any): any | null {
    if (!node) return null;
    if (node.type === 'identifier' || node.type === 'field_identifier') return node;
    for (let i = 0; i < node.childCount; i++) {
      const found = this.findFirstIdentifier(node.child(i));
      if (found) return found;
    }
    return null;
  }

  private lastCode: string = '';
  setLastCode(code: string) {
    this.lastCode = code;
  }

  isInitialized(): boolean {
    return this.parser !== null;
  }
}

export const astService = new AstService();
