import tracer from '../src/services/instrumentation-tracer.service.js';

describe('InstrumentationTracer output metadata anchoring', () => {
  it('anchors orphan output to last executable line instead of line 0', async () => {
    const events = [
      { type: 'assign', name: 'x', value: 1, file: 'main.c', line: 12 },
    ];

    const trackedFunctions = [];
    const steps = await tracer.convertToSteps(
      events,
      'dummy_exe',
      'main.c',
      { stdout: 'done\n', stderr: '' },
      trackedFunctions,
      new Map()
    );

    const outputStep = steps.find((s) => s.eventType === 'output' && s.text === 'done');
    expect(outputStep).toBeDefined();
    expect(outputStep.line).toBe(12);
    expect(outputStep.frameId).toBe('main-0');
  });

  it('emits scopeDepth in output metadata from current frame context', async () => {
    const events = [
      { type: 'block_enter', blockDepth: 1, file: 'main.c', line: 4 },
      { type: 'assign', name: 'x', value: 1, file: 'main.c', line: 5 },
    ];

    const trackedFunctions = [];
    const steps = await tracer.convertToSteps(
      events,
      'dummy_exe',
      'main.c',
      { stdout: 'inside\n', stderr: '' },
      trackedFunctions,
      new Map()
    );

    const outputStep = steps.find((s) => s.eventType === 'output' && s.text === 'inside');
    expect(outputStep).toBeDefined();
    expect(outputStep.scopeDepth).toBe(1);
    expect(outputStep.line).toBe(5);
  });
});
