// backend/tests/data-security.test.js
import dataSecurityService from '../src/services/data-security.service';
import { v4 as uuidv4 } from 'uuid';

describe('DataSecurityService', () => {
  it('should correctly encrypt and decrypt a payload', async () => {
    const sessionId = uuidv4();
    const payload = { message: 'This is a secret message!', step: 42 };
    const payloadString = JSON.stringify(payload);

    // Encrypt the data
    const encryptedChunk = await dataSecurityService.encrypt(payloadString, sessionId);

    // Assert that the encrypted data is in the correct format
    expect(encryptedChunk).toHaveProperty('iv');
    expect(encryptedChunk).toHaveProperty('encryptedData');
    expect(encryptedChunk).toHaveProperty('authTag');

    // Decrypt the data
    const decryptedString = await dataSecurityService.decrypt(encryptedChunk, sessionId);
    const decryptedPayload = JSON.parse(decryptedString);

    // Assert that the decrypted data matches the original payload
    expect(decryptedPayload).toEqual(payload);
  });

  it('should fail to decrypt with the wrong session ID', async () => {
    const sessionId1 = uuidv4();
    const sessionId2 = uuidv4();
    const payload = { message: 'This is a secret message!' };
    const payloadString = JSON.stringify(payload);

    // Encrypt with session 1
    const encryptedChunk = await dataSecurityService.encrypt(payloadString, sessionId1);

    // Expect decryption with session 2 to fail
    await expect(dataSecurityService.decrypt(encryptedChunk, sessionId2))
      .rejects.toThrow('Decryption failed. Data may have been tampered with.');
  });
  
  it('should fail to decrypt if the authTag is tampered with', async () => {
    const sessionId = uuidv4();
    const payloadString = 'some data';

    const encryptedChunk = await dataSecurityService.encrypt(payloadString, sessionId);

    // Tamper with the auth tag
    const tamperedAuthTag = Buffer.from(encryptedChunk.authTag, 'base64').reverse().toString('base64');
    const tamperedChunk = { ...encryptedChunk, authTag: tamperedAuthTag };

    await expect(dataSecurityService.decrypt(tamperedChunk, sessionId))
      .rejects.toThrow('Decryption failed. Data may have been tampered with.');
  });
  
  it('should handle different data types', async () => {
      const sessionId = uuidv4();
      const testCases = [
          { data: 'a simple string' },
          { data: 12345 },
          { data: { nested: { array: [1, 'b', true] } } },
          { data: null },
      ];

      for (const testCase of testCases) {
          const payloadString = JSON.stringify(testCase);
          const encrypted = await dataSecurityService.encrypt(payloadString, sessionId);
          const decrypted = await dataSecurityService.decrypt(encrypted, sessionId);
          expect(JSON.parse(decrypted)).toEqual(testCase);
      }
  });
});