
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

// Extract actual binaries, not just symlinks
const FILES_TO_EXTRACT = [
    '*/bin/clang-18', // Actual binary
    '*/bin/lldb',
    '*/bin/llvm-addr2line', '*/bin/llvm-symbolizer',
    '*/lib/libc++.so.1.0', // Actual lib
    '*/lib/libc++abi.so.1.0',
    '*/lib/libunwind.so.1.0',
    '*/lib/clang/*/include/*'
];

async function installLinuxMinimal() {
    log('Starting minimal Linux install (Attempt 2 with clang-18)...');

    // Don't wipe everything if headers/libs extracted, but safer to wipe to avoid mess
    if (await fs.pathExists(LINUX_DIR)) {
        await fs.rm(LINUX_DIR, { recursive: true, force: true });
    }
    await fs.ensureDir(LINUX_DIR);

    log(`Downloading ${LINUX_URL} ...`);

    const response = await axios({
        method: 'GET',
        url: LINUX_URL,
        responseType: 'stream'
    });

    return new Promise((resolve, reject) => {
        const args = ['-x', '-f', '-', '-C', LINUX_DIR, '--strip-components=1'];
        args.push(...FILES_TO_EXTRACT);

        log(`Spawning tar with args: ${args.join(' ')}`);

        const tarProcess = spawn('tar', args); // uses system tar

        response.data.pipe(tarProcess.stdin);

        tarProcess.stderr.on('data', (d) => log(`tar stderr: ${d}`));

        tarProcess.on('close', async (code) => {
            if (code === 0) {
                log('Linux minimal install successful.');
                // Post-process: symlinks might be missing
                await postProcess();
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

async function postProcess() {
    // Create copies for clang -> clang-18
    const binDir = path.join(LINUX_DIR, 'bin');
    const clang18 = path.join(binDir, 'clang-18');
    const clang = path.join(binDir, 'clang');
    const clangCpp = path.join(binDir, 'clang++'); // usually symlink to clang

    if (await fs.pathExists(clang18)) {
        log('Creating clang/clang++ copies from clang-18...');
        await fs.copy(clang18, clang);
        await fs.copy(clang18, clangCpp);
    } else {
        log('Warning: clang-18 not found!');
    }

    // Lib symlinks: libc++.so -> libc++.so.1.0
    const libDir = path.join(LINUX_DIR, 'lib');
    const libs = [
        { real: 'libc++.so.1.0', link: 'libc++.so.1' },
        { real: 'libc++.so.1.0', link: 'libc++.so' },
        { real: 'libc++abi.so.1.0', link: 'libc++abi.so.1' },
        { real: 'libc++abi.so.1.0', link: 'libc++abi.so' },
        { real: 'libunwind.so.1.0', link: 'libunwind.so.1' },
        { real: 'libunwind.so.1.0', link: 'libunwind.so' }
    ];

    for (const l of libs) {
        const realPath = path.join(libDir, l.real);
        const linkPath = path.join(libDir, l.link);
        if (await fs.pathExists(realPath)) {
            // copy instead of symlink to be safe on Windows
            await fs.copy(realPath, linkPath);
        }
    }
}

installLinuxMinimal().catch(err => {
    log(`Fatal error: ${err.message}`);
    process.exit(1);
});
