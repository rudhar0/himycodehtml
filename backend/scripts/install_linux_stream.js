
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_FILE = path.join(__dirname, 'install_linux.log');

function log(msg) {
    const time = new Date().toISOString();
    const entry = `[${time}] ${msg}\n`;
    console.log(msg);
    try {
        fs.appendFileSync(LOG_FILE, entry);
    } catch (e) { }
}

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const TOOLCHAIN_ROOT = path.join(PROJECT_ROOT, 'resources', 'toolchain');
const LINUX_URL = 'https://github.com/llvm/llvm-project/releases/download/llvmorg-18.1.8/clang+llvm-18.1.8-x86_64-linux-gnu-ubuntu-18.04.tar.xz';
const LINUX_DIR = path.join(TOOLCHAIN_ROOT, 'linux');

const FILES_TO_EXTRACT = [
    '*/bin/clang', '*/bin/clang++', '*/bin/lldb', '*/bin/llvm-addr2line', '*/bin/llvm-symbolizer',
    '*/lib/libc++.so*', '*/lib/libc++abi.so*', '*/lib/libunwind.so*',
    '*/lib/clang/*/include/*'
];

async function installLinuxMinimal() {
    log('Starting minimal Linux install...');

    if (await fs.pathExists(LINUX_DIR)) {
        log('Cleaning existing linux dir...');
        await fs.rm(LINUX_DIR, { recursive: true, force: true });
    }
    await fs.ensureDir(LINUX_DIR);

    log(`Downloading ${LINUX_URL} ...`);

    // Check network
    try {
        await axios.head(LINUX_URL);
        log('URL is accessible.');
    } catch (e) {
        log(`URL check failed: ${e.message}`);
        throw e;
    }

    const response = await axios({
        method: 'GET',
        url: LINUX_URL,
        responseType: 'stream'
    });

    return new Promise((resolve, reject) => {
        // Windows tar supports -J for xz? 
        // If not, we download -> xz -> tar?
        // But tar builds often include xz. The previous error TAR_BAD_ARCHIVE in node-tar suggests format issue, 
        // but system tar failed with No Space.
        // So system tar likely supports it (or it decompressed and filled disk).
        // WE MUST USE -J or --xz if tar supports it, or rely on auto-detect.

        // On Windows 10/11 tar.exe (bsdtar) auto-detects.

        const args = ['-x', '-f', '-', '-C', LINUX_DIR, '--strip-components=1'];
        args.push(...FILES_TO_EXTRACT);

        log(`Spawning tar with args: ${args.join(' ')}`);

        const tarProcess = spawn('tar', args);

        response.data.pipe(tarProcess.stdin);

        tarProcess.stderr.on('data', (d) => log(`tar stderr: ${d}`));

        tarProcess.on('close', (code) => {
            if (code === 0) {
                log('Linux minimal install successful.');
                resolve();
            } else {
                reject(new Error(`Tar exited with code ${code}`));
            }
        });

        tarProcess.on('error', (err) => {
            log(`Spawn error: ${err.message}`);
            reject(err);
        });
    });
}

installLinuxMinimal().catch(err => {
    log(`Fatal error: ${err.message}`);
    process.exit(1);
});
