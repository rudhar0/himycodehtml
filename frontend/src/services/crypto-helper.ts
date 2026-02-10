// frontend/src/services/crypto-helper.ts
import pako from 'pako';

/**
 * Derives a key from the session ID and a server secret.
 * This must mirror the backend's PBKDF2 implementation.
 * @param {string} sessionId - The session ID.
 * @param {string} serverSecret - The server secret.
 * @returns {Promise<CryptoKey>} The derived key.
 */
async function deriveKey(sessionId, serverSecret) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(serverSecret),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(`visc-salt:${sessionId}`),
      iterations: 100000,
      hash: 'SHA-512',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Decrypts a chunk of data.
 * @param {object} encryptedChunk - The chunk object from the backend.
 * @param {string} sessionId - The current session ID.
 * @param {string} serverSecret - The server secret.
 * @returns {Promise<any>} The decrypted and parsed chunk data.
 */
export async function decryptAndDecompressChunk(encryptedChunk, sessionId, serverSecret) {
  try {
    const key = await deriveKey(sessionId, serverSecret);
    // Convert base64 strings to Uint8Array
    const iv = base64ToUint8Array(encryptedChunk.iv);
    const encryptedData = base64ToUint8Array(encryptedChunk.encryptedData);
    const authTag = base64ToUint8Array(encryptedChunk.authTag);

    // WebCrypto expects the tag appended to the ciphertext
    const fullEncryptedData = concatUint8Arrays(encryptedData, authTag).buffer;

    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      key,
      fullEncryptedData
    );

    const decompressed = pako.inflate(new Uint8Array(decrypted), { to: 'string' });
    return JSON.parse(decompressed);
  } catch (error) {
    console.error('Decryption failed:', error);
    throw new Error('Failed to decrypt or decompress chunk.');
  }
}

function base64ToUint8Array(b64) {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function concatUint8Arrays(a, b) {
  const c = new Uint8Array(a.length + b.length);
  c.set(a, 0);
  c.set(b, a.length);
  return c;
}