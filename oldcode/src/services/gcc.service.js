import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import axios from 'axios';
import extractZip from 'extract-zip';
import * as tar from 'tar'; // FIX: Use namespace import

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class GCCService {
  constructor() {
    this.gccPath = null;
    this.available = false;
    this.downloading = false;
    this.downloadProgress = 0;
    this.downloadStage = 'idle';
    this.installDir = path.join(process.cwd(), 'tools', 'gcc');
    this.gccBinPath = null;
  }

  async initialize() {
    console.log('🔧 Initializing GCC Service...');
    
    const portableGccExists = await this.checkPortableGCC();
    if (portableGccExists) {
      console.log('✅ Portable GCC found');
      this.available = true;
      this.downloadStage = 'ready';
      return;
    }

    const systemGccExists = await this.checkSystemGCC();
    if (systemGccExists) {
      console.log('✅ System GCC found');
      this.available = true;
      this.downloadStage = 'ready';
      return;
    }

    console.log('⚠️  GCC not found - will need to download');
    this.available = false;
    this.downloadStage = 'idle';
  }

  async checkPortableGCC() {
    try {
      const gccExecutable = process.platform === 'win32' ? 'gcc.exe' : 'gcc';
      const potentialPaths = [
        path.join(this.installDir, 'bin', gccExecutable),
        path.join(this.installDir, gccExecutable)
      ];

      for (const gccPath of potentialPaths) {
        if (await fs.pathExists(gccPath)) {
          this.gccPath = gccPath;
          this.gccBinPath = path.dirname(gccPath);
          
          const { stdout } = await execAsync(`"${gccPath}" --version`);
          if (stdout.includes('gcc')) {
            console.log(`✅ Portable GCC found at: ${gccPath}`);
            return true;
          }
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  async checkSystemGCC() {
    try {
      const { stdout } = await execAsync('gcc --version');
      if (stdout.includes('gcc')) {
        this.gccPath = 'gcc';
        console.log('✅ System GCC found');
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  async downloadGCC(progressCallback) {
    if (this.downloading) {
      throw new Error('Download already in progress');
    }

    this.downloading = true;
    this.downloadProgress = 0;
    this.downloadStage = 'downloading';

    try {
      await fs.ensureDir(this.installDir);
      const downloadInfo = this.getDownloadInfo();
      
      console.log(`📥 Downloading GCC from: ${downloadInfo.url}`);
      
      const downloadPath = path.join(this.installDir, downloadInfo.filename);
      await this.downloadFile(downloadInfo.url, downloadPath, (progress) => {
        this.downloadProgress = progress;
        if (progressCallback) progressCallback(progress, 'downloading');
      });

      console.log('📦 Extracting GCC...');
      this.downloadStage = 'extracting';
      if (progressCallback) progressCallback(100, 'extracting');

      if (downloadInfo.filename.endsWith('.zip')) {
        await extractZip(downloadPath, { dir: this.installDir });
      } else if (downloadInfo.filename.endsWith('.tar.xz') || downloadInfo.filename.endsWith('.tar.gz')) {
        await tar.x({
          file: downloadPath,
          cwd: this.installDir
        });
      }

      await fs.remove(downloadPath);

      const success = await this.checkPortableGCC();
      
      if (success) {
        console.log('✅ GCC installed successfully');
        this.available = true;
        this.downloading = false;
        this.downloadStage = 'ready';
        if (progressCallback) progressCallback(100, 'ready');
        return { success: true, message: 'GCC installed successfully' };
      } else {
        throw new Error('GCC installation verification failed');
      }

    } catch (error) {
      console.error('❌ GCC download failed:', error);
      this.downloading = false;
      this.downloadStage = 'failed';
      this.downloadProgress = 0;
      throw error;
    }
  }

  getDownloadInfo() {
    const platform = process.platform;
    const arch = process.arch;

    if (platform === 'win32') {
      if (arch === 'x64') {
        return {
          url: 'https://github.com/brechtsanders/winlibs_mingw/releases/download/13.2.0-16.0.6-11.0.0-ucrt-r1/winlibs-x86_64-posix-seh-gcc-13.2.0-mingw-w64ucrt-11.0.0-r1.zip',
          filename: 'mingw-gcc.zip'
        };
      }
    }
    
    if (platform === 'linux') {
      throw new Error('On Linux, please install GCC using: sudo apt-get install build-essential');
    }

    if (platform === 'darwin') {
      throw new Error('On macOS, please install GCC using: brew install gcc');
    }

    throw new Error(`Unsupported platform: ${platform}`);
  }

  async downloadFile(url, outputPath, progressCallback) {
    const writer = fs.createWriteStream(outputPath);

    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream'
    });

    const totalLength = response.headers['content-length'];
    let downloadedLength = 0;

    response.data.on('data', (chunk) => {
      downloadedLength += chunk.length;
      const progress = Math.round((downloadedLength / totalLength) * 100);
      if (progressCallback) progressCallback(progress);
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  }

  async compile(code, language = 'c', options = []) {
    if (!this.available) {
      await this.initialize();
      if (!this.available) {
        console.log('⚠️ GCC not found. Attempting automatic download...');
        try {
          await this.downloadGCC();
        } catch (err) {
          throw new Error(`GCC not available and download failed: ${err.message}`);
        }
      }
    }

    const tempDir = os.tmpdir();
    await fs.ensureDir(tempDir);

    const ext = language === 'cpp' ? 'cpp' : 'c';
    const sourceFile = path.join(tempDir, `temp_${Date.now()}.${ext}`);
    const executableFile = sourceFile.replace(`.${ext}`, '.exe');

    try {
      await fs.writeFile(sourceFile, code, 'utf-8');

      const compileCmd = `"${this.gccPath}" ${options.join(' ')} -o "${executableFile}" "${sourceFile}"`;
      
      const { stdout, stderr } = await execAsync(compileCmd);

      await fs.remove(sourceFile);

      return {
        success: true,
        executablePath: executableFile,
        errors: stderr || '',
        warnings: stdout || ''
      };

    } catch (error) {
      await fs.remove(sourceFile);

      return {
        success: false,
        errors: error.stderr || error.message,
        warnings: error.stdout || ''
      };
    }
  }

  async compileCode(code, language = 'c') {
    if (!this.available) {
      throw new Error('GCC not available');
    }

    const tempDir = os.tmpdir();
    await fs.ensureDir(tempDir);

    const ext = language === 'cpp' ? 'cpp' : 'c';
    const sourceFile = path.join(tempDir, `temp_${Date.now()}.${ext}`);

    try {
      await fs.writeFile(sourceFile, code, 'utf-8');

      const compileCmd = `"${this.gccPath}" -fsyntax-only -Wall -Wextra "${sourceFile}"`;
      
      const { stdout, stderr } = await execAsync(compileCmd);

      await fs.remove(sourceFile);

      return {
        success: true,
        errors: stderr || '',
        warnings: stdout || ''
      };

    } catch (error) {
      await fs.remove(sourceFile);

      return {
        success: false,
        errors: error.stderr || error.message,
        warnings: error.stdout || ''
      };
    }
  }



  isAvailable() {
    return this.available;
  }

  getStatus() {
    return {
      available: this.available,
      downloading: this.downloading,
      progress: this.downloadProgress,
      stage: this.downloadStage,
      gccPath: this.gccPath
    };
  }
}

export const gccService = new GCCService();
export default GCCService;