import { resolve } from 'path';
import tracerService from '../src/services/instrumentation-tracer.service.js';

const code = `
#include <stdio.h>

long int factorial(int n) {
    if (n == 0 || n == 1) {
        return 1;
    }
    else {
        return n * factorial(n - 1);
    }
}

int main() {
    int n = 3;
    long int fact;

    if (n < 0) {
        printf("Factorial is not defined for negative numbers.\\n");
    } else {
        fact = factorial(n);
        printf("Factorial of %d is %ld\\n", n, fact);
    }
    return 0;
}
`;

async function run() {
    try {
        const { executable, sourceFile, traceOutput } = await tracerService.compile(code, 'c');
        const output = await tracerService.executeInstrumented(executable, traceOutput);
        const { events, functions } = await tracerService.parseTraceFile(traceOutput);

        console.log("Trace generated!");
        const steps = await tracerService.convertToSteps(events, executable, sourceFile, output, functions, null, []);
        console.log(`✅ Generated ${steps.length} steps`);

        // Print all steps to see their function attribute
        for (const step of steps) {
            if (step.eventType === 'condition_eval' || step.eventType === 'func_enter' || step.eventType === 'func_exit') {
                console.log(`[Step] ${step.eventType} -> function: ${step.function}, frameId: ${step.frameId}, parentFrameId: ${step.parentFrameId}, parentId: ${step.parentId}`);
            }
        }
    } catch (e) {
        console.error(e);
    }
}

run();
