import { spawn } from 'child_process';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { toolchainService } from './toolchain.service.js';

const TARGET_KINDS = new Set(['IfStmt', 'ForStmt', 'WhileStmt', 'DoStmt']);
const BLOCK_KIND = 'CompoundStmt';
const FORBIDDEN_BODY_KINDS = new Set([
  'LabelStmt',
  'CaseStmt',
  'DefaultStmt'
]);

class ControlFlowNormalizerService {
  async normalizeFile(sourceFile, language = 'cpp', outputFile = null) {
    const sourcePath = path.resolve(sourceFile);
    const normalizedPath = outputFile ? path.resolve(outputFile) : this.getNormalizedPath(sourcePath);
    const source = await readFile(sourcePath, 'utf-8');
    const newline = source.includes('\r\n') ? '\r\n' : '\n';

    const context = this.createContext(source, sourcePath, language, newline);
    let insertions = [];

    try {
      const ast = await this.dumpAst(sourcePath, language);
      insertions = this.collectInsertions(ast, context);
    } catch (error) {
      console.warn(`[Normalizer] AST parse failed, writing pass-through file: ${error.message}`);
      await writeFile(normalizedPath, source, 'utf-8');
      return {
        changed: false,
        sourceFile: sourcePath,
        normalizedFile: normalizedPath,
        insertions: 0,
        code: source
      };
    }

    const normalizedCode = this.applyInsertions(source, insertions);
    this.validateInsertionOnly(source, normalizedCode, insertions);

    await writeFile(normalizedPath, normalizedCode, 'utf-8');

    // Validation: reparse normalized source to ensure it stays syntactically valid.
    await this.dumpAst(normalizedPath, language);

    return {
      changed: insertions.length > 0,
      sourceFile: sourcePath,
      normalizedFile: normalizedPath,
      insertions: insertions.length,
      code: normalizedCode
    };
  }

  getNormalizedPath(sourceFile) {
    const ext = path.extname(sourceFile);
    if (!ext) return `${sourceFile}.normalized`;
    return `${sourceFile.slice(0, -ext.length)}.normalized${ext}`;
  }

  createContext(source, sourceFile, language, newline) {
    const lines = source.split(/\r?\n/);
    return {
      source,
      sourceFile,
      normalizedSourceFile: this.normalizePath(sourceFile),
      language,
      newline,
      lines,
      lineStarts: this.computeLineStarts(source),
      skipLines: this.collectSkipLines(lines)
    };
  }

  collectSkipLines(lines) {
    const skip = new Set();
    let ppDepth = 0;

    for (let idx = 0; idx < lines.length; idx++) {
      const lineNo = idx + 1;
      const text = lines[idx] || '';
      const trimmed = text.trimStart();

      if (/^#\s*(if|ifdef|ifndef)\b/.test(trimmed)) {
        ppDepth += 1;
        skip.add(lineNo);
      } else if (/^#\s*(elif|else)\b/.test(trimmed)) {
        if (ppDepth > 0) skip.add(lineNo);
      } else if (/^#\s*endif\b/.test(trimmed)) {
        if (ppDepth > 0) skip.add(lineNo);
        ppDepth = Math.max(0, ppDepth - 1);
      } else if (ppDepth > 0) {
        skip.add(lineNo);
      }

      if (text.includes('__trace_') || text.includes('__codeviz')) {
        skip.add(lineNo);
      }
    }

    return skip;
  }

  computeLineStarts(source) {
    const starts = [0];
    for (let i = 0; i < source.length; i++) {
      if (source[i] === '\n') starts.push(i + 1);
    }
    return starts;
  }

  normalizePath(filePath) {
    return path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
  }

  async dumpAst(sourceFile, language) {
    const lang = language === 'c' ? 'c' : 'cpp';
    const compiler = toolchainService.getCompiler(lang);
    const langMode = lang === 'c' ? 'c' : 'c++';
    const stdFlag = lang === 'c' ? '-std=c11' : '-std=c++17';
    const includeFlags = toolchainService.getIncludeFlags(lang);
    const args = [
      '-x', langMode,
      stdFlag,
      '-fsyntax-only',
      '-Wno-everything',
      '-ferror-limit=0',
      '-Xclang', '-ast-dump=json',
      ...includeFlags,
      sourceFile
    ];

    const { stdout, stderr, code } = await this.runCompiler(compiler, args);
    if (code !== 0) {
      throw new Error(`clang AST dump failed (${code}): ${stderr.trim()}`);
    }

    const start = stdout.indexOf('{');
    const end = stdout.lastIndexOf('}');
    if (start < 0 || end <= start) {
      throw new Error('clang AST output did not contain JSON payload');
    }

    try {
      return JSON.parse(stdout.slice(start, end + 1));
    } catch (error) {
      throw new Error(`Failed to parse clang AST JSON: ${error.message}`);
    }
  }

