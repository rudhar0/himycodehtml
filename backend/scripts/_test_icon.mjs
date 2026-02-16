import { generateIco } from './generate-icon.js';
import path from 'path';
import fs from 'fs';

const src = path.resolve('../../desktop/app.png');
const dst = path.resolve('../../desktop/resources/test_app.ico');

console.log('Testing icon generation...');
if (!fs.existsSync(src)) {
    console.error('Source PNG not found:', src);
    process.exit(1);
}

await generateIco(src, dst);

if (fs.existsSync(dst)) {
    console.log('Success: ICO created at', dst);
} else {
    console.error('Failed: ICO not created');
    process.exit(1);
}
