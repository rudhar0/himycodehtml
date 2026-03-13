import codeValidatorService from './src/validators/code-validator.service.js';
import logger from './src/utils/logger.js';
import fs from 'fs';

async function verify() {
  console.log('Starting verification of CodeValidatorService...');
  
  const code = 'int main() { return 0 }'; // Missing semicolon
  const language = 'c';
  
  try {
    const errors = await codeValidatorService.checkSyntax(code, language);
    const result = {
      success: errors.length === 0,
      errors: errors
    };
    fs.writeFileSync('verification_result.json', JSON.stringify(result, null, 2));
    console.log('Verification result written to verification_result.json');
  } catch (error) {
    fs.writeFileSync('verification_result.json', JSON.stringify({ error: error.message }, null, 2));
    process.exit(1);
  }
}

verify();
