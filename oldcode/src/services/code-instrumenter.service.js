// backend/src/services/code-instrumenter.service.js
import { spawn } from 'child_process';
import { writeFile, readFile, unlink } from 'fs/promises';
import path from 'path';
import { v4 as uuid } from 'uuid';

let loopIdCounter = 0;
let blockDepthCounter = 0;
let conditionIdCounter = 0;

class CodeInstrumenter {
  constructor() {
    this.tempDir = path.join(process.cwd(), 'temp');
    this.scopeVariables = new Map();
    this.currentScope = 0;
    this.pointerAliases = new Map();
    this.blockDepth = 0;
    this.loopStack = [];
  }

  async instrumentCode(code, language = 'cpp') {
    console.log('🔧 Instrumenting code (beginner-correct mode)...');

    try {
      const withHeader = this.addTraceHeader(code);
      const traced = await this.injectBeginnerModeTracing(withHeader, language);
      console.log('✅ Code instrumentation complete');
      return traced;
    } catch (error) {
      console.error('⚠️ Instrumentation failed, using original code:', error.message);
      return code;
    }
  }

  addTraceHeader(code) {
    if (code.includes('trace.h')) return code;
    const lines = code.split('\n');
    let insertIdx = 0;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t.startsWith('#include')) insertIdx = i + 1;
      else if (t && !t.startsWith('#') && !t.startsWith('//')) break;
    }
    lines.splice(insertIdx, 0, '#include "trace.h"');
    return lines.join('\n');
  }

  isArrayDeclaration(varDecl) {
    return /\[/.test(varDecl);
  }

  parseArrayDeclaration(type, varDecl) {
    const nameMatch = varDecl.match(/^(\w+)/);
    if (!nameMatch) return null;

    const name = nameMatch[1];
    const dimensionsMatch = varDecl.match(/\[([^\]]*)\]/g);
    if (!dimensionsMatch) return null;

    const dimensions = dimensionsMatch.map(d => {
      const sizeMatch = d.match(/\[([^\]]*)\]/);
      return sizeMatch && sizeMatch[1] ? sizeMatch[1] : '0';
    });

    const hasInitializer = varDecl.includes('=');
    let initValues = null;
    let isStringLiteral = false;

    if (hasInitializer) {
      const strMatch = varDecl.match(/=\s*"([^"]*)"/);
      if (strMatch) {
        initValues = strMatch[1];
        isStringLiteral = true;
      } else {
        const initMatch = varDecl.match(/=\s*\{([^}]*)\}/);
        if (initMatch) {
          initValues = initMatch[1];
        }
      }
    }

    return { name, type, dimensions, hasInitializer, initValues, isStringLiteral };
  }

  parseMultiDeclaration(rest) {
    const vars = [];
    let current = '';
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;

    for (let c of rest) {
      if (c === '(') parenDepth++;
      else if (c === ')') parenDepth--;
      else if (c === '{') braceDepth++;
      else if (c === '}') braceDepth--;
      else if (c === '[') bracketDepth++;
      else if (c === ']') bracketDepth--;

      if (c === ',' && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
        const trimmed = current.trim();
        if (trimmed) vars.push(trimmed);
        current = '';
      } else {
        current += c;
      }
    }

    const trimmed = current.trim();
    if (trimmed) vars.push(trimmed);
    return vars;
  }

  extractVariableName(varDecl) {
    let cleaned = varDecl.replace(/\s*=\s*\{[^}]*\}/g, '');
    cleaned = cleaned.replace(/\s*=.*$/, '');
    cleaned = cleaned.replace(/^\s*\*+\s*/, '');
    const match = cleaned.match(/^(\w+)/);
    return match ? match[1] : null;
  }

  hasInitializer(varDecl) {
    return varDecl.includes('=');
  }

  extractInitializer(varDecl) {
    const match = varDecl.match(/=\s*(.+)$/);
    return match ? match[1].trim() : null;
  }

  isArrayDecay(value) {
    const trimmed = value.trim();
    if (/^\w+$/.test(trimmed)) return trimmed;
    if (/^&\w+\[0\]$/.test(trimmed)) {
      const match = trimmed.match(/^&(\w+)\[0\]$/);
      return match ? match[1] : null;
    }
    if (/^\(\w+\)$/.test(trimmed)) {
      const match = trimmed.match(/^\((\w+)\)$/);
      return match ? match[1] : null;
    }
    return null;
  }

  isHeapAllocation(value) {
    return /\b(malloc|calloc|new)\s*[\(\[]/.test(value);
  }

  isBreakOrContinue(trimmed) {
    return /^\s*(break|continue)\s*;/.test(trimmed);
  }

  isVariableDeclaredInScope(varName, scope) {
    const key = `${scope}:${varName}`;
    return this.scopeVariables.has(key);
  }

  markVariableDeclared(varName, scope) {
    const key = `${scope}:${varName}`;
    this.scopeVariables.set(key, true);
  }

  countBraces(line) {
    let open = 0;
    let close = 0;
    let inString = false;
    let inChar = false;
    let escape = false;

    for (let i = 0; i < line.length; i++) {
      const c = line[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (c === '\\') {
        escape = true;
        continue;
      }

      if (c === '"' && !inChar) {
        inString = !inString;
        continue;
      }

      if (c === "'" && !inString) {
        inChar = !inChar;
        continue;
      }

      if (inString || inChar) continue;

      if (c === '/' && i + 1 < line.length && line[i + 1] === '/') {
        break;
      }

      if (c === '{') open++;
      if (c === '}') close++;
    }

    return { open, close };
  }

  isFunctionDefinitionStart(line, globalBraceDepth) {
    if (globalBraceDepth !== 0) return null;

    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) return null;

    const funcPattern = /^\s*(static\s+)?(inline\s+)?(const\s+)?(unsigned\s+|signed\s+)?(void|int|long|float|double|char|bool|auto|short|size_t)\s*\**\s*(\w+)\s*\([^;]*$/;
    const match = trimmed.match(funcPattern);
    if (match) {
      return match[6];
    }

    return null;
  }

  async injectBeginnerModeTracing(code, language) {
    const lines = code.split('\n');
    const out = [];

    let globalBraceDepth = 0;
    let inStruct = false;
    let inClass = false;
    let inFunction = false;
    let functionBraceDepth = 0;
    let currentFunction = 'main';
    let scopeStack = [0];
    let pendingFunctionDef = null;
    this.functionParams = new Map();
    this.pendingCalls = new Map();
    this.currentScope = 0;
    this.scopeVariables.clear();
    this.functionParamInfo = new Map();
    loopIdCounter = 0;
    blockDepthCounter = 0;
    conditionIdCounter = 0;
    this.blockDepth = 0;
    this.loopStack = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      const indent = line.match(/^\s*/)[0];

      const { open: openBraces, close: closeBraces } = this.countBraces(line);

      if (trimmed.match(/^\s*(struct|class)\s+\w+/) && !trimmed.includes(';')) {
        inStruct = true;
      }

      if (!inFunction && !inStruct && !inClass) {
        const funcName = this.isFunctionDefinitionStart(line, globalBraceDepth);
        if (funcName) {
          inFunction = true;
          functionBraceDepth = 0;
          currentFunction = funcName;
          pendingFunctionDef = line;
          const paramMatch = line.match(/\(([^)]*)\)/);
          if (paramMatch) {
            const rawParams = paramMatch[1].split(',').map(p => p.trim()).filter(p => p);
            const paramsInfo = rawParams.map(p => {
              const parts = p.split(/\s+/);
              const namePart = parts.pop();
              const varName = namePart.replace(/^\*+/, '');
              const isPointer = /\*/.test(p);
              return { varName, isPointer };
            });
            this.functionParamInfo.set(funcName, paramsInfo);
          }
          console.log(`✓ Function definition at line ${i + 1}: ${trimmed.substring(0, 50)}`);
        }
      }

      if (!inFunction) {
        globalBraceDepth += openBraces - closeBraces;

        if (inStruct && globalBraceDepth === 0 && closeBraces > 0) {
          inStruct = false;
        }
        if (inClass && globalBraceDepth === 0 && closeBraces > 0) {
          inClass = false;
        }

        out.push(line);
        continue;
      }

      functionBraceDepth += openBraces - closeBraces;
      globalBraceDepth += openBraces - closeBraces;

      if (functionBraceDepth === 0 && closeBraces > 0) {
        inFunction = false;
        out.push(line);
        continue;
      }

      if (functionBraceDepth < 0) {
        inFunction = false;
        out.push(line);
        continue;
      }

      if (openBraces > 0) {
        for (let b = 0; b < openBraces; b++) {
          this.currentScope++;
          scopeStack.push(this.currentScope);
          this.blockDepth++;
        }
        if (pendingFunctionDef) {
          out.push(line);
          const paramMatch = pendingFunctionDef.match(/\(([^)]*)\)/);
          if (paramMatch) {
              const params = paramMatch[1].split(',').map(p => p.trim()).filter(p => p && p.toLowerCase() !== 'void');
              for (const p of params) {
                  if (p.includes('*') || p.includes('[]')) {
                      const parts = p.replace(/\[\]/g, '*').split(/\s+/);
                      const namePart = parts.pop();
                      const varName = namePart.replace(/^\*+/, '');
                      const isArrayDecay = p.includes('[]');
                      out.push(`${indent}  __trace_pointer_alias(${varName}, ${varName}, ${isArrayDecay}, ${i + 1});`);
                  }
              }
          }
          pendingFunctionDef = null;
          continue; 
        }
      }

      if (closeBraces > 0) {
        for (let b = 0; b < closeBraces; b++) {
          scopeStack.pop();
          this.blockDepth--;
        }
      }

      if (trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('#')) {
        out.push(line);
        continue;
      }

      if (this.isFunctionDefinitionStart(line, 0)) {
        out.push(line);
        continue;
      }

      const returnStmt = trimmed.match(/^\s*return\s+([^;]+);/);
      if (returnStmt) {
        const returnValue = returnStmt[1];
        out.push(`${indent}__trace_output_flush(${i + 1});`);
        out.push(`${indent}__trace_return(${returnValue}, "auto", "", ${i + 1});`);
        out.push(line);
        continue;
      }

      if (this.isBreakOrContinue(trimmed)) {
        const controlType = trimmed.match(/^\s*(break|continue)/)[1];
        out.push(line);
        out.push(`${indent}__trace_control_flow("${controlType}", ${i + 1});`);
        continue;
      }

      const ptrDeref = trimmed.match(/^\s*\*\s*(\w+)\s*=\s*([^;]+);/);
      if (ptrDeref) {
        const [, ptrName, value] = ptrDeref;
        out.push(line);
        out.push(`${indent}__trace_pointer_deref_write(${ptrName}, ${value}, ${i + 1});`);
        continue;
      }

      const multiDecl = trimmed.match(/^\s*(int|long|float|double|char|bool)\s+(.+);$/);
      if (multiDecl && multiDecl[2].includes(',')) {
        const [, type, rest] = multiDecl;
        const vars = this.parseMultiDeclaration(rest);
        for (let idx = 0; idx < vars.length; idx++) {
          const varDecl = vars[idx];
          if (this.isArrayDeclaration(varDecl)) {
            const arrayInfo = this.parseArrayDeclaration(type, varDecl);
            if (arrayInfo) {
              const { name, dimensions, hasInitializer, initValues, isStringLiteral } = arrayInfo;
              const dimArgs = dimensions.slice(0, 3).join(',');
              const paddedDims = dimensions.length === 1 ? `${dimArgs},0,0` : dimensions.length === 2 ? `${dimArgs},0` : dimArgs;
              out.push(`${indent}${type} ${varDecl};`);
              out.push(`${indent}__trace_array_create(${name}, ${type}, ${paddedDims}, ${i + 1});`);
              if (hasInitializer) {
                if (isStringLiteral) out.push(`${indent}__trace_array_init_string(${name}, "${initValues}", ${i + 1});`);
                else if (initValues) {
                  const totalSize = dimensions.reduce((a, b) => a * (parseInt(b) || 1), 1);
                  const initList = initValues.split(',').map(v => v.trim()).filter(Boolean);
                  const paddedInit = [...initList, ...Array(totalSize - initList.length).fill('0')].join(',');
                  out.push(`${indent}{ int __temp_${name}[] = {${paddedInit}}; __trace_array_init(${name}, __temp_${name}, ${totalSize}, ${i + 1}); }`);
                }
              }
            }
          } else {
            const varName = this.extractVariableName(varDecl);
            if (varName && /^\w+$/.test(varName)) {
              const hasInit = this.hasInitializer(varDecl);
              const currentScopeId = scopeStack[scopeStack.length - 1];
              const alreadyDeclared = this.isVariableDeclaredInScope(varName, currentScopeId);
              if (hasInit) {
                const initValue = this.extractInitializer(varDecl);
                if (!alreadyDeclared) {
                  out.push(`${indent}${type} ${varName};`);
                  out.push(`${indent}__trace_declare(${varName}, ${type}, ${i + 1});`);
                  this.markVariableDeclared(varName, currentScopeId);
                } else out.push(`${indent}${type} ${varName};`);
                out.push(`${indent}${varName} = ${initValue};`);
                out.push(`${indent}__trace_assign(${varName}, ${varName}, ${i + 1});`);
              } else {
                if (!alreadyDeclared) {
                  out.push(`${indent}${type} ${varDecl};`);
                  out.push(`${indent}__trace_declare(${varName}, ${type}, ${i + 1});`);
                  this.markVariableDeclared(varName, currentScopeId);
                } else out.push(`${indent}${type} ${varDecl};`);
              }
            }
          }
        }
        continue;
      }

      const charArrStr = trimmed.match(/^\s*char\s+(\w+)\s*\[\s*([^\]]*)\s*\]\s*=\s*"([^"]*)"\s*;/);
      if (charArrStr) {
        const [, name, size, strValue] = charArrStr;
        const actualSize = size || (strValue.length + 1);
        out.push(line);
        out.push(`${indent}__trace_array_create(${name}, char, ${actualSize},0,0, ${i + 1});`);
        out.push(`${indent}__trace_array_init_string(${name}, "${strValue}", ${i + 1});`);
        continue;
      }

      if (trimmed.match(/^\s*(int|long|float|double|char|bool)\s+(\w+)\s*\[([^\]]+)\]/)) {
        out.push(line);
        const arrDecl = trimmed.match(/^\s*(int|long|float|double|char|bool)\s+(\w+)\s*\[([^\]]+)\]\s*;/);
        if (arrDecl) {
          const [, type, name, dim] = arrDecl;
          out.push(`${indent}__trace_array_create(${name}, ${type}, ${dim},0,0, ${i + 1});`);
        }
        continue;
      }

      const declOnly = trimmed.match(/^\s*(int|long|float|double|char|bool)\s+(\w+)\s*;/);
      if (declOnly) {
        const [, type, varName] = declOnly;
        const currentScopeId = scopeStack[scopeStack.length - 1];
        if (!this.isVariableDeclaredInScope(varName, currentScopeId)) {
          out.push(line);
          out.push(`${indent}__trace_declare(${varName}, ${type}, ${i + 1});`);
          this.markVariableDeclared(varName, currentScopeId);
        } else out.push(line);
        continue;
      }

      const declInit = trimmed.match(/^\s*(int|long|float|double|char|bool)\s+(\w+)\s*=\s*([^;]+);/);
      if (declInit) {
        const [, type, varName, value] = declInit;
        const currentScopeId = scopeStack[scopeStack.length - 1];
        const isPointer = /\*/.test(value) || /\*/.test(varName) || /\*/.test(type);
        if (!this.isVariableDeclaredInScope(varName, currentScopeId)) {
          out.push(`${indent}${type} ${varName};`);
          out.push(`${indent}__trace_declare(${varName}, ${type}, ${i + 1});`);
          this.markVariableDeclared(varName, currentScopeId);
        } else out.push(`${indent}${type} ${varName};`);
        out.push(`${indent}${varName} = ${value};`);
        out.push(`${indent}__trace_assign(${varName}, ${varName}, ${i + 1});`);
        if (isPointer) {
          let aliasTarget = value.trim();
          if (aliasTarget.startsWith('&')) {
            aliasTarget = aliasTarget.replace(/^&\s*/, '');
          }
          if (aliasTarget !== varName) {
            const decayed = this.isArrayDecay(value) ? 'true' : 'false';
            out.push(`${indent}__trace_pointer_alias(${varName}, ${aliasTarget}, ${decayed}, ${i + 1});`);
          }
        }
        continue;
      }

      if (trimmed.match(/^\s*const\s+/)) { out.push(line); continue; }
      if (trimmed.match(/^[a-zA-Z0-9_]+\s*=\s*[^;]+;/)) {
        const assign = trimmed.match(/^\s*(\w+)\s*=\s*([^;]+);/);
        if (assign) {
          const [, varName, value] = assign;
          out.push(line);
          out.push(`${indent}__trace_assign(${varName}, ${value}, ${i + 1});`);
          const addrMatch = value.trim().match(/^&\s*(\w+)$/);
          if (addrMatch) {
            const source = addrMatch[1];
            if (source !== varName) {
              out.push(`${indent}__trace_pointer_alias(${varName}, ${source}, false, ${i + 1});`);
            }
          }
        } else out.push(line);
        continue;
      }
      if (trimmed.match(/^\s*(\w+)\s*([+\-*/%]|<<|>>)=\s*([^;]+);/)) {
        const [, varName] = trimmed.match(/^\s*(\w+)/);
        out.push(line);
        out.push(`${indent}__trace_assign(${varName}, ${varName}, ${i + 1});`);
        continue;
      }
      if (trimmed.match(/^\s*(\+\+|--)?(\w+)(\+\+|--)?;/)) {
        const match = trimmed.match(/^\s*(\+\+|--)?(\w+)(\+\+|--)?;/);
        if (match) {
          const varName = match[2];
          out.push(line);
          out.push(`${indent}__trace_assign(${varName}, ${varName}, ${i + 1});`);
        } else out.push(line);
        continue;
      }

      // Case 1: for loop with variable declaration: for (int i = 1; i < n; i++)
      const forLoopWithDecl = trimmed.match(/^\s*for\s*\(\s*(int|long)\s+(\w+)\s*=\s*([^;]+);([^;]+);([^)]+)\)\s*\{/);
      if (forLoopWithDecl) {
        const [, type, varName, initValue, condition, increment] = forLoopWithDecl;
        const currentScopeId = scopeStack[scopeStack.length - 1];
        const loopId = loopIdCounter++;

        if (!this.isVariableDeclaredInScope(varName, currentScopeId)) {
          out.push(`${indent}${type} ${varName};`);
          out.push(`${indent}__trace_declare(${varName}, ${type}, ${i + 1});`);
          this.markVariableDeclared(varName, currentScopeId);
        }
        out.push(`${indent}${varName} = ${initValue};`);
        out.push(`${indent}__trace_assign(${varName}, ${varName}, ${i + 1});`);
        out.push(`${indent}__trace_loop_start(${loopId}, "for", ${i + 1});`);
        out.push(`${indent}for (; ${condition}; ${increment}) {`);
        out.push(`${indent}  __trace_loop_condition(${loopId}, (${condition}) ? 1 : 0, ${i + 1});`);
        out.push(`${indent}  if (!(${condition})) { __trace_loop_end(${loopId}, ${i + 1}); break; }`);
        out.push(`${indent}  __trace_loop_body_start(${loopId}, ${i + 1});`);
        this.loopStack.push({ loopId, varName, increment, lineNum: i + 1 });
        continue;
      }

      // Case 2: for loop with pre-declared variable: int i; for (i = 1; i < n; i++)
      const forLoopPreDeclared = trimmed.match(/^\s*for\s*\(\s*(\w+)\s*=\s*([^;]+);([^;]+);([^)]+)\)\s*\{/);
      if (forLoopPreDeclared) {
        const [, varName, initValue, condition, increment] = forLoopPreDeclared;
        const loopId = loopIdCounter++;

        out.push(`${indent}${varName} = ${initValue};`);
        out.push(`${indent}__trace_assign(${varName}, ${varName}, ${i + 1});`);
        out.push(`${indent}__trace_loop_start(${loopId}, "for", ${i + 1});`);
        out.push(`${indent}for (; ${condition}; ${increment}) {`);
        out.push(`${indent}  __trace_loop_condition(${loopId}, (${condition}) ? 1 : 0, ${i + 1});`);
        out.push(`${indent}  if (!(${condition})) { __trace_loop_end(${loopId}, ${i + 1}); break; }`);
        out.push(`${indent}  __trace_loop_body_start(${loopId}, ${i + 1});`);
        this.loopStack.push({ loopId, varName, increment, lineNum: i + 1 });
        continue;
      }

      const whileLoop = trimmed.match(/^\s*while\s*\(([^)]+)\)\s*\{/);
      if (whileLoop) {
        const [, condition] = whileLoop;
        const loopId = loopIdCounter++;
        out.push(`${indent}__trace_loop_start(${loopId}, "while", ${i + 1});`);
        out.push(`${indent}while (1) {`);
        out.push(`${indent}  __trace_loop_condition(${loopId}, (${condition}) ? 1 : 0, ${i + 1});`);
        out.push(`${indent}  if (!(${condition})) { __trace_loop_end(${loopId}, ${i + 1}); break; }`);
        out.push(`${indent}  __trace_loop_body_start(${loopId}, ${i + 1});`);
        this.loopStack.push({ loopId, varName: null, increment: null, lineNum: i + 1 });
        continue;
      }

      const doWhile = trimmed.match(/^\s*do\s*\{/);
      if (doWhile) {
        const loopId = loopIdCounter++;
        out.push(`${indent}__trace_loop_start(${loopId}, "do-while", ${i + 1});`);
        out.push(`${indent}do {`);
        out.push(`${indent}  __trace_loop_body_start(${loopId}, ${i + 1});`);
        this.loopStack.push({ loopId, varName: null, increment: null, lineNum: i + 1 });
        continue;
      }

      const whileEnd = trimmed.match(/^\s*}\s*while\s*\(([^)]+)\)\s*;/);
      if (whileEnd) {
        if (this.loopStack.length === 0) {
          out.push(line); continue;
        }
        const [, condition] = whileEnd;
        const loopInfo = this.loopStack.pop();
        out.push(`${indent}  __trace_loop_iteration_end(${loopInfo.loopId}, ${i + 1});`);
        out.push(`${indent}  __trace_loop_condition(${loopInfo.loopId}, (${condition}) ? 1 : 0, ${i + 1});`);
        out.push(`${indent}} while (${condition});`);
        out.push(`${indent}__trace_loop_end(${loopInfo.loopId}, ${i + 1});`);
        continue;
      }

      if (trimmed === '}' && this.loopStack.length > 0) {
        const loopInfo = this.loopStack[this.loopStack.length - 1];
        
        const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';
        if (!nextLine.match(/^\s*while\s*\(/)) {
          this.loopStack.pop();
          
          if (loopInfo.varName && loopInfo.increment) {
            out.push(`${indent}  __trace_assign(${loopInfo.varName}, ${loopInfo.varName}, ${loopInfo.lineNum});`);
          }
          out.push(`${indent}  __trace_loop_iteration_end(${loopInfo.loopId}, ${loopInfo.lineNum});`);
          out.push(line);
          out.push(`${indent}__trace_loop_end(${loopInfo.loopId}, ${loopInfo.lineNum});`);
          continue;
        }
      }

      const ifStmt = trimmed.match(/^\s*if\s*\(([^)]+)\)\s*\{/);
      if (ifStmt) {
        const [, condition] = ifStmt;
        const condId = conditionIdCounter++;
        out.push(`${indent}__trace_condition_eval(${condId}, "${condition.replace(/"/g, '\\"')}", (${condition}) ? 1 : 0, ${i + 1});`);
        out.push(`${indent}if (${condition}) {`);
        out.push(`${indent}  __trace_branch_taken(${condId}, "if", ${i + 1});`);
        continue;
      }

      const elseIfStmt = trimmed.match(/^\s*}\s*else\s+if\s*\(([^)]+)\)\s*\{/);
      if (elseIfStmt) {
        const [, condition] = elseIfStmt;
        const condId = conditionIdCounter++;
        out.push(`${indent}} else {`);
        out.push(`${indent}  __trace_condition_eval(${condId}, "${condition.replace(/"/g, '\\"')}", (${condition}) ? 1 : 0, ${i + 1});`);
        out.push(`${indent}  if (${condition}) {`);
        out.push(`${indent}    __trace_branch_taken(${condId}, "else-if", ${i + 1});`);
        continue;
      }

      const elseStmt = trimmed.match(/^\s*}\s*else\s*\{/);
      if (elseStmt) {
        const condId = conditionIdCounter++;
        out.push(`${indent}} else {`);
        out.push(`${indent}  __trace_branch_taken(${condId}, "else", ${i + 1});`);
        continue;
      }

      out.push(line);
    }

    return out.join('\n');
  }
}

export default new CodeInstrumenter();