import tracer from '../src/services/instrumentation-tracer.service.js';

describe('InstrumentationTracer loop engine (strict LIFO)', () => {
  it('flushes summaries only for the ending loop (nested loops)', async () => {
    const events = [
      { type: 'loop_start', loopId: 3, loopType: 'for', file: 'main.c', line: 1 },
      { type: 'loop_body_start', loopId: 3, file: 'main.c', line: 2 },

      { type: 'loop_start', loopId: 4, loopType: 'for', file: 'main.c', line: 3 },
      { type: 'loop_body_start', loopId: 4, file: 'main.c', line: 4 },
      { type: 'assign', name: 'x', value: 1, file: 'main.c', line: 5 },
      { type: 'loop_iteration_end', loopId: 4, file: 'main.c', line: 6 },
      { type: 'loop_condition', loopId: 4, result: 1, file: 'main.c', line: 7 },
      { type: 'loop_body_start', loopId: 4, file: 'main.c', line: 8 },
      { type: 'assign', name: 'x', value: 2, file: 'main.c', line: 9 },
      { type: 'loop_iteration_end', loopId: 4, file: 'main.c', line: 10 },
      { type: 'loop_condition', loopId: 4, result: 0, file: 'main.c', line: 11 },
      { type: 'loop_end', loopId: 4, file: 'main.c', line: 12 },

      { type: 'loop_iteration_end', loopId: 3, file: 'main.c', line: 13 },
      { type: 'loop_condition', loopId: 3, result: 0, file: 'main.c', line: 14 },
      { type: 'loop_end', loopId: 3, file: 'main.c', line: 15 }
    ];

    const trackedFunctions = [];
    const steps = await tracer.convertToSteps(
      events,
      'dummy_exe',
      'main.c',
      { stdout: '', stderr: '' },
      trackedFunctions,
      new Map()
    );

    const idxLoopEnd4 = steps.findIndex(s => s.eventType === 'loop_end' && s.loopId === 4);
    const idxSummary4 = steps.findIndex(s => s.eventType === 'loop_body_summary' && s.loopId === 4);
    const idxSummary3 = steps.findIndex(s => s.eventType === 'loop_body_summary' && s.loopId === 3);

    expect(idxSummary4).toBeGreaterThanOrEqual(0);
    expect(idxLoopEnd4).toBeGreaterThanOrEqual(0);
    expect(idxSummary4).toBeLessThan(idxLoopEnd4);

    // Outer loop summary cannot flush before inner loop ends.
    if (idxSummary3 >= 0) {
      expect(idxSummary3).toBeGreaterThan(idxLoopEnd4);
    }

    // Iteration counters must increment within a single loop context.
    const innerBodyStarts = steps.filter(s => s.eventType === 'loop_body_start' && s.loopId === 4);
    expect(innerBodyStarts.map(s => s.iteration)).toEqual([1, 2]);

    // Summaries must never leak global stepIndex into internal events.
    const summary4 = steps[idxSummary4];
    expect(Array.isArray(summary4.events)).toBe(true);
    for (const internalEvent of summary4.events) {
      expect(Object.prototype.hasOwnProperty.call(internalEvent, 'stepIndex')).toBe(false);
      expect(internalEvent.internalStepIndex).toEqual(expect.any(Number));
    }

    // Monotonic timestamps across emitted steps.
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].timestamp).toBeGreaterThan(steps[i - 1].timestamp);
    }
  });
});

