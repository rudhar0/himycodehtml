/**
 * Application limits and constants
 */

export const LIMITS = {
  // Code size limits
  MAX_CODE_SIZE: 1000000, // 1MB
  CHUNK_SIZE: 5000, // 5KB per chunk for code
  
  // Trace limits
  MAX_EXECUTION_STEPS: 10000, // Maximum execution steps
  TRACE_CHUNK_SIZE: 100, // Steps per chunk when sending to frontend
  MAX_LOOP_ITERATIONS_SHOWN: 10, // Show first/last N iterations
  
  // Memory limits
  MAX_STACK_DEPTH: 100,
  MAX_HEAP_ALLOCATIONS: 1000,
  MAX_ARRAY_SIZE_SHOWN: 100,
  
  // Time limits
  EXECUTION_TIMEOUT: 30000, // 30 seconds
  ANALYSIS_TIMEOUT: 60000, // 60 seconds
  
  // Rate limiting
  MAX_REQUESTS_PER_MINUTE: 30,
  MAX_ANALYSIS_PER_HOUR: 100,
};

export default LIMITS;