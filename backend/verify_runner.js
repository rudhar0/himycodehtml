import tracer from './src/services/instrumentation-tracer.service.js';
import { readFileSync } from 'fs';
import path from 'path';

async function test() {
    const code = readFileSync('../verify_continue.cpp', 'utf-8');
    try {
        console.log('--- Starting Trace ---');
        const result = await tracer.generateTrace(code, 'cpp');
        console.log('--- Trace Result ---');
        console.log('Total Steps:', result.totalSteps);
        console.log('Captured Events:', result.metadata.capturedEvents);
        
        // Log the first few steps to verify loop logic
        console.log('First 20 steps:');
        result.steps.slice(0, 20).forEach(s => {
            console.log(`[Step ${s.stepIndex}] ${s.eventType} | line: ${s.line} | expl: ${s.explanation}`);
        });
        
    } catch (e) {
        console.error('Trace Failed:', e);
    }
}

test();
