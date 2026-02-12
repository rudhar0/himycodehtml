import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(DESKTOP_ROOT, '..');
const FRONTEND_ROOT = path.join(REPO_ROOT, 'frontend');
const RESOURCES_DIR = path.join(DESKTOP_ROOT, 'resources');

async function exists(p) {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}

async function copyDir(src, dst) {
    await fs.mkdir(dst, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
        const s = path.join(src, entry.name);
        const d = path.join(dst, entry.name);
        if (entry.isDirectory()) {
            await copyDir(s, d);
        } else {
            await fs.copyFile(s, d);
        }
    }
}

async function run(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: 'inherit', shell: true, ...opts });
        child.on('exit', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`${cmd} exited with code ${code}`));
        });
        child.on('error', reject);
    });
}

async function main() {
    console.log('🚀 Synchronizing assets...');

    // 1. Build frontend
    console.log('📦 Building frontend...');
    await run('npm', ['run', 'build:ui'], { cwd: FRONTEND_ROOT });

    // 2. Prepare resources directory
    console.log('📂 Preparing resources directory...');
    await fs.rm(RESOURCES_DIR, { recursive: true, force: true });
    await fs.mkdir(RESOURCES_DIR, { recursive: true });

    // 3. Copy frontend dist to resources
    const distDir = path.join(FRONTEND_ROOT, 'dist');
    if (await exists(distDir)) {
        console.log('📂 Copying frontend assets...');
        await copyDir(distDir, RESOURCES_DIR);
    } else {
        throw new Error(`Frontend dist not found at ${distDir}`);
    }

    // 4. Copy icons
    const appPng = path.join(DESKTOP_ROOT, 'app.png');
    if (await exists(appPng)) {
        console.log('🖼️ Copying app icon...');
        await fs.copyFile(appPng, path.join(RESOURCES_DIR, 'app.png'));
        // Also copy to root resources if it needs to be there
        await fs.copyFile(appPng, path.join(RESOURCES_DIR, 'app.ico')); // Temporary hack as Neutralino might expect .ico
    }

    // 5. Sync neutralino.js (if not in dist)
    const neutralinoJs = path.join(FRONTEND_ROOT, 'public', 'neutralino.js');
    const targetNeuJs = path.join(RESOURCES_DIR, 'neutralino.js');
    if (await exists(neutralinoJs) && !(await exists(targetNeuJs))) {
        await fs.copyFile(neutralinoJs, targetNeuJs);
    }

    console.log('✅ Asset synchronization complete!');
}

main().catch((err) => {
    console.error('❌ Sync failed:', err);
    process.exit(1);
});
