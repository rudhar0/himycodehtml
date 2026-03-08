import { InstrumentationTracer } from './instrumentation-tracer.service.js';
import { readFile } from 'fs/promises';
import path from 'path';

async function run() {
    const tracer = new InstrumentationTracer();
    const code = await readFile('d:/testvicneusof/factorial.c', 'utf-8');

    console.log('--- Compiling ---');
    const linked = await tracer.compile(code, 'c');
    console.log('Compiled:', linked.executable);

    console.log('--- Executing ---');
    const output = await tracer.executeInstrumented(linked.executable, linked.traceOutput);
    console.log('Execution finished');
    console.log('Stdout:', output.stdout);

    console.log('--- Parsing Trace ---');
    const { events, functions } = await tracer.parseTraceFile(linked.traceOutput);

    console.log('--- Converting to Steps ---');
    const steps = await tracer.convertToSteps(events, linked.executable, linked.sourceFile, output, functions);

    console.log('--- DONE ---');
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
