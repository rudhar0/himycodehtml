#!/usr/bin/env node

/**
 * Icon conversion utility for cross-platform builds.
 * Converts app.png to app.ico if needed.
 * 
 * Usage: node scripts/convert-icons.js [source-png]
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(__dirname, '..');
const APP_ICON_PNG = path.resolve(DESKTOP_ROOT, 'app.png');
const APP_ICON_ICO = path.resolve(DESKTOP_ROOT, 'app.ico');

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function convertPngToIco(pngPath, icoPath) {
  // This is a simplified BMP->ICO converter
  // For production, consider using a proper library like 'sharp' or 'jimp'
  // For now, we'll create a minimal valid ICO file from BMP data

  console.log(`[icon-converter] Converting ${pngPath} to ${icoPath}...`);

  try {
    // Try using 'sharp' if available
    try {
      const sharp = await import('sharp');
      const sharpModule = sharp.default ?? sharp;
      
      // Resize to 256x256 (standard icon size)
      await sharpModule(pngPath)
        .resize(256, 256, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
        .toFile(icoPath);
      
      console.log(`[icon-converter] ✓ Icon created: ${icoPath}`);
      return true;
    } catch (e) {
      if (e?.message?.includes('Cannot find module')) {
        // sharp not available, try jimp
        const jimp = await import('jimp');
        const jimpModule = jimp.default ?? jimp;
        
        const image = await jimpModule.read(pngPath);
        image.resize({ w: 256, h: 256 });
        await image.write(icoPath);
        
        console.log(`[icon-converter] ✓ Icon created: ${icoPath}`);
        return true;
      }
      throw e;
    }
  } catch (err) {
    console.warn(
      `[icon-converter] Warning: Could not convert PNG to ICO using available tools: ${err?.message || err}`,
    );
    console.warn(`[icon-converter] Tip: Install 'sharp' (npm install sharp) for PNG→ICO conversion.`);
    return false;
  }
}

async function validateAndConvert() {
  // Check if source PNG exists
  if (!(await exists(APP_ICON_PNG))) {
    console.warn(`[icon-converter] Source PNG not found: ${APP_ICON_PNG}`);
    return;
  }

  // Check if ICO already exists
  if (await exists(APP_ICON_ICO)) {
    console.log(`[icon-converter] ✓ ICO icon already exists: ${APP_ICON_ICO}`);
    return;
  }

  // Try to convert
  const success = await convertPngToIco(APP_ICON_PNG, APP_ICON_ICO);
  if (!success) {
    // Fallback: create a minimal placeholder (optional)
    console.warn(`[icon-converter] Skipping ICO creation. Windows installer will use PNG or no icon.`);
  }
}

validateAndConvert().catch((err) => {
  console.error(`[icon-converter] Fatal error:`, err);
  process.exit(1);
});
