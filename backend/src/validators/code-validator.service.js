import { exec } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import logger from '../utils/logger.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TEMP_DIR = join(__dirname, '..', '..', 'temp');

class CodeValidatorService {
  /**
   * Checks code syntax using clang.
   * @param {string} code The source code.
   * @param {string} language The language ('c' or 'cpp').
   * @returns {Promise<Array>} A promise that resolves to an array of error objects.
   */
  async checkSyntax(code, language) {
    const fileName = `temp_code.${language}`;
    const filePath = join(TEMP_DIR, fileName);
    let errors = [];

    try {
      await writeFile(filePath, code);

      const command = `clang -fsyntax-only ${filePath}`;
      const { stderr } = await new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
          // Clang exits with an error if there are syntax issues,
          // so we resolve with the output instead of rejecting.
          resolve({ stdout, stderr });
        });
      });

      if (stderr) {
        errors = this.parseClangErrors(stderr);
      }

    } catch (error) {
      logger.error('Error during syntax check:', error);
      // This would be an error in the validation process itself.
      errors.push({ line: 0, type: 'validator', message: 'Failed to run syntax check.' });
    } finally {
      try {
        await unlink(filePath);
      } catch (e) { /* ignore cleanup error */ }
    }

    return errors;
  }

  /**
   * Parses clang's stderr output to extract structured errors.
   * @param {string} stderrOutput The stderr output from clang.
   * @returns {Array} An array of error objects.
   */
  parseClangErrors(stderrOutput) {
    const errors = [];
    // Regex to capture file:line:column: type: message
    const regex = /.*:(\d+):(\d+):\s+(error|warning|note):\s+(.*)/g;
    let match;

    while ((match = regex.exec(stderrOutput)) !== null) {
      errors.push({
        line: parseInt(match[1], 10),
        column: parseInt(match[2], 10),
        type: match[3], // 'error', 'warning', or 'note'
        message: match[4].trim(),
      });
    }

    return errors;
  }

  /**
   * Analyzes code using clang-tidy.
   * @param {string} code The source code.
   * @param {string} language The language ('c' or 'cpp').
   * @returns {Promise<Array>} A promise that resolves to an array of found issues.
   */
  async analyzeWithTidy(code, language) {
    const fileName = `temp_tidy_code.${language}`;
    const filePath = join(TEMP_DIR, fileName);
    let issues = [];

    try {
      await writeFile(filePath, code);

      // We add --checks='*' to enable all checks. This can be configured.
      const command = `clang-tidy ${filePath} --`;
      const { stdout } = await new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
          // Clang-tidy also exits with an error code on issues.
          resolve({ stdout, stderr });
        });
      });

      if (stdout) {
        issues = this.parseClangTidyErrors(stdout);
      }

    } catch (error) {
      logger.error('Error during clang-tidy analysis:', error);
      issues.push({ line: 0, type: 'validator', message: 'Failed to run static analysis.' });
    } finally {
      try {
        await unlink(filePath);
      } catch (e) { /* ignore cleanup error */ }
    }
    
    return issues;
  }

  /**
   * Parses clang-tidy's stdout output to extract structured errors.
   * @param {string} stdoutOutput The stdout output from clang-tidy.
   * @returns {Array} An array of issue objects.
   */
  parseClangTidyErrors(stdoutOutput) {
    const issues = [];
    // Regex to capture file:line:column: type: message [check_name]
    const regex = /.*:(\d+):(\d+):\s+(error|warning|note):\s+(.*)\s+\[(.*)\]/g;
    let match;

    while ((match = regex.exec(stdoutOutput)) !== null) {
      issues.push({
        line: parseInt(match[1], 10),
        column: parseInt(match[2], 10),
        type: `static-analysis-${match[3]}`, // e.g., 'static-analysis-warning'
        message: match[4].trim(),
        checkName: match[5].trim(),
      });
    }

    return issues;
  }
}

const codeValidatorService = new CodeValidatorService();
export default codeValidatorService;
