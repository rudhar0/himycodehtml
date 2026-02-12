import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const DESKTOP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(DESKTOP_ROOT, '..');
const FRONTEND_PUBLIC = path.join(REPO_ROOT, 'frontend', 'public');

function downloadToFile(url, filePath) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'neutrala-desktop-sync',
          Accept: 'application/vnd.github+json',
        },
      },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          resolve(downloadToFile(res.headers.location, filePath));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Download failed (${res.statusCode}) for ${url}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', async () => {
          await fs.writeFile(filePath, Buffer.concat(chunks));
          resolve();
        });
      },
    );
    req.on('error', reject);
  });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'neutrala-desktop-sync',
          Accept: 'application/vnd.github+json',
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
  });
}

async function main() {
  await fs.mkdir(FRONTEND_PUBLIC, { recursive: true });

  const outPath = path.join(FRONTEND_PUBLIC, 'neutralino.js');
  try {
    const rel = await getJson('https://api.github.com/repos/neutralinojs/neutralino.js/releases/latest');
    const asset = (rel.assets || []).find(
      (a) => String(a?.name || '').toLowerCase() === 'neutralino.js',
    );
    if (!asset?.browser_download_url) {
      throw new Error('Could not locate neutralino.js asset in neutralinojs/neutralino.js latest release.');
    }

    const tmpPath = `${outPath}.tmp.${process.pid}`;
    await downloadToFile(asset.browser_download_url, tmpPath);
    try {
      await fs.unlink(outPath);
    } catch {
      // ignore
    }
    try {
      await fs.rename(tmpPath, outPath);
    } catch {
      // Some Windows setups can block atomic rename (AV/indexers). Fall back to copy.
      await fs.copyFile(tmpPath, outPath);
      try {
        await fs.unlink(tmpPath);
      } catch {
        // ignore
      }
    }
    // eslint-disable-next-line no-console
    console.log(`Synced neutralino.js -> ${outPath}`);
    return;
  } catch (err) {
    try {
      await fs.access(outPath);
      // eslint-disable-next-line no-console
      console.warn(
        `Warning: failed to sync neutralino.js; using existing ${outPath}. ${err?.message || err}`,
      );
      return;
    } catch {
      throw err;
    }
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
