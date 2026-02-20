import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { jest } from '@jest/globals';
import normalizer from '../src/services/control-flow-normalizer.service.js';

function lineColFromOffset(source, offset) {
  const prefix = source.slice(0, offset);
  const line = prefix.split('\n').length;
  const lastNewline = prefix.lastIndexOf('\n');
  const col = offset - lastNewline;
  return { line, col };
}

function makeLoc(source, offset, tokLen = 1) {
  const { line, col } = lineColFromOffset(source, offset);
  return { offset, line, col, tokLen };
}

function makeNode(source, kind, startOffset, endOffset, endTokLen = 1, inner = [], extra = {}) {
  return {
    kind,
    range: {
      begin: makeLoc(source, startOffset, 1),
      end: makeLoc(source, endOffset, endTokLen)
    },
    inner,
    ...extra
  };
}

function buildAstForMainSample(source) {
  const ifA = source.indexOf('if (a)');
  const foo = source.indexOf('foo()');
  const elseIf = source.indexOf('else if (b)');
  const ifB = source.indexOf('if (b)');
  const bar = source.indexOf('bar()');
  const elseFinal = source.indexOf('\n  else\n');
  const elseToken = elseFinal >= 0 ? elseFinal + 3 : source.indexOf('else\n    baz();');
  const baz = source.indexOf('baz()');
  const forTok = source.indexOf('for (int i = 0; i < 3; i++)');
  const tick = source.indexOf('tick()');
  const whileTok = source.indexOf('\n  while (ready)');
  const whilePos = whileTok >= 0 ? whileTok + 3 : source.indexOf('while (ready)');
  const spin = source.indexOf('spin()');
  const doTok = source.indexOf('\n  do\n');
  const doPos = doTok >= 0 ? doTok + 3 : source.indexOf('do\n');
  const step = source.indexOf('step()');
  const doWhile = source.lastIndexOf('while (ready);');

  const fooEnd = source.indexOf(')', foo);
  const barEnd = source.indexOf(')', bar);
  const bazEnd = source.indexOf(')', baz);
  const tickEnd = source.indexOf(')', tick);
  const spinEnd = source.indexOf(')', spin);
  const stepEnd = source.indexOf(')', step);
  const nestedIfEnd = bazEnd;
  const outerIfEnd = bazEnd;
  const forEnd = tickEnd;
  const whileEnd = spinEnd;
  const doEnd = source.indexOf(';', doWhile);
  const doWhileCond = doWhile + 'while ('.length;

  const condA = makeNode(source, 'DeclRefExpr', source.indexOf('a)', ifA), source.indexOf('a)', ifA));
  const condB = makeNode(source, 'DeclRefExpr', source.indexOf('b)', ifB), source.indexOf('b)', ifB));
  const condReady = makeNode(source, 'DeclRefExpr', source.indexOf('ready)', whilePos), source.indexOf('y', source.indexOf('ready)', whilePos)));
  const condDoReady = makeNode(source, 'DeclRefExpr', doWhileCond, source.indexOf('y', doWhileCond));

  const fooStmt = makeNode(source, 'CallExpr', foo, fooEnd);
  const barStmt = makeNode(source, 'CallExpr', bar, barEnd);
  const bazStmt = makeNode(source, 'CallExpr', baz, bazEnd);
  const tickStmt = makeNode(source, 'CallExpr', tick, tickEnd);
  const spinStmt = makeNode(source, 'CallExpr', spin, spinEnd);
  const stepStmt = makeNode(source, 'CallExpr', step, stepEnd);

  const nestedIf = makeNode(
    source,
    'IfStmt',
    ifB,
    nestedIfEnd,
    1,
    [condB, barStmt, bazStmt],
    { hasElse: true }
  );

  const outerIf = makeNode(
    source,
    'IfStmt',
    ifA,
    outerIfEnd,
    1,
    [condA, fooStmt, nestedIf],
    { hasElse: true }
  );

  const forStmt = makeNode(source, 'ForStmt', forTok, forEnd, 1, [
    makeNode(source, 'DeclStmt', source.indexOf('int i', forTok), source.indexOf('0', forTok)),
    makeNode(source, 'BinaryOperator', source.indexOf('i < 3', forTok), source.indexOf('3', forTok)),
    makeNode(source, 'UnaryOperator', source.indexOf('i++)', forTok), source.indexOf(')', forTok)),
    tickStmt
  ]);

  const whileStmt = makeNode(source, 'WhileStmt', whilePos, whileEnd, 1, [condReady, spinStmt]);
  const doStmt = makeNode(source, 'DoStmt', doPos, doEnd, 1, [stepStmt, condDoReady]);

  return {
    kind: 'TranslationUnitDecl',
    inner: [
      {
        kind: 'FunctionDecl',
        range: {
          begin: makeLoc(source, source.indexOf('main')),
          end: makeLoc(source, source.lastIndexOf('}'))
        },
        inner: [
          {
            kind: 'CompoundStmt',
            range: {
              begin: makeLoc(source, source.indexOf('{')),
              end: makeLoc(source, source.lastIndexOf('}'))
            },
            inner: [outerIf, forStmt, whileStmt, doStmt]
          }
        ]
      }
    ]
  };
}

