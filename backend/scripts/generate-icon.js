import sharp from 'sharp';
import toIco from 'to-ico';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Generates a multi-resolution ICO file from a PNG file.
 * Required for proper Windows taskbar and explorer display.
 * Includes 16x16, 32x32, 48x48, and 256x256 sizes.
 *
 * @param {string} pngPath Path to source PNG
 * @param {string} icoPath Path to destination ICO
 * @returns {Promise<boolean>}
 */
export async function generateIco(pngPath, icoPath) {
    try {
        console.log(`[generate-ico] Reading ${pngPath}...`);
        const inputBuffer = await fs.readFile(pngPath);

        // Resize to required Windows sizes
        const sizes = [16, 32, 48, 256];
        console.log(`[generate-ico] Generating sizes: ${sizes.join(', ')}...`);

        const buffers = await Promise.all(
            sizes.map((size) =>
                sharp(inputBuffer)
                    .resize(size, size, {
                        fit: 'contain',
                        background: { r: 0, g: 0, b: 0, alpha: 0 },
                    })
                    .png()
                    .toBuffer(),
            ),
        );

        console.log('[generate-ico] Converting to ICO format...');
        const icoBuffer = await toIco(buffers);

        console.log(`[generate-ico] Writing ${icoPath}...`);
        await fs.writeFile(icoPath, icoBuffer);
        console.log(`[generate-ico] ✓ ICO generated successfully (${icoBuffer.length} bytes)`);
        return true;
    } catch (error) {
        console.error(`[generate-ico] Failed to generate ICO:`, error);
        return false;
    }
}
