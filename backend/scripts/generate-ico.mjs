import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Generates a valid ICO file from a PNG file.
 * This wraps the PNG data in an ICO container structure (Vista+ support).
 * 
 * @param {string} pngPath Path to source PNG
 * @param {string} icoPath Path to destination ICO
 * @returns {Promise<boolean>}
 */
export async function generateIco(pngPath, icoPath) {
    try {
        console.log(`[generate-ico] Reading ${pngPath}...`);
        const pngBuf = await fs.readFile(pngPath);
        const size = pngBuf.length;

        // 1. Read PNG dimensions from IHDR (starts at offset 8+8=16)
        // Signature (8) + IHDR Length (4) + IHDR Chunk Type (4) = 16 bytes offset to Width
        const width = pngBuf.readUInt32BE(16);
        const height = pngBuf.readUInt32BE(20);
        console.log(`[generate-ico] Detected dimensions: ${width}x${height}`);

        if (width > 256 || height > 256) {
            console.warn(`[generate-ico] Warning: Icon larger than 256px (${width}x${height}) might not work in all Windows versions.`);
        }

        // 2. ICO Header (6 bytes)
        // Reserved (2), Type (2), Count (2)
        const header = Buffer.alloc(6);
        header.writeUInt16LE(0, 0); // Reserved
        header.writeUInt16LE(1, 2); // Type 1 = Icon
        header.writeUInt16LE(1, 4); // Count = 1 image

        // 3. Directory Entry (16 bytes)
        // W(1), H(1), Colors(1), Res(1), Planes(2), BPP(2), Size(4), Offset(4)
        const entry = Buffer.alloc(16);
        // Width/Height: 0 means 256px
        entry.writeUInt8(width >= 256 ? 0 : width, 0);
        entry.writeUInt8(height >= 256 ? 0 : height, 1);
        entry.writeUInt8(0, 2); // No palette
        entry.writeUInt8(0, 3); // Reserved
        entry.writeUInt16LE(1, 4); // Color planes
        entry.writeUInt16LE(32, 6); // Bits per pixel
        entry.writeUInt32LE(size, 8); // Size of image data
        entry.writeUInt32LE(6 + 16, 12); // Offset (Header + Entry)

        // 4. Combine
        const fileData = Buffer.concat([header, entry, pngBuf]); // PNG data is written as-is

        console.log(`[generate-ico] Writing ${icoPath}...`);
        await fs.writeFile(icoPath, fileData);
        console.log(`[generate-ico] ✓ ICO generated successfully (${size + 22} bytes)`);
        return true;

    } catch (error) {
        console.error(`[generate-ico] Failed to generate ICO:`, error);
        return false;
    }
}
