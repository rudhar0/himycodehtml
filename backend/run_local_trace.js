import fs from 'fs';
import tracer from './src/services/instrumentation-tracer.service.js';

async function main() {
    const traceJsonPath = 'C:\\Users\\rcb35\\AppData\\Local\\CodeViz\\runtime\\temp\\trace_89a1951e-d9cf-481a-9a7b-e8281f294f63.json';
    const traceData = JSON.parse(fs.readFileSync(traceJsonPath, 'utf8'));
    console.log(`Loaded ${traceData.events.length} events`);

    // Convert to steps using the same logic as the backend
    const userSourceBase = 'src_89a1951e-d9cf-481a-9a7b-e8281f294f63.instrumented.c';
    const steps = tracer.convertToSteps(traceData, userSourceBase, 'd:\\testvicneusof\\dummy.c');
    console.log(`Generated ${steps.steps.length} steps`);
}
main().catch(console.error);