  runCompiler(compiler, args) {
    return new Promise((resolve, reject) => {
      const proc = spawn(compiler, args, {
        env: toolchainService.getRuntimeEnv()
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('error', reject);
      proc.on('close', code => resolve({ code, stdout, stderr }));
    });
  }

  collectInsertions(ast, context) {
    const insertions = [];
    const seen = new Set();

    const visit = (node) => {
      if (!node || typeof node !== 'object') return;

      if (TARGET_KINDS.has(node.kind)) {
        this.collectNodeInsertions(node, context, insertions, seen);
      }

      if (Array.isArray(node.inner)) {
        for (const child of node.inner) visit(child);
      }
    };

    visit(ast);
    return insertions;
  }

  collectNodeInsertions(node, context, insertions, seen) {
    if (!this.nodeIsInSourceFile(node, context)) return;
    if (this.nodeTouchesSkippedLines(node, context)) return;
    if (this.nodeUsesMacroLocation(node)) return;

    if (node.kind === 'IfStmt') {
      this.collectIfInsertions(node, context, insertions, seen);
      return;
    }

    if (node.kind === 'ForStmt') {
      const body = this.extractForBody(node);
      this.collectSimpleControlInsertions(node, body, 'for', context, insertions, seen);
      return;
    }

    if (node.kind === 'WhileStmt') {
      const body = this.extractWhileBody(node);
      this.collectSimpleControlInsertions(node, body, 'while', context, insertions, seen);
      return;
    }

    if (node.kind === 'DoStmt') {
      this.collectDoWhileInsertions(node, context, insertions, seen);
    }
  }

  collectIfInsertions(ifNode, context, insertions, seen) {
    const children = Array.isArray(ifNode.inner)
      ? ifNode.inner.filter(c => c && typeof c === 'object' && c.kind)
      : [];
    if (children.length < 2) return;

    const thenBody = children[1];
    const elseBody = ifNode.hasElse ? children[2] : null;

    if (this.shouldNormalizeBody(ifNode, thenBody, context)) {
      const thenOpen = this.findHeaderInsertionOffset(ifNode, thenBody, 'if', context);
      if (thenOpen != null && thenOpen >= 0 && thenOpen <= context.source.length) {
        this.pushInsertion(insertions, seen, thenOpen, ' {');

        const elseKeyword = elseBody
          ? this.findElseKeywordToken(ifNode, thenBody, elseBody, context)
          : null;

        if (elseKeyword) {
          this.pushInsertion(insertions, seen, elseKeyword.start, '} ');
        } else {
          this.pushClosingOnOwnLine(insertions, seen, ifNode, thenBody, context);
        }
      }
    }

    if (elseBody && elseBody.kind !== 'IfStmt' && this.shouldNormalizeBody(ifNode, elseBody, context)) {
      const elseKeyword = this.findElseKeywordToken(ifNode, thenBody, elseBody, context);
      if (!elseKeyword) return;

      if (elseKeyword.end == null || elseKeyword.end < 0 || elseKeyword.end > context.source.length) return;
      this.pushInsertion(insertions, seen, elseKeyword.end, ' {');
      this.pushClosingOnOwnLine(insertions, seen, ifNode, elseBody, context);
    }
  }

  collectSimpleControlInsertions(node, body, keyword, context, insertions, seen) {
    if (!this.shouldNormalizeBody(node, body, context)) return;

    const openOffset = this.findHeaderInsertionOffset(node, body, keyword, context);
    if (openOffset == null || openOffset < 0 || openOffset > context.source.length) return;
    this.pushInsertion(insertions, seen, openOffset, ' {');
    this.pushClosingOnOwnLine(insertions, seen, node, body, context);
  }

  collectDoWhileInsertions(node, context, insertions, seen) {
    const body = this.extractDoBody(node);
    if (!this.shouldNormalizeBody(node, body, context)) return;

    const doToken = this.findKeywordToken('do', this.getNodeStartOffset(node), this.getNodeStartOffset(body), context.source);
    if (!doToken) return;
    if (doToken.end == null || doToken.end < 0 || doToken.end > context.source.length) return;

    this.pushInsertion(insertions, seen, doToken.end, ' {');

    const whileToken = this.findDoWhileToken(node, body, context);
    if (whileToken) {
      this.pushInsertion(insertions, seen, whileToken.start, '} ');
    } else {
      this.pushClosingOnOwnLine(insertions, seen, node, body, context);
    }
  }

  shouldNormalizeBody(controlNode, bodyNode, context) {
    if (!bodyNode || typeof bodyNode !== 'object') return false;
    if (bodyNode.kind === BLOCK_KIND) return false;
    if (this.nodeUsesMacroLocation(controlNode) || this.nodeUsesMacroLocation(bodyNode)) return false;
    if (!this.nodeIsInSourceFile(bodyNode, context)) return false;
    if (this.nodeTouchesSkippedLines(bodyNode, context)) return false;
    if (this.subtreeHasForbiddenKinds(bodyNode)) return false;
    return true;
  }

  subtreeHasForbiddenKinds(node) {
    if (!node || typeof node !== 'object') return false;
    if (FORBIDDEN_BODY_KINDS.has(node.kind)) return true;

    if (!Array.isArray(node.inner)) return false;
    for (const child of node.inner) {
      if (this.subtreeHasForbiddenKinds(child)) return true;
    }
    return false;
  }

  pushClosingOnOwnLine(insertions, seen, controlNode, bodyNode, context) {
    const bodyEnd = this.getStatementEndOffset(bodyNode, context.source);
    if (bodyEnd == null) return;

    const bodyEndLine = this.offsetToLine(bodyEnd > 0 ? bodyEnd - 1 : bodyEnd, context.lineStarts);
    const lineEnd = this.getLineEndOffset(bodyEndLine, context);
    const indent = this.getNodeIndent(controlNode, context);
    this.pushInsertion(insertions, seen, lineEnd, `${context.newline}${indent}}`);
  }

  pushInsertion(insertions, seen, offset, text) {
    if (offset == null || offset < 0) return;
    const key = `${offset}:${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    insertions.push({ offset, text });
  }

  nodeIsInSourceFile(node, context) {
    const locs = [
      this.resolveLoc(node?.loc),
      this.resolveLoc(node?.range?.begin),
      this.resolveLoc(node?.range?.end)
    ].filter(Boolean);

    const files = locs
      .map(l => l.file)
      .filter(Boolean)
      .map(f => this.normalizePath(f));

    if (files.length > 0) {
      return files.every(f => f === context.normalizedSourceFile);
    }

    // If we don't have explicit file info, be conservative: locations tied to
    // `includedFrom` are almost certainly from headers/includes.
    if (locs.some(l => l?.includedFrom?.file)) return false;

    // Some clang AST JSON nodes omit `file` for main-file locations; treat these
    // as in-file to preserve normalization for those nodes.
    return true;
  }

  nodeTouchesSkippedLines(node, context) {
    const range = this.getRangeLoc(node);
    if (!range || !range.begin || !range.end) return false;
    const beginLine = range.begin.line;
    const endLine = range.end.line || beginLine;
    if (!beginLine || !endLine) return false;

    for (let line = beginLine; line <= endLine; line++) {
      if (context.skipLines.has(line)) return true;
    }
    return false;
  }

  nodeUsesMacroLocation(node) {
    const range = node?.range;
    if (!range) return false;
    return this.locUsesMacro(range.begin) || this.locUsesMacro(range.end) || this.locUsesMacro(node.loc);
  }

  locUsesMacro(loc) {
    if (!loc || typeof loc !== 'object') return false;
    if (loc.expansionLoc || loc.spellingLoc || loc.isMacroArgExpansion) return true;
    return false;
  }

  getRangeLoc(node) {
    const begin = this.resolveLoc(node?.range?.begin);
    const end = this.resolveLoc(node?.range?.end);
    if (!begin || !end) return null;
    return { begin, end };
  }

  getBeginLoc(node) {
    const rangeBegin = this.resolveLoc(node?.range?.begin);
    if (rangeBegin) return rangeBegin;
    return this.resolveLoc(node?.loc);
  }

  resolveLoc(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.expansionLoc) return this.resolveLoc(raw.expansionLoc);
    if (raw.spellingLoc) return this.resolveLoc(raw.spellingLoc);
    return raw;
  }

  getNodeStartOffset(node) {
    return this.getBeginLoc(node)?.offset ?? null;
  }

  getNodeEndTokenOffset(node) {
    const end = this.resolveLoc(node?.range?.end);
    if (!end || end.offset == null) return null;
    return end.offset + (end.tokLen || 0);
  }

  getStatementEndOffset(node, source) {
    const tokenEnd = this.getNodeEndTokenOffset(node);
    if (tokenEnd == null) return null;

    let cursor = tokenEnd;
    while (cursor < source.length && (source[cursor] === ' ' || source[cursor] === '\t' || source[cursor] === '\r')) {
      cursor += 1;
    }

    if (cursor < source.length && source[cursor] === ';') {
      return cursor + 1;
    }

    return tokenEnd;
  }

  extractForBody(node) {
    const children = Array.isArray(node?.inner) ? node.inner : [];
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child && typeof child === 'object' && child.kind) return child;
    }
    return null;
  }

  extractWhileBody(node) {
    const children = Array.isArray(node?.inner)
      ? node.inner.filter(c => c && typeof c === 'object' && c.kind)
      : [];
    return children.length >= 2 ? children[1] : null;
  }

  extractDoBody(node) {
    const children = Array.isArray(node?.inner)
      ? node.inner.filter(c => c && typeof c === 'object' && c.kind)
      : [];
    return children.length > 0 ? children[0] : null;
  }

  findHeaderInsertionOffset(controlNode, bodyNode, keyword, context) {
    const controlStart = this.getNodeStartOffset(controlNode);
    const bodyStart = this.getNodeStartOffset(bodyNode);
    if (controlStart == null || bodyStart == null) return null;

    if (keyword === 'do') {
      const token = this.findKeywordToken('do', controlStart, bodyStart, context.source);
      return token ? token.end : null;
    }

    if (keyword === 'if' || keyword === 'for' || keyword === 'while') {
      return this.findParenHeaderEnd(controlStart, bodyStart, keyword, context.source);
    }

    return null;
  }

  findParenHeaderEnd(controlStart, limit, keyword, source) {
    const token = this.findKeywordToken(keyword, controlStart, limit, source);
    if (!token) return null;

    let openParen = -1;
    for (let idx = token.end; idx < limit; idx++) {
      if (source[idx] === '(') {
        openParen = idx;
        break;
      }
    }
    if (openParen < 0) return null;

    const closeParen = this.findMatchingParen(source, openParen, limit);
    if (closeParen < 0) return null;
    return closeParen + 1;
  }

  findMatchingParen(source, openParen, limit) {
    let depth = 0;
    let inString = false;
    let inChar = false;
    let inLineComment = false;
    let inBlockComment = false;
    let escape = false;

    for (let idx = openParen; idx < Math.min(source.length, limit); idx++) {
      const c = source[idx];
      const next = idx + 1 < source.length ? source[idx + 1] : '';

      if (inLineComment) {
        if (c === '\n') inLineComment = false;
        continue;
      }

      if (inBlockComment) {
        if (c === '*' && next === '/') {
          inBlockComment = false;
          idx += 1;
        }
        continue;
      }

      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (c === '\\') {
          escape = true;
          continue;
        }
        if (c === '"') inString = false;
        continue;
      }

      if (inChar) {
        if (escape) {
          escape = false;
          continue;
        }
        if (c === '\\') {
          escape = true;
          continue;
        }
        if (c === '\'') inChar = false;
        continue;
      }

      if (c === '/' && next === '/') {
        inLineComment = true;
        idx += 1;
        continue;
      }

      if (c === '/' && next === '*') {
        inBlockComment = true;
        idx += 1;
        continue;
      }

      if (c === '"') {
        inString = true;
        continue;
      }

      if (c === '\'') {
        inChar = true;
        continue;
      }

      if (c === '(') depth += 1;
      if (c === ')') {
        depth -= 1;
        if (depth === 0) return idx;
      }
    }

    return -1;
  }

  findKeywordToken(keyword, start, end, source) {
    const tokens = this.scanWordTokens(source, start, end);
    for (const token of tokens) {
      if (token.word === keyword) return token;
    }
    return null;
  }

  findElseKeywordToken(ifNode, thenBody, elseBody, context) {
    const thenEnd = this.getStatementEndOffset(thenBody, context.source) ?? this.getNodeEndTokenOffset(thenBody);
    const elseStart = this.getNodeStartOffset(elseBody);
    if (thenEnd == null || elseStart == null || elseStart <= thenEnd) return null;
    return this.findKeywordToken('else', thenEnd, elseStart, context.source);
  }

  findDoWhileToken(doNode, bodyNode, context) {
    const bodyEnd = this.getStatementEndOffset(bodyNode, context.source) ?? this.getNodeEndTokenOffset(bodyNode);
    const doEnd = this.getNodeEndTokenOffset(doNode);
    if (bodyEnd == null || doEnd == null || doEnd <= bodyEnd) return null;
    return this.findKeywordToken('while', bodyEnd, doEnd, context.source);
  }

  scanWordTokens(source, start, end) {
    const tokens = [];
    const max = Math.min(source.length, end);

    let idx = Math.max(0, start);
    let inString = false;
    let inChar = false;
    let inLineComment = false;
    let inBlockComment = false;
    let escape = false;

    while (idx < max) {
      const c = source[idx];
      const next = idx + 1 < source.length ? source[idx + 1] : '';

      if (inLineComment) {
        if (c === '\n') inLineComment = false;
        idx += 1;
        continue;
      }

      if (inBlockComment) {
        if (c === '*' && next === '/') {
          inBlockComment = false;
          idx += 2;
          continue;
        }
        idx += 1;
        continue;
      }

      if (inString) {
        if (escape) {
          escape = false;
          idx += 1;
          continue;
        }
        if (c === '\\') {
          escape = true;
          idx += 1;
          continue;
        }
        if (c === '"') inString = false;
        idx += 1;
        continue;
      }

      if (inChar) {
        if (escape) {
          escape = false;
          idx += 1;
          continue;
        }
        if (c === '\\') {
          escape = true;
          idx += 1;
          continue;
        }
        if (c === '\'') inChar = false;
        idx += 1;
        continue;
      }

      if (c === '/' && next === '/') {
        inLineComment = true;
        idx += 2;
        continue;
      }

      if (c === '/' && next === '*') {
        inBlockComment = true;
        idx += 2;
        continue;
      }

      if (c === '"') {
        inString = true;
        idx += 1;
        continue;
      }

      if (c === '\'') {
        inChar = true;
        idx += 1;
        continue;
      }

      if (/[A-Za-z_]/.test(c)) {
        let j = idx + 1;
        while (j < max && /[A-Za-z0-9_]/.test(source[j])) j += 1;
        tokens.push({ word: source.slice(idx, j), start: idx, end: j });
        idx = j;
        continue;
      }

      idx += 1;
    }

    return tokens;
  }

  getNodeIndent(node, context) {
    const begin = this.getBeginLoc(node);
    const lineNo = begin?.line;
    if (!lineNo || lineNo <= 0 || lineNo > context.lines.length) return '';
    const line = context.lines[lineNo - 1] || '';
    const match = line.match(/^\s*/);
    return match ? match[0] : '';
  }

  offsetToLine(offset, lineStarts) {
    if (offset <= 0) return 1;
    let lo = 0;
    let hi = lineStarts.length - 1;
    let ans = 0;

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (lineStarts[mid] <= offset) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    return ans + 1;
  }

  getLineEndOffset(lineNo, context) {
    const { lineStarts, source } = context;
    if (lineNo <= 0) return 0;

    const lineIdx = lineNo - 1;
    const start = lineStarts[lineIdx] ?? 0;
    const nextStart = lineIdx + 1 < lineStarts.length ? lineStarts[lineIdx + 1] : source.length;
    let end = nextStart;

    if (end > start && source[end - 1] === '\n') end -= 1;
    if (end > start && source[end - 1] === '\r') end -= 1;
    return end;
  }

  applyInsertions(source, insertions) {
    if (!insertions.length) return source;

    const sorted = [...insertions].sort((a, b) => b.offset - a.offset);
    let output = source;
    for (const insertion of sorted) {
      if (insertion.offset < 0 || insertion.offset > output.length) continue;
      output = output.slice(0, insertion.offset) + insertion.text + output.slice(insertion.offset);
    }
    return output;
  }

  validateInsertionOnly(original, transformed, insertions) {
    for (const insertion of insertions) {
      if (!/^[\s{}]+$/.test(insertion.text)) {
        throw new Error(`Invalid insertion text "${insertion.text}"`);
      }
    }

    const rebuilt = this.applyInsertions(original, insertions);
    if (rebuilt !== transformed) {
      throw new Error('Insertion validation failed: transformed output mismatch');
    }
  }
}

export const controlFlowNormalizer = new ControlFlowNormalizerService();
export default controlFlowNormalizer;
