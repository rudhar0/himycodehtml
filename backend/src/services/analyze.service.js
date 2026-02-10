
class AnalyzeService {
  async analyze({ code, language = 'c' }) {
    throw new Error('The analyze function is deprecated. Please use the debugger service.');
  }

  async validateSyntax({ code, language = 'c' }) {
    return { valid: true, errors: [] };
  }

  async getInputRequirements({ code, language = 'c' }) {
    return { requirements: [], needsInput: false };
  }
}

export const analyzeService = new AnalyzeService();
export default AnalyzeService;
