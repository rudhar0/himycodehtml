// backend/tests/loop-analyzer.test.js
import loopAnalyzerService from '../src/services/loop-analyzer.service';

describe('LoopAnalyzerService', () => {

  const sampleCode = `
#include <iostream>

int main() {
  // Simple for loop
  for (int i = 0; i < 10; i++) { // Line 5
    std::cout << "Hello";
  }

  // Loop with a larger range
  for (int j = 0; j <= 400; j += 2) { // Line 10
    // do something
  }
  
  // Loop with a very large range
  for (long k = 1000; k > 0; k--) { // Line 15
    // do something
  }

  // While loop
  int x = 0;
  while (x < 5) { // Line 20
    x++;
  }
  
  // Do-while loop
  int y = 0;
  do { // Line 25
      y++;
  } while (y < 3);

  return 0;
}
`;

  it('should detect all loop types', () => {
    const loops = loopAnalyzerService.analyze(sampleCode);
    expect(loops).toHaveLength(5);
    const types = loops.map(l => l.type);
    expect(types).toContain('for');
    expect(types).toContain('while');
    expect(types).toContain('do-while');
  });
  
  it('should correctly identify line numbers', () => {
      const loops = loopAnalyzerService.analyze(sampleCode);
      expect(loops.find(l => l.estimatedIterations === 10).line).toBe(5);
      expect(loops.find(l => l.type === 'while').line).toBe(20);
      expect(loops.find(l => l.type === 'do-while').line).toBe(25);
  });

  it('should estimate iterations for simple for loops', () => {
    const loops = loopAnalyzerService.analyze(sampleCode);
    
    const forLoop1 = loops.find(l => l.line === 5);
    expect(forLoop1.estimatedIterations).toBe(10);
    
    const forLoop2 = loops.find(l => l.line === 10);
    expect(forLoop2.estimatedIterations).toBe(201); // (400 - 0) / 2 + 1
    
    const forLoop3 = loops.find(l => l.line === 15);
    expect(forLoop3.estimatedIterations).toBe(1000);
  });

  it('should suggest the correct slice strategy', () => {
    // Iterations <= 50 -> full
    const strategy1 = loopAnalyzerService.getSliceStrategy(50);
    expect(strategy1.type).toBe('full');

    // 51-500 -> sample 10, 10, 5
    const strategy2 = loopAnalyzerService.getSliceStrategy(300);
    expect(strategy2).toEqual({ type: 'sample', first: 10, last: 10, everyNth: 5 });
    
    // 500+ -> sample 10, 10, 10
    const strategy3 = loopAnalyzerService.getSliceStrategy(1000);
    expect(strategy3).toEqual({ type: 'sample', first: 10, last: 10, everyNth: 10 });
    
    // Infinity -> sample 10, 10, 10
    const strategy4 = loopAnalyzerService.getSliceStrategy(Infinity);
    expect(strategy4).toEqual({ type: 'sample', first: 10, last: 10, everyNth: 10 });
  });

  it('should extract variables from loop expressions', () => {
    const loops = loopAnalyzerService.analyze(sampleCode);
    
    const forLoop1 = loops.find(l => l.line === 5);
    expect(forLoop1.variables).toContain('i');
    
    const whileLoop = loops.find(l => l.line === 20);
    expect(whileLoop.variables).toContain('x');
    
    const doWhileLoop = loops.find(l => l.line === 25);
    expect(doWhileLoop.variables).toContain('y');
  });
});