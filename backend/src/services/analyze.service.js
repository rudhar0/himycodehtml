
import inputRequirementsService from './input-requirements.service.js';
import codeValidatorService from '../validators/code-validator.service.js';

class AnalyzeService {
  async analyze({ code, language = 'c' }) {
    throw new Error('The analyze function is deprecated. Please use the debugger service.');
  }

  async validateSyntax({ code, language = 'c' }) {
    const allResults = await codeValidatorService.checkSyntax(code, language);
    const errors = allResults.filter(e => e.type === 'error' || e.type === 'validator');
    return {
      valid: errors.length === 0,
      errors: errors
    };
  }


  async getInputRequirements({ code, language = 'c' }) {
    return inputRequirementsService.analyzeInputRequirements(code, language);
  }
}

export const analyzeService = new AnalyzeService();
export default AnalyzeService;
