import instrumentationTracer from '../src/services/instrumentation-tracer.service.js';
import path from 'path';

async function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function verifyShutdown() {
    console.log('🚀 Starting direct service verification...');

    const code = '#include <stdio.h>\nint main() { printf("hello world\\n"); return 0; }';

    console.log('� Generating trace...');
    const start = Date.now();
    try {
        const result = await instrumentationTracer.generateTrace(code, 'cpp');
        console.log(`✅ Trace generated in ${Date.now() - start}ms. Steps: ${result.steps.length}`);
    } catch (err) {
        console.error('❌ Trace failed:', err.message);
        throw err;
    }

    console.log('🛑 Testing if process exits cleanly...');
    console.log('Wait 2 seconds to see if it hangs...');
    await wait(2000);
    console.log('✅ If you see this, the event loop is clear enough to continue.');
    console.log('🎉 Verification script finished. Node should exit immediately.');
}

verifyShutdown()
    .catch(err => {
        console.error('💥 Verification failed:', err);
        process.exit(1);
    });
