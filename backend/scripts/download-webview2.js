import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(BACKEND_ROOT, '..');
const WEBVIEW2_DIR = path.join(REPO_ROOT, 'resources', 'webview2');

// Microsoft WebView2 Fixed Version Runtime download link
const WEBVIEW2_URL = 'https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/028c7f3e-4860-4796-9d62-67cc3b5cda7d/Microsoft.WebView2.FixedVersionRuntime.131.0.2903.94.x64.cab';

async function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        };
        https.get(url, options, (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
                return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`Failed to download: ${res.statusCode}`));
            }
            const file = createWriteStream(dest);
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', reject);
    });
}

async function main() {
    console.log('WebView2 Fixed Version Bundling Tool');

    if (process.platform !== 'win32') {
        console.warn('WebView2 is only supported on Windows. Skipping.');
        return;
    }

    console.log('\nNOTE: Microsoft Fixed Version CAB URLs are frequently updated and often gated.');
    console.log('If the automated download fails, please manually download the "Fixed Version" (x64 CAB) from:');
    console.log('https://developer.microsoft.com/en-us/microsoft-edge/webview2/#download-section');
    console.log('And extract it to: resources/webview2\n');

    await fs.mkdir(WEBVIEW2_DIR, { recursive: true });
    const cabPath = path.join(WEBVIEW2_DIR, 'webview2.cab');

    console.log(`Attempting to download WebView2 cabinet to ${cabPath}...`);
    try {
        await downloadFile(WEBVIEW2_URL, cabPath);
        console.log('Download complete.');

        console.log('Extracting WebView2 cabinet...');
        const extractDir = path.join(WEBVIEW2_DIR, 'extracted');
        await fs.mkdir(extractDir, { recursive: true });
        await execAsync(`expand "${cabPath}" -F:* "${extractDir}"`);
        console.log('Extraction complete.');

        await fs.unlink(cabPath);
        console.log('Cleaned up cabinet file.');
    } catch (err) {
        console.error('\nAutomated download failed. This is common with Microsoft Fixed Version links.');
        console.error('Please manually provide the WebView2 runtime in "resources/webview2".');
        console.error(`Error details: ${err.message}`);
        process.exit(1);
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
