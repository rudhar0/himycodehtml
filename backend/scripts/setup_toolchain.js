
import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';
import * as tar from 'tar';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const TOOLCHAIN_ROOT = path.join(PROJECT_ROOT, 'resources', 'toolchain');
const METADATA_PATH = path.join(TOOLCHAIN_ROOT, 'metadata.json');

// Configuration
const VERSION = '18.1.8';
const MACOS_URL = `https://github.com/llvm/llvm-project/releases/download/llvmorg-${VERSION}/clang+llvm-${VERSION}-arm64-apple-macos11.tar.xz`;
const LINUX_URL = `https://github.com/llvm/llvm-project/releases/download/llvmorg-${VERSION}/clang+llvm-${VERSION}-x86_64-linux-gnu-ubuntu-18.04.tar.xz`;

async function downloadWithRetry(url, dest, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`Downloading ${url} (Attempt ${i + 1}/${retries})...`);
            const response = await axios({
                method: 'GET',
                url: url,
                responseType: 'stream',
                timeout: 120000 // 120s timeout
            });

            const writer = fs.createWriteStream(dest);
            response.data.pipe(writer);

            return new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });
        } catch (error) {
            console.error(`Attempt ${i + 1} failed: ${error.message}`);
            if (i === retries - 1) throw error;
            await new Promise(res => setTimeout(res, 2000)); // Wait 2s before retry
        }
    }
}

async function extractArchive(archivePath, destDir) {
    console.log(`Extracting ${archivePath} to ${destDir}...`);
    await fs.ensureDir(destDir);

    try {
        await tar.x({
            file: archivePath,
            cwd: destDir,
            strip: 1 // Strip top-level directory
        });
    } catch (err) {
        console.warn(`Node-tar failed, trying system tar: ${err.message}`);
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        await execAsync(`tar -xf "${archivePath}" -C "${destDir}" --strip-components=1`);
    }
}

async function main() {
    console.log(`Starting toolchain setup for LLVM ${VERSION}...`);

    // Ensure metadata exists
    if (!fs.existsSync(METADATA_PATH)) {
        throw new Error(`Metadata file not found at ${METADATA_PATH}`);
    }

    // 1. Setup macOS
    const macosDir = path.join(TOOLCHAIN_ROOT, 'macos');
    const macosArchive = path.join(TOOLCHAIN_ROOT, 'macos_toolchain.tar.xz');

    // Basic check if clang exists
    if (!fs.existsSync(path.join(macosDir, 'bin', 'clang'))) {
        console.log('Setting up macOS toolchain (ARM64)...');
        await fs.ensureDir(path.dirname(macosArchive));
        await downloadWithRetry(MACOS_URL, macosArchive);
        await extractArchive(macosArchive, macosDir);
        await fs.remove(macosArchive);
        console.log('macOS toolchain setup complete.');
    } else {
        console.log('macOS toolchain already exists.');
    }

    // 2. Setup Linux
    const linuxDir = path.join(TOOLCHAIN_ROOT, 'linux');
    const linuxArchive = path.join(TOOLCHAIN_ROOT, 'linux_toolchain.tar.xz');

    if (!fs.existsSync(path.join(linuxDir, 'bin', 'clang'))) {
        console.log('Setting up Linux toolchain (x86_64)...');
        await downloadWithRetry(LINUX_URL, linuxArchive);
        await extractArchive(linuxArchive, linuxDir);
        await fs.remove(linuxArchive);
        console.log('Linux toolchain setup complete.');
    } else {
        console.log('Linux toolchain already exists.');
    }

    // 3. Update metadata.json
    const metadata = await fs.readJson(METADATA_PATH);
    metadata.version = VERSION;
    metadata.platforms = ["windows", "macos", "linux"];
    metadata.headers = "shared";
    metadata.compiler = "clang";
    metadata.crossPlatformDeterministic = true;

    await fs.writeJson(METADATA_PATH, metadata, { spaces: 2 });
    console.log('Metadata updated.');

    console.log('Toolchain setup finished successfully.');
}

main().catch(err => {
    console.error('Fatal Error:', err);
    process.exit(1);
});
