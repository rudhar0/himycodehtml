import crypto from 'crypto';
import zlib from 'zlib';
import { Transform } from 'stream';
import securityConfig from '../config/security.config.js';
import logger from '../utils/logger.js';

const SALT = 'visc-salt'; // A constant salt for PBKDF2

class DataSecurityService {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.ivLength = 12;
    this.salt = SALT;
    this.keyIterations = 100000; // Standard for PBKDF2
    this.keylen = 32; // 256 bits
    this.digest = 'sha512';
    this.serverSecret = securityConfig.serverSecret;
  }

  /**
   * Derives a session-specific encryption key.
   * @param {string} sessionId - The session ID to use for key derivation.
   * @returns {Promise<Buffer>} A promise that resolves with the derived key.
   */
  async deriveKey(sessionId) {
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(
        this.serverSecret,
        `${this.salt}:${sessionId}`,
        this.keyIterations,
        this.keylen,
        this.digest,
        (err, derivedKey) => {
          if (err) return reject(err);
          resolve(derivedKey);
        }
      );
    });
  }

  /**
   * Encrypts and compresses a chunk of data in batch mode.
   * @param {string|Buffer} data - The data to encrypt.
   * @param {string} sessionId - The session ID for key derivation.
   * @returns {Promise<object>} The encrypted chunk object.
   */
  async encrypt(data, sessionId) {
    try {
      const key = await this.deriveKey(sessionId);
      const compressed = await this.gzip(data);
      
      const iv = crypto.randomBytes(this.ivLength);
      const cipher = crypto.createCipheriv(this.algorithm, key, iv);
      
      const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
      const authTag = cipher.getAuthTag();

      return {
        iv: iv.toString('base64'),
        encryptedData: encrypted.toString('base64'),
        authTag: authTag.toString('base64'),
      };
    } catch (error) {
      logger.error({ err: error, sessionId }, 'Encryption failed.');
      throw error;
    }
  }

  /**
   * Decrypts and decompresses a chunk of data in batch mode.
   * @param {object} encryptedChunk - The encrypted chunk object.
   * @param {string} sessionId - The session ID for key derivation.
   * @returns {Promise<string>} The decrypted data.
   */
  async decrypt(encryptedChunk, sessionId) {
    try {
      const key = await this.deriveKey(sessionId);
      const iv = Buffer.from(encryptedChunk.iv, 'base64');
      const encryptedData = Buffer.from(encryptedChunk.encryptedData, 'base64');
      const authTag = Buffer.from(encryptedChunk.authTag, 'base64');

      const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
      decipher.setAuthTag(authTag);
      
      const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
      const decompressed = await this.gunzip(decrypted);

      return decompressed.toString('utf-8');
    } catch (error) {
      logger.error({ err: error, sessionId }, 'Decryption failed. Authentication tag might be invalid.');
      throw new Error('Decryption failed. Data may have been tampered with.');
    }
  }

  /**
   * Creates a stream that encrypts and compresses data.
   * @param {string} sessionId - The session ID for key derivation.
   * @returns {Promise<Transform>} A transform stream for encryption.
   */
  async createEncryptionStream(sessionId) {
    const key = await this.deriveKey(sessionId);
    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipheriv(this.algorithm, key, iv);
    
    // We need to prepend the IV to the stream and handle the auth tag at the end.
    // This requires a more complex custom stream implementation.
    // For now, let's provide a simplified stream that works on a single chunk.
    const gzip = zlib.createGzip({ level: securityConfig.compressionLevel });
    const encryptStream = new Transform({
      transform(chunk, encoding, callback) {
        // This is a simplified example. A real streaming implementation
        // would need to handle chunking, IV, and auth tags properly across stream boundaries.
        // It's often easier to encrypt chunk by chunk rather than a continuous stream with GCM.
        callback(null, cipher.update(chunk));
      },
      flush(callback) {
        this.push(cipher.final());
        this.push(cipher.getAuthTag());
        callback();
      }
    });

    // The returned stream will be a pipeline of gzip -> encrypt
    // A proper implementation is more involved. Let's stick to batch for now as it's safer.
    // I will leave the streaming methods as placeholders.
    logger.warn('Streaming encryption is not fully implemented and batch mode should be preferred.');
    return gzip.pipe(encryptStream);
  }

  /**
   * Creates a stream that decrypts and decompresses data.
   * @param {string} sessionId - The session ID for key derivation.
   * @returns {Promise<Transform>} A transform stream for decryption.
   */
  async createDecryptionStream(sessionId) {
     logger.warn('Streaming decryption is not fully implemented and batch mode should be preferred.');
     // This is highly complex to implement correctly with AES-GCM streaming.
     // It's better to send self-contained encrypted chunks.
     throw new Error('Streaming decryption is not implemented.');
  }

  // --- Helpers ---
  gzip(data) {
    return new Promise((resolve, reject) => {
      zlib.gzip(data, { level: securityConfig.compressionLevel }, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
    });
  }

  gunzip(data) {
    return new Promise((resolve, reject) => {
      zlib.gunzip(data, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
    });
  }
}

export default new DataSecurityService();