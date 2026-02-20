export type InputValueType = 'int' | 'float' | 'char' | 'string';

export interface InputRequirement {
  id: string;
  line: number;
  variable: string;
  type: InputValueType;
  callType: 'scanf' | 'cin' | 'getchar' | 'fgets' | 'gets';
  format?: string;
  specifier?: string;
  prompt: string;
}

const SPECIFIER_TYPE_MAP: Record<string, InputValueType> = {
  d: 'int',
  i: 'int',
  u: 'int',
  o: 'int',
  x: 'int',
  X: 'int',
  f: 'float',
  F: 'float',
  e: 'float',
  E: 'float',
  g: 'float',
  G: 'float',
  a: 'float',
  A: 'float',
  c: 'char',
  s: 'string',
  p: 'string',
  n: 'int',
};

const SCANF_SPECIFIER_REGEX = /%([0-9.+\-#hlLjzt]*)([diuoxXfFeEgGaAcspns])/g;

function splitArguments(argsText: string): string[] {
  const args: string[] = [];
  let cur = '';
  let depth = 0;
  let inString = false;
  let inChar = false;
  let escape = false;

  for (let i = 0; i < argsText.length; i++) {
    const c = argsText[i];
    if (inString) {
      cur += c;
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (inChar) {
      cur += c;
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === "'") inChar = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      cur += c;
      continue;
    }
    if (c === "'") {
      inChar = true;
      cur += c;
      continue;
    }
    if (c === '(' || c === '{' || c === '[') depth += 1;
    if (c === ')' || c === '}' || c === ']') depth = Math.max(0, depth - 1);
    if (c === ',' && depth === 0) {
      const trimmed = cur.trim();
      if (trimmed) args.push(trimmed);
      cur = '';
      continue;
    }
    cur += c;
  }
  const trimmed = cur.trim();
  if (trimmed) args.push(trimmed);
  return args;
}

function normalizeVariableToken(token: string, fallback: string): string {
  let text = (token || '').trim();
  text = text.replace(/^&+/, '').replace(/^\*+/, '');
  text = text.replace(/\[[^\]]*\]/g, '');
  text = text.replace(/\s+/g, '');
  const match = text.match(/([A-Za-z_]\w*)$/);
  return match ? match[1] : fallback;
}

function detectScanfSpecifiers(format: string): Array<{ specifier: string; type: InputValueType }> {
  const list: Array<{ specifier: string; type: InputValueType }> = [];
  SCANF_SPECIFIER_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SCANF_SPECIFIER_REGEX.exec(format)) !== null) {
    const flags = match[1] || '';
    const code = match[2];
    if (flags.includes('*')) continue;
    list.push({
      specifier: `%${flags}${code}`,
      type: SPECIFIER_TYPE_MAP[code] || 'string',
    });
  }
  return list;
}

function stripLineComment(line: string): string {
  let inString = false;
  let inChar = false;
  let escape = false;
  for (let i = 0; i < line.length - 1; i++) {
    const c = line[i];
    if (inString) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (inChar) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === "'") inChar = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "'") inChar = true;
    else if (c === '/' && line[i + 1] === '/') return line.slice(0, i);
  }
  return line;
}

export function detectInputRequirements(code: string): InputRequirement[] {
  const requirements: InputRequirement[] = [];
  const lines = code.split('\n');
  let inBlockComment = false;
  let sequence = 0;

  const pushReq = (req: Omit<InputRequirement, 'id'>) => {
    requirements.push({ id: `input-${sequence++}`, ...req });
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNo = idx + 1;
    let line = lines[idx];

    if (inBlockComment) {
      const end = line.indexOf('*/');
      if (end >= 0) {
        line = line.slice(end + 2);
        inBlockComment = false;
      } else {
        continue;
      }
    }

    const startBlock = line.indexOf('/*');
    if (startBlock >= 0) {
      const end = line.indexOf('*/', startBlock + 2);
      if (end >= 0) {
        line = line.slice(0, startBlock) + ' ' + line.slice(end + 2);
      } else {
        line = line.slice(0, startBlock);
        inBlockComment = true;
      }
    }

    line = stripLineComment(line);
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const scanfMatch = trimmed.match(/scanf\s*\(\s*"((?:\\.|[^"\\])*)"\s*(?:,\s*(.*))?\)/);
    if (scanfMatch) {
      const format = scanfMatch[1] || '';
      const argsText = scanfMatch[2] || '';
      const args = splitArguments(argsText);
      const specs = detectScanfSpecifiers(format);

      specs.forEach((spec, argIdx) => {
        const variable = normalizeVariableToken(
          args[argIdx] || '',
          `input_${lineNo}_${argIdx + 1}`,
        );
        pushReq({
          line: lineNo,
          variable,
          type: spec.type,
          callType: 'scanf',
          format,
          specifier: spec.specifier,
          prompt: `Enter value for ${variable} (${spec.type})`,
        });
      });
    }

    const cinMatch = trimmed.match(/(?:std::)?cin\s*((?:>>\s*[^;>\n]+)+)\s*;/);
    if (cinMatch) {
      const vars = cinMatch[1]
        .split('>>')
        .map((token) => normalizeVariableToken(token, ''))
        .filter(Boolean);
      vars.forEach((variable) => {
        pushReq({
          line: lineNo,
          variable,
          type: 'int',
          callType: 'cin',
          prompt: `Enter value for ${variable} (int)`,
        });
      });
    }

    const getcharMatch = trimmed.match(/(?:([A-Za-z_]\w*)\s*=\s*)?getchar\s*\(\s*\)/);
    if (getcharMatch) {
      const variable = getcharMatch[1] || `char_input_${lineNo}`;
      pushReq({
        line: lineNo,
        variable,
        type: 'char',
        callType: 'getchar',
        prompt: `Enter value for ${variable} (char)`,
      });
    }

    const fgetsMatch = trimmed.match(/fgets\s*\(\s*([A-Za-z_]\w*)\s*,/);
    if (fgetsMatch) {
      const variable = fgetsMatch[1] || `string_input_${lineNo}`;
      pushReq({
        line: lineNo,
        variable,
        type: 'string',
        callType: 'fgets',
        prompt: `Enter value for ${variable} (string)`,
      });
    }

    const getsMatch = trimmed.match(/gets\s*\(\s*([A-Za-z_]\w*)\s*\)/);
    if (getsMatch) {
      const variable = getsMatch[1] || `string_input_${lineNo}`;
      pushReq({
        line: lineNo,
        variable,
        type: 'string',
        callType: 'gets',
        prompt: `Enter value for ${variable} (string)`,
      });
    }
  }

  return requirements;
}

export function validateInputValue(value: string, type: InputValueType): string | null {
  const text = value.trim();
  if (type === 'int') return /^-?\d+$/.test(text) ? text : null;
  if (type === 'float') return /^-?\d+(\.\d+)?$/.test(text) ? text : null;
  if (type === 'char') return text.length === 1 ? text : null;
  return text;
}

export function defaultInputValue(type: InputValueType): string {
  if (type === 'float') return '0.0';
  if (type === 'char') return 'a';
  if (type === 'string') return 'text';
  return '0';
}
