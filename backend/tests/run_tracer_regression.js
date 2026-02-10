import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import tracer from '../src/services/instrumentation-tracer.service.js';

async function run() {
  try {
    const sample = path.join(process.cwd(), 'src', 'services', 'test.c');
    if (!existsSync(sample)) {
      console.error('Sample C file not found:', sample);
      process.exit(2);
    }

    const code = await fs.readFile(sample, 'utf-8');
    console.log('Compiling instrumented sample...');
    const { executable, traceOutput, debugLog } = await tracer.compile(code, 'c');

    console.log('Executing instrumented binary...');
    const res = await tracer.executeInstrumented(executable, traceOutput, debugLog);
    console.log('Process stdout (first 200 chars):', res.stdout.slice(0, 200));

    console.log('Parsing trace file...');
    const parsed = await tracer.parseTraceFile(traceOutput);
    const events = parsed.events || [];

    console.log(`Collected ${events.length} events`);

    if (events.length === 0) {
      console.error('Regression test failed: no events captured');
      process.exit(3);
    }

    const hasFuncEnter = events.some(e => e.type === 'func_enter');
    const hasFuncExit = events.some(e => e.type === 'func_exit');
    const hasArrayCreate = events.some(e => e.type === 'array_create');

    if (!hasFuncEnter || !hasFuncExit) {
      console.error('Regression test failed: missing func_enter/func_exit events');
      process.exit(4);
    }

    if (!hasArrayCreate) {
      console.warn('Warning: no array_create events found (may be instrumentation edge-case)');
    }

    console.log('Regression test passed');
    process.exit(0);
  } catch (e) {
    console.error('Regression test errored:', e && e.message ? e.message : e);
    process.exit(1);
  }
}

run();
