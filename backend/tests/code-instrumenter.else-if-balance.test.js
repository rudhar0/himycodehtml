import instrumenter from '../src/services/code-instrumenter.service.js';

describe('code-instrumenter else-if normalization safety', () => {
  it('keeps braces balanced for normalized else-if chains', async () => {
    const source = [
      '#include <stdio.h>',
      '',
      'int main() {',
      '  int x = 1;',
      '  if (x > 0) {',
      '    printf("Hi\\n");',
      '  } else if (x < 0) {',
      '    printf("Low\\n");',
      '  } else {',
      '    printf("Bye\\n");',
      '  }',
      '  return 0;',
      '}'
    ].join('\n');

    const output = await instrumenter.instrumentCode(source, 'c');
    const openCount = (output.match(/{/g) || []).length;
    const closeCount = (output.match(/}/g) || []).length;

    expect(openCount).toBe(closeCount);
    expect(output).toContain('__trace_condition_eval');
    expect(output).toContain('__trace_branch_taken');
  });
});
