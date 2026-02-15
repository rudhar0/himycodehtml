
import path from 'path';
import fs from 'fs';
import { ensureRuntime } from '../src/utils/runtime-manager.js';

// process.env.NEUTRALA_RUNTIME_NO_NEU = 'true';
process.env.NEUTRALA_RUNTIME_NO_NEU = 'true';
// process.env.DEBUG = 'true';

const resourcesDir = path.resolve('../resources');

console.log('Testing ensureRuntime with NEUTRALA_RUNTIME_NO_NEU=true');
console.log('Resources Dir:', resourcesDir);

const runtimeDir = path.join(resourcesDir, 'neutrala-runtime');
if (fs.existsSync(runtimeDir)) {
    console.log('Deleting existing runtime dir:', runtimeDir);
    fs.rmSync(runtimeDir, { recursive: true, force: true });
}

try {
    const result = await ensureRuntime({ resourcesDir });
    console.log('SUCCESS!!! ensureRuntime finished.');
    console.log('Result:', JSON.stringify(result, null, 2));

    const installDir = path.join(resourcesDir, 'neutrala-runtime', process.platform === 'win32' ? 'windows' : 'linux');
    console.log('Checking installDir:', installDir);
    if (fs.existsSync(installDir)) {
        console.log('Install dir exists.');
        console.log('Contents:', fs.readdirSync(installDir));
    } else {
        console.log('Install dir DOES NOT exist!');
    }

} catch (error) {
    console.log('FAILURE!!! ensureRuntime threw an error.');
    console.log('Error message:', error.message);
    if (error.stack) console.log('Error stack:', error.stack);
}
