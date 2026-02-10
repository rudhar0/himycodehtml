
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const TOOLCHAIN_ROOT = path.join(PROJECT_ROOT, 'resources', 'toolchain');
const MACOS_URL = 'https://github.com/llvm/llvm-project/releases/download/llvmorg-18.1.8/clang+llvm-18.1.8-arm64-apple-macos11.tar.xz';
const MACOS_DIR = path.join(TOOLCHAIN_ROOT, 'macos');

const FILES_TO_EXTRACT = [
    '*/bin/clang-18', '*/bin/lldb', '*/bin/llvm-addr2line', '*/bin/llvm-symbolizer',
    '*/lib/libc++.1.dylib', '*/lib/libc++abi.1.dylib', '*/lib/libunwind.1.dylib',
    '*/lib/clang/*/include/*'
];

async function installMacOsMinimal() {
    console.log('Starting minimal macOS install...');

    if (await fs.pathExists(MACOS_DIR)) {
        await fs.rm(MACOS_DIR, { recursive: true, force: true });
    }
    await fs.ensureDir(MACOS_DIR);

    console.log(`Downloading ${MACOS_URL} ...`);

    const response = await axios({
        method: 'GET',
        url: MACOS_URL,
        responseType: 'stream'
    });

    return new Promise((resolve, reject) => {
        const args = ['-x', '-f', '-', '-C', MACOS_DIR, '--strip-components=1'];
        args.push(...FILES_TO_EXTRACT);

        console.log(`Spawning tar with args: ${args.join(' ')}`);

        const tarProcess = spawn('tar', args);

        response.data.pipe(tarProcess.stdin);

        tarProcess.stderr.on('data', (d) => console.log(`tar stderr: ${d}`));

        tarProcess.on('close', async (code) => {
            if (code === 0) {
                console.log('macOS minimal install successful.');
                await postProcess();
                resolve();
            } else {
                reject(new Error(`Tar exited with code ${code}`));
            }
        });

        tarProcess.on('error', (err) => {
            console.error(`Spawn error: ${err.message}`);
            reject(err);
        });
    });
}

async function postProcess() {
    const binDir = path.join(MACOS_DIR, 'bin');
    const clang18 = path.join(binDir, 'clang-18');
    const clang = path.join(binDir, 'clang');
    const clangCpp = path.join(binDir, 'clang++');

    if (await fs.pathExists(clang18)) {
        await fs.copy(clang18, clang);
        await fs.copy(clang18, clangCpp);
    }

    const libDir = path.join(MACOS_DIR, 'lib');
    const libs = [
        { real: 'libc++.1.dylib', link: 'libc++.dylib' },
        { real: 'libc++abi.1.dylib', link: 'libc++abi.dylib' },
        { real: 'libunwind.1.dylib', link: 'libunwind.dylib' }
    ];

    for (const l of libs) {
        const realPath = path.join(libDir, l.real);
        const linkPath = path.join(libDir, l.link);
        if (await fs.pathExists(realPath)) {
            await fs.copy(realPath, linkPath);
        }
    }
}

installMacOsMinimal().catch(err => {
    console.error(`Fatal error: ${err.message}`);
    process.exit(1);
});
