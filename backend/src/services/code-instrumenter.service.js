// backend/src/services/code-instrumenter.service.js
import { spawn } from 'child_process';
import { writeFile, readFile, unlink } from 'fs/promises';
import path from 'path';
import resourceResolver from './resource-resolver.service.js';
import { v4 as uuid } from 'uuid';

let loopIdCounter = 0;
let blockDepthCounter = 0;
let conditionIdCounter = 0;
let switchIdCounter = 0;

class CodeInstrumenter {
  constructor() {
    this.tempRoot = resourceResolver.getTempRoot();
    this.scopeVariables = new Map();
    this.currentScope = 0;
    this.pointerAliases = new Map();
    this.blockDepth = 0;
    this.loopStack = [];
    this.switchStack = [];
    this.pendingSwitches = [];
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

  isStdoutOutputStatement(trimmed) {
    if (!trimmed || !trimmed.endsWith(';')) return false;
    if (/^\s*(for|while|if|switch)\b/.test(trimmed)) return false;

    if (/^\s*printf\s*\(/.test(trimmed)) return true;
    if (/^\s*puts\s*\(/.test(trimmed)) return true;
    if (/^\s*fputs\s*\(/.test(trimmed)) return true;
    if (/^\s*putchar\s*\(/.test(trimmed)) return true;
    if (/^\s*fprintf\s*\(\s*stdout\s*,/.test(trimmed)) return true;

    return false;
  }

  appendOutputFlush(out, indent, lineNumber) {
    out.push(`${indent}__trace_control_flow("output_flush", ${lineNumber});`);
    out.push(`${indent}__trace_output_flush(${lineNumber});`);
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

  stripLineComments(line) {
    let inString = false;
    let inChar = false;
    let escape = false;

    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      const next = i + 1 < line.length ? line[i + 1] : '';

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

      if (!inString && !inChar && c === '/' && next === '/') {
        return line.slice(0, i);
      }
    }

    return line;
  }

  escapeString(text) {
    return String(text ?? '')
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
  }

  extractSwitchExpression(line) {
    const match = line.match(/^\s*switch\s*\(([^)]*)\)\s*(\{)?/);
    if (!match) return null;
    return {
      expression: match[1].trim(),
      hasBrace: Boolean(match[2]) || line.includes('{')
    };
  }

  collectSwitchCases(lines, startIndex) {
    const cases = [];
    let foundOpen = false;
    let depth = 0;
    let currentCase = null;

    for (let i = startIndex; i < lines.length; i++) {
      const rawLine = lines[i];
      const line = this.stripLineComments(rawLine);
      const trimmed = line.trim();
      const { open, close } = this.countBraces(line);

      if (!foundOpen) {
        if (open > 0) {
          foundOpen = true;
          const extraOpens = Math.max(0, open - 1);
          depth = 1 + extraOpens - close;
        }
        continue;
      }

      if (depth === 1) {
        const caseMatch = trimmed.match(/^case\s+(.+?)\s*:/);
        if (caseMatch) {
          const label = caseMatch[1].trim();
          currentCase = { label, line: i + 1, hasBreak: false };
          cases.push(currentCase);

          const colonIndex = trimmed.indexOf(':');
          if (colonIndex >= 0) {
            const remainder = trimmed.slice(colonIndex + 1);
            if (/\bbreak\s*;/.test(remainder)) {
              currentCase.hasBreak = true;
            }
          }
        } else if (/^default\s*:/.test(trimmed)) {
          currentCase = { label: 'default', line: i + 1, hasBreak: false };
          cases.push(currentCase);

          const colonIndex = trimmed.indexOf(':');
          if (colonIndex >= 0) {
            const remainder = trimmed.slice(colonIndex + 1);
            if (/\bbreak\s*;/.test(remainder)) {
              currentCase.hasBreak = true;
            }
          }
        }
      }

      if (currentCase && depth === 1) {
        if (/^\s*break\s*;/.test(trimmed) || /\bbreak\s*;/.test(trimmed)) {
          currentCase.hasBreak = true;
        }
      }

      depth += open - close;
      if (depth <= 0) break;
    }

    return cases;
  }

  isFunctionDefinitionStart(line, globalBraceDepth) {
    if (globalBraceDepth !== 0) return null;

    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) return null;

    // Pattern handles ALL of these return type forms:
    //   int, long, void, float, double, char, bool, short, size_t
    //   long long int, long long, long int, unsigned long long int,
    //   unsigned long long, unsigned int, unsigned long, unsigned char,
    //   signed long long, signed int, etc.
    // The type is captured as a group of words/stars before the function name.
    // The function name is the last \w+ before the opening paren.
    // NOTE: Must end with [^;]*$ to ensure we do NOT match prototypes ending in ';'
    const funcPattern = /^\s*(?:static\s+)?(?:inline\s+)?(?:extern\s+)?(?:const\s+)?(?:(?:unsigned|signed|long|short)\s+)*(?:void|int|long|float|double|char|bool|auto|short|size_t|long\s+long)\s*\**\s*(\w+)\s*\([^;]*$/;
    const match = trimmed.match(funcPattern);
    if (match) {
      // match[1] is the function name (last word before the paren)
      const funcName = match[1];
      // Exclude C keywords that can appear in this position
      const notAFuncName = new Set([
        'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'return',
        'break', 'continue', 'goto', 'typedef', 'struct', 'enum', 'union',
        'sizeof', 'const', 'static', 'inline', 'extern', 'register', 'volatile'
      ]);
      if (notAFuncName.has(funcName)) return null;
      return funcName;
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
    switchIdCounter = 0;
    this.blockDepth = 0;
    this.loopStack = [];
    this.switchStack = [];
    this.pendingSwitches = [];
    const pendingElseIfWrapperIndents = [];
    let lastIfConditionId = null; // tracks the conditionId of the most recent if/else-if for else linkage

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      const indent = line.match(/^\s*/)[0];

      // Prevent double-instrumentation: skip lines already containing tracer hooks
      if (line.includes('__trace_')) {
        out.push(line);
        continue;
      }

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
        // Guard against negative depth which can cause crashes
        if (globalBraceDepth < 0) globalBraceDepth = 0;

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
      // Guard against negative depth
      if (functionBraceDepth < 0) functionBraceDepth = 0;
      globalBraceDepth += openBraces - closeBraces;
      // Guard against negative depth  
      if (globalBraceDepth < 0) globalBraceDepth = 0;

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
                // Pointer / array parameter — trace as alias.
                // FIX: Rather than replacing [] with * and hoping split+pop gives the
                // right token, extract the pure identifier with a regex. This correctly
                // handles: int arr[], int *ptr, int* ptr, char arr[], etc.
                const isArrayDecay = p.includes('[]');
                // Match the last word-only token (the parameter name) in the declaration.
                const nameMatch = p.replace(/\[\]/g, '').replace(/\*/g, ' ').trim().match(/(\w+)\s*$/);
                const varName = nameMatch ? nameMatch[1] : null;
                if (varName && /^\w+$/.test(varName) && varName !== 'void') {
                  out.push(`${indent}  __trace_pointer_alias(${varName}, ${varName}, ${isArrayDecay}, ${i + 1});`);
                }
              } else {
                // Scalar parameter (int n, long x, long long int val, etc.)
                // Extract the parameter name: it is always the last word token
                const tokens = p.trim().split(/\s+/);
                const varName = tokens[tokens.length - 1].replace(/^\*+/, '');
                // Extract the type: everything before the last token
                const varType = tokens.slice(0, tokens.length - 1).join(' ') || 'int';
                // Only trace if varName looks like a valid identifier
                if (varName && /^\w+$/.test(varName) && varName !== 'void') {
                  out.push(`${indent}  __trace_declare(${varName}, ${varType}, ${i + 1});`);
                  out.push(`${indent}  __trace_assign(${varName}, ${varName}, ${i + 1});`);
                }
              }
            }
          }
          pendingFunctionDef = null;
          continue;
        }
      }

      if (openBraces > 0 && this.pendingSwitches.length > 0) {
        const pendingSwitch = this.pendingSwitches.shift();
        if (pendingSwitch) {
          this.switchStack.push({
            switchId: pendingSwitch.switchId,
            braceDepth: this.blockDepth
          });
        }
      }

      if (closeBraces > 0) {
        for (let b = 0; b < closeBraces; b++) {
          if (scopeStack.length > 1) {
            scopeStack.pop();
          }
          if (this.blockDepth > 0) {
            this.blockDepth--;
          }
        }
      }

      if (this.switchStack.length > 0) {
        while (
          this.switchStack.length > 0 &&
          this.blockDepth < this.switchStack[this.switchStack.length - 1].braceDepth
        ) {
          this.switchStack.pop();
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
        const tmpVar = `__rv_${i}`;
        const isSimple = /^\w+$/.test(returnValue.trim());
        const destSymbol = isSimple ? returnValue.trim() : '__expr';
        out.push(`${indent}{`);
        out.push(`${indent}  __auto_type ${tmpVar} = (${returnValue});`);
        out.push(`${indent}  __trace_assign(${tmpVar}, ${tmpVar}, ${i + 1});`);
        out.push(`${indent}  __trace_return(${tmpVar}, "auto", "${destSymbol}", ${i + 1});`);
        out.push(`${indent}  return ${tmpVar};`);
        out.push(`${indent}}`);
        continue;
      }

      const returnVoidStmt = trimmed.match(/^\s*return\s*;/);
      if (returnVoidStmt) {
        out.push(`${indent}__trace_return(0, "void", "", ${i + 1});`);
        out.push(line);
        continue;
      }

      if (this.isBreakOrContinue(trimmed)) {
        const controlType = trimmed.match(/^\s*(break|continue)/)[1];
        out.push(line);
        out.push(`${indent}__trace_control_flow("${controlType}", ${i + 1});`);
        continue;
      }

      if (this.isStdoutOutputStatement(trimmed)) {
        out.push(line);
        this.appendOutputFlush(out, indent, i + 1);
        continue;
      }

      const ptrDeref = trimmed.match(/^\s*\*\s*(\w+)\s*=\s*([^;]+);/);
      if (ptrDeref) {
        const [, ptrName, value] = ptrDeref;
        out.push(line);
        out.push(`${indent}__trace_pointer_deref_write(${ptrName}, *${ptrName}, ${i + 1});`);
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

              if (hasInitializer && dimensions.length === 1 && dimensions[0] === '0') {
                if (isStringLiteral) {
                  dimensions[0] = (initValues.length + 1).toString();
                } else if (initValues) {
                  const initList = initValues.split(',').map(v => v.trim()).filter(Boolean);
                  dimensions[0] = initList.length.toString();
                }
              }

              const dimArgs = dimensions.slice(0, 3).join(',');
              const paddedDims = dimensions.length === 1 ? `${dimArgs},0,0` : dimensions.length === 2 ? `${dimArgs},0` : dimArgs;
              out.push(`${indent}${type} ${varDecl};`);
              out.push(`${indent}__trace_array_create(${name}, ${type}, ${paddedDims}, ${i + 1});`);
              if (hasInitializer) {
                if (isStringLiteral) out.push(`${indent}__trace_array_init_string(${name}, "${initValues}", ${i + 1});`);
                else if (initValues) {
                  const totalSize = dimensions.reduce((a, b) => a * (parseInt(b) || 1), 1);
                  const initList = initValues.split(',').map(v => v.trim()).filter(Boolean);
                  const padCount = Math.max(0, totalSize - initList.length);
                  const paddedInit = [...initList, ...Array(padCount).fill('0')].join(',');
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
          out.push(`${indent}__trace_assign(${varName}, ${varName}, ${i + 1});`);
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
          const reserved = new Set([
            'return', 'break', 'continue', 'if', 'else', 'for', 'while',
            'switch', 'case', 'default', 'do', 'goto'
          ]);
          if (reserved.has(varName)) {
            out.push(line);
            continue;
          }
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
        out.push(`${indent}${varName} = ${initValue.trim()};`);
        out.push(`${indent}__trace_assign(${varName}, ${varName}, ${i + 1});`);
        out.push(`${indent}__trace_loop_start(${loopId}, "for", ${i + 1});`);
        // Move increment into loop body so it is traced AFTER execution, not before
        out.push(`${indent}for (; ${condition.trim()}; ) {`);
        out.push(`${indent}  __trace_loop_condition(${loopId}, (${condition.trim()}) ? 1 : 0, ${i + 1});`);
        out.push(`${indent}  if (!(${condition.trim()})) { break; }`);
        out.push(`${indent}  __trace_loop_body_start(${loopId}, ${i + 1});`);
        // Store increment so the closing brace handler can emit it and trace it
        this.loopStack.push({ loopId, varName, increment: increment.trim(), lineNum: i + 1 });
        continue;
      }

      // Case 2: for loop with pre-declared variable: int i; for (i = 1; i < n; i++)
      const forLoopPreDeclared = trimmed.match(/^\s*for\s*\(\s*(\w+)\s*=\s*([^;]+);([^;]+);([^)]+)\)\s*\{/);
      if (forLoopPreDeclared) {
        const [, varName, initValue, condition, increment] = forLoopPreDeclared;
        const loopId = loopIdCounter++;

        out.push(`${indent}${varName} = ${initValue.trim()};`);
        out.push(`${indent}__trace_assign(${varName}, ${varName}, ${i + 1});`);
        out.push(`${indent}__trace_loop_start(${loopId}, "for", ${i + 1});`);
        // Move increment into loop body so it is traced AFTER execution, not before
        out.push(`${indent}for (; ${condition.trim()}; ) {`);
        out.push(`${indent}  __trace_loop_condition(${loopId}, (${condition.trim()}) ? 1 : 0, ${i + 1});`);
        out.push(`${indent}  if (!(${condition.trim()})) { break; }`);
        out.push(`${indent}  __trace_loop_body_start(${loopId}, ${i + 1});`);
        this.loopStack.push({ loopId, varName, increment: increment.trim(), lineNum: i + 1 });
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

      if (trimmed.startsWith('}') && trimmed.replace(/\s*\/\/.*$/, '').trim() === '}' && this.loopStack.length > 0) {
        const loopInfo = this.loopStack[this.loopStack.length - 1];

        const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';
        if (!nextLine.match(/^\s*while\s*\(/)) {
          this.loopStack.pop();

          // Emit the increment expression and trace it BEFORE loop_iteration_end
          // This way the traced value reflects the post-increment state
          if (loopInfo.varName && loopInfo.increment) {
            out.push(`${indent}  ${loopInfo.increment};`);
            out.push(`${indent}  __trace_assign(${loopInfo.varName}, ${loopInfo.varName}, ${loopInfo.lineNum});`);
          }
          out.push(`${indent}  __trace_loop_iteration_end(${loopInfo.loopId}, ${loopInfo.lineNum});`);
          out.push(line); // the closing brace
          // Only ONE loop_end here. The break-guard in the for-header no longer emits one.
          out.push(`${indent}__trace_loop_end(${loopInfo.loopId}, ${loopInfo.lineNum});`);
          continue;
        }
      }

      if (trimmed.startsWith('}') && trimmed.replace(/\s*\/\/.*$/, '').trim() === '}' && pendingElseIfWrapperIndents.length > 0) {
        const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';
        const isElseContinuation = /^(\}\s*)?else\b/.test(nextLine);
        const wrapperIndent = pendingElseIfWrapperIndents[pendingElseIfWrapperIndents.length - 1];

        if (!isElseContinuation && indent === wrapperIndent) {
          out.push(line);
          while (
            pendingElseIfWrapperIndents.length > 0 &&
            pendingElseIfWrapperIndents[pendingElseIfWrapperIndents.length - 1] === indent
          ) {
            pendingElseIfWrapperIndents.pop();
            out.push(`${indent}}`);
          }
          continue;
        }
      }

      const ifStmtSingleLine = trimmed.match(/^\s*if\s*\(([^)]+)\)\s*(.+)$/);
      const ifStmt = trimmed.match(/^\s*if\s*\(([^)]+)\)\s*\{/);
      if (ifStmtSingleLine && !ifStmt) {
        // Single-line if: e.g. "if (n == 0) return 1;"
        const condition = ifStmtSingleLine[1];
        const body = ifStmtSingleLine[2].trim();
        const condId = conditionIdCounter++;
        lastIfConditionId = condId;
        out.push(`${indent}__trace_condition_eval(${condId}, "${condition.replace(/"/g, '\\"')}", (${condition}) ? 1 : 0, ${i + 1});`);
        out.push(`${indent}if (${condition}) {`);
        out.push(`${indent}  __trace_branch_taken(${condId}, "if", ${i + 1});`);
        out.push(`${indent}  ${body}`);
        out.push(`${indent}}`);
        continue;
      }
      if (ifStmt) {
        const [, condition] = ifStmt;
        const condId = conditionIdCounter++;
        lastIfConditionId = condId;
        out.push(`${indent}__trace_condition_eval(${condId}, "${condition.replace(/"/g, '\\"')}", (${condition}) ? 1 : 0, ${i + 1});`);
        out.push(`${indent}if (${condition}) {`);
        out.push(`${indent}  __trace_branch_taken(${condId}, "if", ${i + 1});`);
        continue;
      }

      const elseIfStmt = trimmed.match(/^\s*}\s*else\s+if\s*\(([^)]+)\)\s*\{/);
      if (elseIfStmt) {
        const [, condition] = elseIfStmt;
        const condId = conditionIdCounter++;
        lastIfConditionId = condId;
        out.push(`${indent}} else {`);
        out.push(`${indent}  __trace_condition_eval(${condId}, "${condition.replace(/"/g, '\\"')}", (${condition}) ? 1 : 0, ${i + 1});`);
        out.push(`${indent}  if (${condition}) {`);
        out.push(`${indent}    __trace_branch_taken(${condId}, "else-if", ${i + 1});`);
        pendingElseIfWrapperIndents.push(indent);
        continue;
      }

      const elseStmt = trimmed.match(/^\s*}\s*else\s*\{/);
      if (elseStmt) {
        // CRITICAL: reuse the parent if/else-if conditionId so LayoutEngine links them correctly
        const condId = lastIfConditionId !== null ? lastIfConditionId : conditionIdCounter++;
        out.push(`${indent}} else {`);
        out.push(`${indent}  __trace_branch_taken(${condId}, "else", ${i + 1});`);
        continue;
      }

      const switchInfo = this.extractSwitchExpression(trimmed);
      if (switchInfo) {
        const switchId = switchIdCounter++;
        const safeExpr = this.escapeString(switchInfo.expression);
        const cases = this.collectSwitchCases(lines, i);

        out.push(`${indent}__trace_switch_start(${switchId}, "${safeExpr}", ${i + 1});`);
        cases.forEach((caseEntry, idx) => {
          const fallsThrough = !caseEntry.hasBreak && idx < cases.length - 1;
          const safeLabel = this.escapeString(caseEntry.label);
          out.push(
            `${indent}__trace_switch_case_decl(${switchId}, "${safeLabel}", ${idx}, ${fallsThrough ? 1 : 0}, ${caseEntry.line});`
          );
        });

        out.push(line);

        if (switchInfo.hasBrace) {
          this.switchStack.push({ switchId, braceDepth: this.blockDepth });
        } else {
          this.pendingSwitches.push({ switchId });
        }
        continue;
      }

      if (this.switchStack.length > 0) {
        const activeSwitch = this.switchStack[this.switchStack.length - 1];
        const caseMatch = trimmed.match(/^case\s+(.+?)\s*:/);
        const isDefault = /^default\s*:/.test(trimmed);

        if (caseMatch || isDefault) {
          const label = caseMatch ? caseMatch[1].trim() : 'default';
          const safeLabel = this.escapeString(label);
          const colonIndex = line.indexOf(':');
          const headerLine = colonIndex >= 0 ? line.slice(0, colonIndex + 1) : line;
          const remainder = colonIndex >= 0 ? line.slice(colonIndex + 1).trim() : '';

          out.push(headerLine);
          out.push(`${indent}  __trace_switch_case(${activeSwitch.switchId}, "${safeLabel}", ${i + 1});`);
          if (remainder) {
            out.push(`${indent}  ${remainder}`);
          }
          continue;
        }
      }

      out.push(line);
    }

    return out.join('\n');
  }
}

export default new CodeInstrumenter();
