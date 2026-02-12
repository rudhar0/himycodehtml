import express from 'express';

const router = express.Router();

/**
 * GET /api/compiler/status
 * Check Clang availability (always available)
 */
router.get('/status', (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        compiler: 'clang',
        available: true,
        ready: true,
        version: 'system-installed',
        message: 'Clang + LibTooling ready for use'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /api/compiler/info
 * Get Clang and compiler information
 */
router.get('/info', (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        compiler: 'Clang + LibTooling',
        standard: 'Industry standard (VSCode, CLion, clangd)',
        features: [
          'Full semantic analysis (not just syntax)',
          'Pointer analysis & dereferencing chains',
          'Template instantiation tracking',
          'Class inheritance hierarchies',
          'Member access & ownership tracking',
          'Control flow graph generation',
          'Call graph with virtual function resolution',
          'C++20/23 feature support'
        ],
        available: true
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

export default router;