import resourceResolver from '../src/services/resource-resolver.service.js';
import fs from 'fs';

console.log('Project Root:', resourceResolver.getProjectRoot());
console.log('Runtime Root:', resourceResolver.getRuntimeRoot());
console.log('Temp Root:', resourceResolver.getTempRoot());

try {
    const temp = resourceResolver.getTempRoot();
    fs.mkdirSync(temp, { recursive: true });
    fs.accessSync(temp, fs.constants.W_OK);
    console.log('Write access to temp root: OK');
} catch (e) {
    console.error('Write access to temp root: FAILED', e.message);
    process.exit(1);
}
