import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import tracer from '../src/services/instrumentation-tracer.service.js';

async function testHierarchy() {
    const tests = [
        {
            name: "TEST 1: IF with function call",
            code: `
#include <stdio.h>
int factorial(int n) { return n <= 1 ? 1 : n * factorial(n - 1); }
int main() {
    int n = 3, result = 0;
    if (n > 0) {
        result = factorial(n);
    }
    return 0;
}
`
        },
        {
            name: "TEST 2: recursive call inside condition",
            code: `
#include <stdio.h>
int factorial(int n) { 
    if (n > 1) {
        return n * factorial(n - 1); 
    }
    return 1;
}
int main() {
    factorial(3);
    return 0;
}
`
        },
        {
            name: "TEST 3: nested conditions",
            code: `
#include <stdio.h>
void foo() {}
int main() {
    int a = 1, b = 1;
    if (a) {
        if (b) {
            foo();
        }
    }
    return 0;
}
`
        },
        {
            name: "TEST 4: return inside else",
            code: `
#include <stdio.h>
void foo() {}
int bar() { return 42; }
int check(int x) {
    if (x)
        foo();
    else
        return bar();
    return 0;
}
int main() {
    check(0);
    return 0;
}
`
        },
        {
            name: "TEST 5: loop + condition",
            code: `
#include <stdio.h>
void foo() {}
int main() {
    int i = 0;
    while(i < 3) {
        if (i % 2)
            foo();
        i++;
    }
    return 0;
}
`
        }
    ];

    for (const test of tests) {
        console.log("====================================================");
        console.log(test.name);
        const sourcePath = path.join(process.cwd(), 'temp_test.c');
        await fs.writeFile(sourcePath, test.code);

        const { executable, traceOutput, debugLog } = await tracer.compile(test.code, 'c');
        await tracer.executeInstrumented(executable, traceOutput, debugLog);

        const parsed = await tracer.parseTraceFile(traceOutput);
        const steps = await tracer.convertToSteps(parsed.events, executable, sourcePath, {}, []);

        // Output trace for relevant steps
        for (const step of steps) {
            if (['func_enter', 'func_exit', 'return', 'condition_eval', 'conditional_start'].includes(step.eventType)) {
                console.log("[TRACE] " + step.eventType.padEnd(15) + " | func:" + (step.function || '').padEnd(10) + " | frm:" + step.frameId + " | cond:" + (step.conditionId || null) + " | loop:" + (step.loopId || null));
            }
        }
    }
}

testHierarchy().catch(console.error);
