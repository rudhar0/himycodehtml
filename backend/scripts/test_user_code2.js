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

        const steps = await tracerService.convertToSteps(events, executable, sourceFile, output, functions, null, []);

        for (const step of steps) {
            console.log(`[Step] ${step.eventType} -> func: ${step.function}, frameId: ${step.frameId}, scopeDept: ${step.scopeDepth}, line: ${step.line}`);
        }
    } catch (e) {
        console.error(e);
    }
}

run();
