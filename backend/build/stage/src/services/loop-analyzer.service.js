import logger from '../utils/logger.js';

class LoopAnalyzerService {
  /**
   * Analyzes the code to find loops and suggest slicing strategies.
   * @param {string} code - The source code to analyze.
   * @returns {Array<object>} An array of loop metadata objects.
   */
  analyze(code) {
    const loops = [];
    const lines = code.split('\n');
    
    // Regex for different loop types
    const forRegex = /^\s*for\s*\((.*);(.*);(.*)\)/;
    const whileRegex = /^\s*while\s*\((.*)\)/;
    const doWhileRegex = /^\s*do\s*\{/;
    
    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      let match;

      match = line.match(forRegex);
      if (match) {
        loops.push(this.analyzeForLoop(match, lineNumber));
        return;
      }
      
      match = line.match(whileRegex);
      if (match) {
        loops.push(this.analyzeWhileLoop(match, lineNumber));
        return;
      }

      match = line.match(doWhileRegex);
      if (match) {
        // We found a 'do', now we need to find the matching 'while'
        const closingWhileLine = this.findMatchingWhileForDo(lines, index);
        if (closingWhileLine !== -1) {
            const whileMatch = lines[closingWhileLine - 1].match(/while\s*\((.*)\)\s*;/);
            if(whileMatch) {
                loops.push(this.analyzeDoWhileLoop(whileMatch, lineNumber));
            }
        }
      }
    });
    
    logger.info({ detectedLoops: loops.length }, 'Loop analysis complete.');
    return loops;
  }

  analyzeForLoop(match, line) {
    const [_, init, condition, increment] = match.map(s => s.trim());
    const estimatedIterations = this.estimateForIterations(init, condition, increment);
    return {
      line,
      type: 'for',
      estimatedIterations,
      sliceStrategy: this.getSliceStrategy(estimatedIterations),
      variables: this.extractVariables(init, condition, increment),
    };
  }

  analyzeWhileLoop(match, line) {
    const [_, condition] = match.map(s => s.trim());
    return {
      line,
      type: 'while',
      estimatedIterations: Infinity, // Hard to determine statically with regex
      sliceStrategy: this.getSliceStrategy(Infinity),
      variables: this.extractVariables(condition),
    };
  }
  
  analyzeDoWhileLoop(match, line) {
    const [_, condition] = match.map(s => s.trim());
    return {
      line, // The line number of the 'do'
      type: 'do-while',
      estimatedIterations: Infinity, // Hard to determine
      sliceStrategy: this.getSliceStrategy(Infinity),
      variables: this.extractVariables(condition),
    };
  }

  findMatchingWhileForDo(lines, startLineIndex) {
      let braceCount = 1;
      for (let i = startLineIndex + 1; i < lines.length; i++) {
          if (lines[i].includes('{')) braceCount++;
          if (lines[i].includes('}')) braceCount--;
          if (braceCount === 0) {
              // Found the closing brace, the while should be on this line or the next
              if (lines[i].match(/}\s*while\s*\(.*\)\s*;/)) {
                  return i + 1;
              }
              if (i + 1 < lines.length && lines[i+1].match(/^\s*while\s*\(.*\)\s*;/)) {
                  return i + 2;
              }
          }
      }
      return -1; // Not found
  }

  estimateForIterations(init, condition, increment) {
    try {
      // Very basic estimator for `for (int i = X; i < Y; i++)`
      const initMatch = init.match(/(\w+)\s*=\s*(-?\d+)/);
      if (!initMatch) return Infinity;
      
      const varName = initMatch[1];
      const initValue = parseInt(initMatch[2]);
      
      const conditionRegex = new RegExp(`${varName}\s*(<|<=|>|>=|!=)\s*(-?\d+)`);
      const conditionMatch = condition.match(conditionRegex);
      if (!conditionMatch) return Infinity;

      const operator = conditionMatch[1];
      const limitValue = parseInt(conditionMatch[2]);

      const incrementRegex = new RegExp(`${varName}(\+\+|--|\+=\d+|\-=\d+)`);
      const incrementMatch = increment.match(incrementRegex);
      if (!incrementMatch) return Infinity;

      const incrementOp = incrementMatch[1];
      let step = 1;
      if(incrementOp.includes('+=')) step = parseInt(incrementOp.substring(2));
      if(incrementOp.includes('-=')) step = -parseInt(incrementOp.substring(2));
      if(incrementOp === '--') step = -1;

      if ((operator === '<' || operator === '<=') && step > 0) {
        return Math.ceil((limitValue - initValue) / step);
      }
      if ((operator === '>' || operator === '>=') && step < 0) {
        return Math.ceil((initValue - limitValue) / Math.abs(step));
      }

      return Infinity;
    } catch (e) {
      logger.warn('Could not estimate loop iterations.', e);
      return Infinity;
    }
  }

  getSliceStrategy(iterations) {
    if (iterations <= 50) {
      return { type: 'full' };
    }
    if (iterations <= 500) {
      return { type: 'sample', first: 10, last: 10, everyNth: 5 };
    }
    return { type: 'sample', first: 10, last: 10, everyNth: 10 };
  }

  extractVariables(...expressions) {
    const variables = new Set();
    // A simple regex to find variable-like names
    const varRegex = /[a-zA-Z_][a-zA-Z0-9_]*/g;
    const keywords = new Set(['for', 'while', 'do', 'int', 'const', 'char', 'float', 'double', 'long', 'short', 'unsigned', 'signed', 'void']);
    
    for (const expr of expressions) {
        if(!expr) continue;
        let match;
        while ((match = varRegex.exec(expr)) !== null) {
            if (!keywords.has(match[0]) && isNaN(match[0])) {
                variables.add(match[0]);
            }
        }
    }
    return Array.from(variables);
  }
}

export default new LoopAnalyzerService();