const SCANF_SPECIFIER_REGEX = /%([0-9.+\-#hlLjzt]*)([diuoxXfFeEgGaAcspns])/g;

const SPECIFIER_TYPE_MAP = {
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
  n: 'int'
};

function stripCommentsPreserveLayout(code) {
  let out = '';
  let i = 0;
  let inLine = false;
  let inBlock = false;
  let inString = false;
  let inChar = false;
  let escape = false;

  while (i < code.length) {
    const c = code[i];
    const next = i + 1 < code.length ? code[i + 1] : '';

    if (inLine) {
      if (c === '\n') {
        inLine = false;
        out += '\n';
      } else {
        out += ' ';
      }
      i += 1;
      continue;
    }

    if (inBlock) {
      if (c === '*' && next === '/') {
        inBlock = false;
        out += '  ';
        i += 2;
      } else {
        out += c === '\n' ? '\n' : ' ';
        i += 1;
      }
      continue;
    }

    if (inString) {
      out += c;
      if (escape) {
        escape = false;
      } else if (c === '\\') {
        escape = true;
      } else if (c === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }

    if (inChar) {
      out += c;
      if (escape) {
        escape = false;
      } else if (c === '\\') {
        escape = true;
      } else if (c === '\'') {
        inChar = false;
      }
      i += 1;
      continue;
    }

    if (c === '/' && next === '/') {
      inLine = true;
      out += '  ';
      i += 2;
      continue;
    }

    if (c === '/' && next === '*') {
      inBlock = true;
      out += '  ';
      i += 2;
      continue;
    }

    if (c === '"') {
      inString = true;
      out += c;
      i += 1;
      continue;
    }

    if (c === '\'') {
      inChar = true;
      out += c;
      i += 1;
      continue;
    }

    out += c;
    i += 1;
  }

  return out;
}

function buildLineStarts(code) {
  const starts = [0];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function offsetToLine(offset, lineStarts) {
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

function splitArguments(argsText) {
  const args = [];
  let cur = '';
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let inChar = false;
  let escape = false;

  for (let i = 0; i < argsText.length; i++) {
    const c = argsText[i];
    if (inString) {
      cur += c;
      if (escape) {
        escape = false;
      } else if (c === '\\') {
        escape = true;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (inChar) {
      cur += c;
      if (escape) {
        escape = false;
      } else if (c === '\\') {
        escape = true;
      } else if (c === '\'') {
        inChar = false;
      }
      continue;
    }

    if (c === '"') {
      inString = true;
      cur += c;
      continue;
    }
    if (c === '\'') {
      inChar = true;
      cur += c;
      continue;
    }
    if (c === '(') parenDepth += 1;
    if (c === ')') parenDepth = Math.max(0, parenDepth - 1);
    if (c === '{') braceDepth += 1;
    if (c === '}') braceDepth = Math.max(0, braceDepth - 1);
    if (c === '[') bracketDepth += 1;
    if (c === ']') bracketDepth = Math.max(0, bracketDepth - 1);

    if (c === ',' && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
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

function normalizeVariableToken(token, fallbackName) {
  if (!token || typeof token !== 'string') return fallbackName;
  let text = token.trim();
  text = text.replace(/^&+/, '');
  text = text.replace(/^\*+/, '');
  text = text.replace(/\s+/g, '');
  text = text.replace(/\[[^\]]*\]/g, '');
  text = text.replace(/\([^)]*\)/g, '');
  const m = text.match(/([A-Za-z_]\w*)$/);
  return m ? m[1] : fallbackName;
}

function detectScanfSpecifiers(format) {
  const list = [];
  if (!format) return list;
  SCANF_SPECIFIER_REGEX.lastIndex = 0;
  let m;
  while ((m = SCANF_SPECIFIER_REGEX.exec(format)) !== null) {
    const flags = m[1] || '';
    const code = m[2];
    if (flags.includes('*')) continue;
    const specifier = `%${flags}${code}`;
    const type = SPECIFIER_TYPE_MAP[code] || 'string';
    list.push({ specifier, type });
  }
  return list;
}

function defaultValueForType(type) {
  switch (type) {
    case 'float':
      return '0.0';
    case 'char':
      return 'a';
    case 'string':
      return 'text';
    case 'int':
    default:
      return '0';
  }
}

function sanitizeValue(value, type) {
  const text = `${value ?? ''}`.trim();
  if (type === 'int') {
    const parsed = parseInt(text, 10);
    return Number.isNaN(parsed) ? null : String(parsed);
  }
  if (type === 'float') {
    const parsed = parseFloat(text);
    return Number.isNaN(parsed) ? null : String(parsed);
  }
  if (type === 'char') {
    if (!text) return null;
    return text[0];
  }
  if (type === 'string') {
    return text;
  }
  return text || null;
}

class InputRequirementsService {
  analyzeInputRequirements(code, language = 'c') {
    if (!code || typeof code !== 'string') {
      return { needsInput: false, requirements: [], summary: { total: 0 } };
    }

    const sanitized = stripCommentsPreserveLayout(code);
    const lineStarts = buildLineStarts(sanitized);
    const requirements = [];
    let sequence = 0;

    const shouldSkipLine = (offset) => {
      const line = offsetToLine(offset, lineStarts);
      const lineStart = lineStarts[line - 1] || 0;
      const lineEnd = line < lineStarts.length ? lineStarts[line] - 1 : sanitized.length;
      const text = sanitized.slice(lineStart, lineEnd).trim();
      return text.startsWith('#');
    };

    const pushReq = (req) => {
      requirements.push({
        id: `input-${sequence}`,
        sequence,
        ...req
      });
      sequence += 1;
    };

    // scanf
    const scanfRe = /\bscanf\s*\(\s*"((?:\\.|[^"\\])*)"\s*(?:,\s*([^;]*?))?\)/g;
    let match;
    while ((match = scanfRe.exec(sanitized)) !== null) {
      if (shouldSkipLine(match.index)) continue;
      const line = offsetToLine(match.index, lineStarts);
      const format = match[1] || '';
      const argsText = match[2] || '';
      const args = splitArguments(argsText);
      const specs = detectScanfSpecifiers(format);

      specs.forEach((spec, idx) => {
        const arg = args[idx] || '';
        const variable = normalizeVariableToken(arg, `input_${line}_${idx + 1}`);
        pushReq({
          callType: 'scanf',
          line,
          variable,
          type: spec.type,
          format,
          specifier: spec.specifier,
          prompt: `Enter value for ${variable} (${spec.type})`
        });
      });
    }

    // cin >> a >> b;
    const cinRe = /\b(?:std::)?cin\s*((?:>>\s*[^;>\n]+)+)\s*;/g;
    while ((match = cinRe.exec(sanitized)) !== null) {
      if (shouldSkipLine(match.index)) continue;
      const line = offsetToLine(match.index, lineStarts);
      const chain = match[1] || '';
      const vars = chain
        .split('>>')
        .map(v => normalizeVariableToken(v, ''))
        .filter(Boolean);
      vars.forEach((variable, idx) => {
        pushReq({
          callType: 'cin',
          line,
          variable,
          type: 'int',
          prompt: `Enter value for ${variable} (int)`
        });
      });
    }

    // getchar
    const getcharRe = /\b(?:([A-Za-z_]\w*)\s*=\s*)?getchar\s*\(\s*\)/g;
    while ((match = getcharRe.exec(sanitized)) !== null) {
      if (shouldSkipLine(match.index)) continue;
      const line = offsetToLine(match.index, lineStarts);
      const variable = match[1] || `char_input_${line}`;
      pushReq({
        callType: 'getchar',
        line,
        variable,
        type: 'char',
        prompt: `Enter value for ${variable} (char)`
      });
    }

    // fgets
    const fgetsRe = /\bfgets\s*\(\s*([A-Za-z_]\w*)\s*,/g;
    while ((match = fgetsRe.exec(sanitized)) !== null) {
      if (shouldSkipLine(match.index)) continue;
      const line = offsetToLine(match.index, lineStarts);
      const variable = match[1] || `string_input_${line}`;
      pushReq({
        callType: 'fgets',
        line,
        variable,
        type: 'string',
        prompt: `Enter value for ${variable} (string)`
      });
    }

    // gets
    const getsRe = /\bgets\s*\(\s*([A-Za-z_]\w*)\s*\)/g;
    while ((match = getsRe.exec(sanitized)) !== null) {
      if (shouldSkipLine(match.index)) continue;
      const line = offsetToLine(match.index, lineStarts);
      const variable = match[1] || `string_input_${line}`;
      pushReq({
        callType: 'gets',
        line,
        variable,
        type: 'string',
        prompt: `Enter value for ${variable} (string)`
      });
    }

    requirements.sort((a, b) => (a.line - b.line) || (a.sequence - b.sequence));

    return {
      needsInput: requirements.length > 0,
      requirements,
      summary: {
        total: requirements.length,
        lines: [...new Set(requirements.map(r => r.line))]
      }
    };
  }

  normalizeProvidedInputs(inputs, requirements = []) {
    const rawValues = Array.isArray(inputs) ? inputs : (inputs == null ? [] : [inputs]);
    const warnings = [];
    const values = [];

    for (let i = 0; i < requirements.length; i++) {
      const req = requirements[i];
      const raw = i < rawValues.length ? rawValues[i] : defaultValueForType(req.type);
      const sanitized = sanitizeValue(raw, req.type);
      if (sanitized == null) {
        values.push(defaultValueForType(req.type));
        warnings.push(
          `Invalid input for ${req.variable} (${req.type}), defaulted to ${defaultValueForType(req.type)}`
        );
      } else {
        values.push(sanitized);
      }
    }

    return { values, warnings };
  }
}

export const inputRequirementsService = new InputRequirementsService();
export default inputRequirementsService;