describe('control-flow-normalizer.service', () => {
  it('normalizes if/else-if/else/for/while/do-while single bodies into blocks', () => {
    const source = [
      'int main() {',
      '  if (a)',
      '    foo();',
      '  else if (b)',
      '    bar();',
      '  else',
      '    baz();',
      '  for (int i = 0; i < 3; i++)',
      '    tick();',
      '  while (ready)',
      '    spin();',
      '  do',
      '    step();',
      '  while (ready);',
      '}'
    ].join('\n');

    const ast = buildAstForMainSample(source);
    const context = normalizer.createContext(source, path.resolve('sample.c'), 'c', '\n');
    const insertions = normalizer.collectInsertions(ast, context);
    const normalized = normalizer.applyInsertions(source, insertions);

    expect(normalized).toContain('if (a) {');
    expect(normalized).toContain('} else if (b) {');
    expect(normalized).toContain('} else {');
    expect(normalized).toContain('for (int i = 0; i < 3; i++) {');
    expect(normalized).toContain('while (ready) {');
    expect(normalized).toContain('do {');
    expect(normalized).toContain('} while (ready);');
  });

  it('skips macro/preprocessor/instrumented control bodies', () => {
    const source = [
      '#if 1',
      'if (a)',
      '  foo();',
      '#endif',
      'if (b)',
      '  __trace_assign(x, x, 1);',
      'if (c)',
      '  bar();'
    ].join('\n');

    const ifA = makeNode(source, 'IfStmt',
      source.indexOf('if (a)'),
      source.indexOf(')', source.indexOf('foo()')),
      1,
      [
        makeNode(source, 'DeclRefExpr', source.indexOf('a)'), source.indexOf('a)')),
        makeNode(source, 'CallExpr', source.indexOf('foo()'), source.indexOf(')', source.indexOf('foo()')))
      ]
    );

    // Simulate macro expansion location for second if.
    const ifBStart = source.indexOf('if (b)');
    const ifB = {
      kind: 'IfStmt',
      range: {
        begin: { expansionLoc: makeLoc(source, ifBStart, 2) },
        end: { expansionLoc: makeLoc(source, source.indexOf(')', source.indexOf('__trace_assign')), 1) }
      },
      inner: [
        makeNode(source, 'DeclRefExpr', source.indexOf('b)'), source.indexOf('b)')),
        makeNode(source, 'CallExpr', source.indexOf('__trace_assign'), source.indexOf(')', source.indexOf('__trace_assign')))
      ]
    };

    const ifC = makeNode(source, 'IfStmt',
      source.indexOf('if (c)'),
      source.indexOf(')', source.indexOf('bar()')),
      1,
      [
        makeNode(source, 'DeclRefExpr', source.indexOf('c)'), source.indexOf('c)')),
        makeNode(source, 'CallExpr', source.indexOf('bar()'), source.indexOf(')', source.indexOf('bar()')))
      ]
    );

    const ast = {
      kind: 'TranslationUnitDecl',
      inner: [ifA, ifB, ifC]
    };

    const context = normalizer.createContext(source, path.resolve('skip-sample.c'), 'c', '\n');
    const insertions = normalizer.collectInsertions(ast, context);
    const normalized = normalizer.applyInsertions(source, insertions);

    expect(normalized).toContain('if (c) {');
    expect(normalized).not.toContain('#if 1\nif (a) {');
    expect(normalized).not.toContain('if (b) {');
  });

  it('ignores included-header nodes even when range locations omit file', () => {
    const source = [
      'int main() {',
      '  if (a)',
      '    foo();',
      '}'
    ].join('\n');

    const ifPos = source.indexOf('if (a)');
    const foo = source.indexOf('foo()');
    const fooEnd = source.indexOf(')', foo);

    const condA = makeNode(source, 'DeclRefExpr', source.indexOf('a)', ifPos), source.indexOf('a)', ifPos));
    const fooStmt = makeNode(source, 'CallExpr', foo, fooEnd);

    const sourceIf = makeNode(source, 'IfStmt', ifPos, fooEnd, 1, [condA, fooStmt]);

    const headerIf = makeNode(source, 'IfStmt', ifPos + 1, fooEnd, 1, [condA, fooStmt], {
      loc: { ...makeLoc(source, ifPos + 1, 2), file: path.resolve('header.hpp') }
    });
    headerIf.range.begin = { ...headerIf.range.begin, includedFrom: { file: path.resolve('sample.cpp') } };
    headerIf.range.end = { ...headerIf.range.end, includedFrom: { file: path.resolve('sample.cpp') } };

    const astSourceOnly = { kind: 'TranslationUnitDecl', inner: [sourceIf] };
    const astWithHeader = { kind: 'TranslationUnitDecl', inner: [sourceIf, headerIf] };

    const context = normalizer.createContext(source, path.resolve('sample.cpp'), 'cpp', '\n');
    expect(normalizer.nodeIsInSourceFile(sourceIf, context)).toBe(true);
    expect(normalizer.nodeIsInSourceFile(headerIf, context)).toBe(false);

    const insertions1 = normalizer.collectInsertions(astSourceOnly, context);
    const normalized1 = normalizer.applyInsertions(source, insertions1);

    const insertions2 = normalizer.collectInsertions(astWithHeader, context);
    const normalized2 = normalizer.applyInsertions(source, insertions2);

    const countClosings = (text) => (text.match(/\n  \}/g) || []).length;
    expect(countClosings(normalized1)).toBe(1);
    expect(normalized2).toBe(normalized1);
    expect(countClosings(normalized2)).toBe(1);
  });

  it('writes a new normalized file and keeps original untouched', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codeviz-normalizer-test-'));
    const inputFile = path.join(tempDir, 'sample.c');
    const source = [
      'int main() {',
      '  if (a)',
      '    foo();',
      '}'
    ].join('\n');
    await fs.writeFile(inputFile, source, 'utf-8');

    const ast = {
      kind: 'TranslationUnitDecl',
      inner: [
        makeNode(source, 'IfStmt',
          source.indexOf('if (a)'),
          source.indexOf(')', source.indexOf('foo()')),
          1,
          [
            makeNode(source, 'DeclRefExpr', source.indexOf('a)'), source.indexOf('a)')),
            makeNode(source, 'CallExpr', source.indexOf('foo()'), source.indexOf(')', source.indexOf('foo()')))
          ]
        )
      ]
    };

    const dumpSpy = jest.spyOn(normalizer, 'dumpAst')
      .mockResolvedValueOnce(ast)
      .mockResolvedValueOnce(ast);

    const result = await normalizer.normalizeFile(inputFile, 'c');
    const originalAfter = await fs.readFile(inputFile, 'utf-8');
    const normalizedAfter = await fs.readFile(result.normalizedFile, 'utf-8');

    expect(result.normalizedFile).toMatch(/\.normalized\.c$/);
    expect(originalAfter).toBe(source);
    expect(normalizedAfter).toContain('if (a) {');
    expect(normalizedAfter).not.toBe(source);

    dumpSpy.mockRestore();
  });
});
