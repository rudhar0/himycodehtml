import { resolve } from 'path';
import tracerService from '../src/services/instrumentation-tracer.service.js';

const code = `
#include <stdio.h>

long factorial(int n) {
    if (n == 1) {
        return 1;
    }
    return n * factorial(n - 1);
}

int main() {
    printf("%ld", factorial(4));
}
`;

async function run() {
    try {
        const { executable, sourceFile, traceOutput } = await tracerService.compile(code, 'cpp');
        const output = await tracerService.executeInstrumented(executable, traceOutput);
        const { events, functions } = await tracerService.parseTraceFile(traceOutput);

        console.log("Trace generated!");
        const steps = await tracerService.convertToSteps(events, executable, sourceFile, output, functions, null, []);
        console.log(`✅ Generated ${steps.length} steps`);
        console.log(JSON.stringify(steps.slice(0, 15), null, 2));
        console.log("Done");
    } catch (e) {
        console.error(e);
    }
}

run();
