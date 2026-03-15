import codeValidatorService from '../validators/code-validator.service.js';
import logger from '../utils/logger.js';

/**
 * Middleware for multi-layer code validation.
 * It first checks for syntax errors, then for static analysis issues.
 * If any issues are found, it sends a 400 response.
 * Otherwise, it passes control to the next middleware.
 */
export const validateCode = async (req, res, next) => {
  const { code, language = 'c' } = req.body;

  if (!code) {
    return res.status(400).json({
      success: false,
      errors: [{ type: 'validation', message: 'No code provided.' }],
    });
  }

  try {
    // Layer 1: Syntax Check (Clang)
    const syntaxErrors = await codeValidatorService.checkSyntax(code, language);
    if (syntaxErrors.length > 0) {
      logger.warn(`Syntax check failed with ${syntaxErrors.length} errors.`);
      return res.status(400).json({
        success: false,
        errors: syntaxErrors.map(e => ({ ...e, type: 'syntax' })),
      });
    }

    // Layer 2: Static Analysis (Clang-Tidy)
    // For now, we might not want to block execution for warnings.
    // This can be configured based on severity.
    const analysisIssues = await codeValidatorService.analyzeWithTidy(code, language);
    if (analysisIssues.length > 0) {
      // Optional: Log these but don't necessarily block execution
      logger.info(`Static analysis found ${analysisIssues.length} issues.`);
      
      // Example: only block for errors, not warnings or notes
      const blockingIssues = analysisIssues.filter(issue => issue.type.includes('error'));
      if (blockingIssues.length > 0) {
        return res.status(400).json({
          success: false,
          errors: blockingIssues.map(e => ({ ...e, type: 'static-analysis' })),
        });
      }
    }
    
    // If all checks pass, proceed to the next middleware (e.g., the debugger controller)
    next();

  } catch (error) {
    logger.error('An unexpected error occurred in the code validation middleware:', error);
    res.status(500).json({
      success: false,
      errors: [{ type: 'server', message: 'Failed to validate code due to a server error.' }],
    });
  }
};
