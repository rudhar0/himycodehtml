import { createSession, cleanupSession } from '../src/runtime/session_manager.js';
import fs from 'fs';

console.log('Testing Session Manager...');
try {
    const { sid, dir } = createSession();
    console.log(`Session created: ${sid}`);
    console.log(`Session dir: ${dir}`);

    if (fs.existsSync(dir)) {
        console.log('Session directory exists: YES');
        // Check if it is writable
        fs.writeFileSync(`${dir}/test.txt`, 'test');
        console.log('Session directory is writable: YES');

        cleanupSession(sid, { force: true });
        if (!fs.existsSync(dir)) {
            console.log('Session cleanup successful: YES');
        } else {
            console.log('Session cleanup successful: NO');
        }
    } else {
        console.log('Session directory exists: NO');
        process.exit(1);
    }
} catch (e) {
    console.error('Session Manager Test Failed:', e);
    process.exit(1);
}
