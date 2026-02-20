import inputRequirementsService from '../src/services/input-requirements.service.js';

describe('input-requirements.service', () => {
  it('extracts scanf variables/types and ignores scanf return assignment', () => {
    const code = [
      'int main() {',
      '  int a; float b; char c; int ret;',
      '  ret = scanf("%d %f %c", &a, &b, &c);',
      '  return 0;',
      '}'
    ].join('\n');

    const result = inputRequirementsService.analyzeInputRequirements(code, 'c');
    expect(result.needsInput).toBe(true);
    expect(result.requirements.map((r) => r.variable)).toEqual(['a', 'b', 'c']);
    expect(result.requirements.map((r) => r.type)).toEqual(['int', 'float', 'char']);
  });

  it('extracts cin/getchar/fgets requirements', () => {
    const code = [
      'int main() {',
      '  int n, m; char ch; char buf[32];',
      '  std::cin >> n >> m;',
      '  ch = getchar();',
      '  fgets(buf, 32, stdin);',
      '}'
    ].join('\n');

    const result = inputRequirementsService.analyzeInputRequirements(code, 'cpp');
    expect(result.requirements.map((r) => r.variable)).toEqual(['n', 'm', 'ch', 'buf']);
  });

  it('normalizes provided inputs and defaults missing/invalid values', () => {
    const reqs = [
      { variable: 'x', type: 'int' },
      { variable: 'y', type: 'float' },
      { variable: 'c', type: 'char' },
      { variable: 's', type: 'string' },
    ];
    const { values, warnings } = inputRequirementsService.normalizeProvidedInputs(
      ['abc', '3.5'],
      reqs
    );

    expect(values).toEqual(['0', '3.5', 'a', 'text']);
    expect(warnings.length).toBeGreaterThan(0);
  });
});
