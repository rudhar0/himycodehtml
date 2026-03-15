import CodeInstrumenter from './code-instrumenter.service.js';
import { writeFile } from 'fs/promises';

const code = `
#include <stdio.h>
int main() {
    for (int i = 0; i < 3; i++) {
        if (i == 1)
            printf("if-braceless\\n");
        else
            printf("else-braceless\\n");

        if (i == 2) {
            printf("if-braced\\n");
        } else {
            printf("else-braced\\n");
        }

        printf("after-if %d\\n", i);
    }
    return 0;
}
`;

async function test() {
    try {
        const instrumented = await CodeInstrumenter.injectBeginnerModeTracing(code, 'c');
        await writeFile('test_output.c', instrumented);
        console.log('✅ Instrumented code written to test_output.c');
    } catch (e) {
        console.error('TEST FAILED:', e);
    }
}

test();

test();
