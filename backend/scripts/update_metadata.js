
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const METADATA_PATH = path.resolve(__dirname, '../../resources/toolchain/metadata.json');

async function main() {
    const metadata = await fs.readJson(METADATA_PATH);
    metadata.version = "18.1.8";
    metadata.platforms = ["windows", "macos", "linux"];
    metadata.headers = "shared";
    metadata.compiler = "clang";
    metadata.crossPlatformDeterministic = true;

    // Ensure nested paths are correct if not already
    metadata.llvm_version = "18.1.8";

    await fs.writeJson(METADATA_PATH, metadata, { spaces: 2 });
    console.log('Metadata updated successfully.');
}

main().catch(console.error);
