// ============================================================================
// COMPLETE STEP FILTERING & PROCESSING SYSTEM FOR C/C++ VISUALIZATION
// ============================================================================
// Fixes:
// 1. Over-filtering of variable declarations (int x, y, z;)
// 2. Scope confusion (first variable appearing as local AND global)
// 3. Output tracking (clean output without extra metadata)
// 4. Frontend skipping simple assignments (var = value;)
// ============================================================================

/**
 * Enhanced Step Filter - Backend Service
 * Place this in: backend/src/services/step-filter.service.js
 */
class StepFilterService {
  constructor() {
    this.mainStarted = false;
    this.globalInitPhase = true;
    this.userSourceFile = null;
    this.seenVariables = new Set();
    this.outputBuffer = '';
    this.lastOutputIndex = 0;
  }

  /**
   * Main entry point - filters and processes all steps
   */
  filterAndProcessSteps(rawSteps, sourceFile, programOutput) {
    console.log(`📊 Filtering ${rawSteps.length} raw steps...`);
    
    this.reset();
    this.userSourceFile = sourceFile;
    this.outputBuffer = programOutput || '';
    
    const filteredSteps = [];
    let stepIndex = 0;

    for (let i = 0; i < rawSteps.length; i++) {
      const step = rawSteps[i];
      
      // Process step and determine if we should keep it
      const processedStep = this.processStep(step, i, rawSteps);
      
      if (processedStep) {
        processedStep.id = stepIndex++;
        filteredSteps.push(processedStep);
      }
    }

    console.log(`✅ Kept ${filteredSteps.length} steps (filtered ${rawSteps.length - filteredSteps.length})`);
    return filteredSteps;
  }

  /**
   * Process individual step - returns processed step or null if filtered
   */
  processStep(step, index, allSteps) {
    // Clone step to avoid mutations
    const processed = JSON.parse(JSON.stringify(step));

    // Normalize: eventType from instrumentation-tracer -> type field
    if (!processed.type && processed.eventType) {
      processed.type = processed.eventType;
    }

    // ===================================================================
    // STEP 1: Detect main() entry
    // ===================================================================
    if (!this.mainStarted && processed.function === 'main') {
      this.mainStarted = true;
      this.globalInitPhase = false;
      console.log(`✅ Main entry at step ${index}`);
      
      return {
        ...processed,
        type: 'program_start',
        explanation: '🚀 Program execution started in main()',
        scope: 'main'
      };
    }

    // ===================================================================
    // STEP 2: Filter pre-main steps (except global variable initialization)
    // ===================================================================
    if (!this.mainStarted) {
      if (processed.type === 'var' && this.isGlobalInit(processed)) {
        console.log(`✅ Global variable init: ${processed.name} = ${processed.value}`);
        processed.scope = 'global';
        processed.explanation = `Global variable ${processed.name} initialized to ${processed.value}`;
        this.seenVariables.add(processed.name);
        return processed;
      }
      
      // Filter everything else before main
      console.log(`🔇 Filtered pre-main: ${processed.function || processed.type}`);
      return null;
    }

    // ===================================================================
    // STEP 3: Filter system/library code
    // ===================================================================
    if (this.isSystemCode(processed)) {
      console.log(`🔇 Filtered system code: ${processed.function}`);
      return null;
    }

    // ===================================================================
    // STEP 3b: Check if user source file
    // ===================================================================
    if (!this.isUserSourceFile(processed.file)) {
      console.log(`🔇 Filtered step not in source file: ${processed.file}`);
      return null;
    }

    // ===================================================================
    // STEP 4: Process variable events (var, int, double, etc.)
    // ===================================================================
    if (this.isVariableEvent(processed)) {
      return this.processVariableEvent(processed, index);
    }

    // ===================================================================
    // STEP 5: Process output events (printf, cout)
    // ===================================================================
    if (this.isOutputEvent(processed)) {
      return this.processOutputEvent(processed, index);
    }

    // ===================================================================
    // STEP 6: Process function calls
    // ===================================================================
    if (processed.type === 'func_enter') {
      // Filter internal functions
      if (this.isInternalFunction(processed.function)) {
        return null;
      }
      
      processed.explanation = `Entering function ${processed.function}()`;
      processed.scope = 'local';
      return processed;
    }

    if (processed.type === 'func_exit') {
      if (this.isInternalFunction(processed.function)) {
        return null;
      }
      
      processed.explanation = `Exiting function ${processed.function}()`;
      return processed;
    }

    // ===================================================================
    // STEP 7: Keep heap operations
    // ===================================================================
    if (processed.type === 'heap_alloc' || processed.type === 'heap_free') {
      return processed;
    }

    // ===================================================================
    // STEP 8: Keep program end
    // ===================================================================
    if (processed.type === 'program_end') {
      return processed;
    }

    // ===================================================================
    // STEP 9: Keep loop events (CRITICAL for visualization)
    // ===================================================================
    const loopEventTypes = [
      'loop_start',
      'loop_condition',
      'loop_body_start',
      'loop_iteration_end',
      'loop_end'
    ];
    if (loopEventTypes.includes(processed.type)) {
      console.log(`✅ Keeping loop event: ${processed.type}`);
      return processed;
    }

    // ===================================================================
    // STEP 10: Keep condition evaluation events
    // ===================================================================
    if (processed.type === 'condition_eval' || processed.type === 'condition_evaluation') {
      console.log(`✅ Keeping condition event: ${processed.type}`);
      return processed;
    }

    // ===================================================================
    // STEP 11: Keep input request events (CRITICAL for user input)
    // ===================================================================
    if (processed.type === 'input_request') {
      console.log(`✅ Keeping input request event`);
      return processed;
    }

    // Default: keep other user code events
    if (this.isUserSourceFile(processed.file)) {
      return processed;
    }

    return null;
  }

  /**
   * Process variable event - handles declarations and assignments
   */
  processVariableEvent(step, index) {
    if (!step.name) {
      console.warn(`⚠️ Variable event without name at step ${index}`);
      return null;
    }

    const varName = step.name;
    const isFirstOccurrence = !this.seenVariables.has(varName);
    
    // Determine correct scope
    let scope = 'local';
    if (this.globalInitPhase || step.scope === 'global') {
      scope = 'global';
    }

    // Determine if this is declaration or assignment
    let eventType = 'assignment';
    let explanation = '';

    if (isFirstOccurrence) {
      // First time seeing this variable = declaration
      eventType = 'variable_declaration';
      explanation = `Variable ${varName} declared and initialized to ${step.value}`;
      this.seenVariables.add(varName);
    } else {
      // Subsequent occurrences = assignment
      eventType = 'assignment';
      explanation = `${varName} = ${step.value}`;
    }

    // Get primitive type from step
    const primitiveType = step.varType || step.eventType || this.inferType(step.value);

    return {
      ...step,
      type: eventType,
      scope: scope,
      explanation: explanation,
      primitive: primitiveType,
      isDeclaration: isFirstOccurrence,
      // Preserve original properties for frontend
      originalType: step.type,
      originalEventType: step.eventType || step.type
    };
  }

  /**
   * Process output event - extracts clean output text
   */
  processOutputEvent(step, index) {
    let outputText = '';

    // Extract output from step.stdout or step.value
    if (step.stdout) {
      outputText = step.stdout;
    } else if (step.value) {
      outputText = step.value;
    }

    // Clean output text - remove metadata
    outputText = this.cleanOutputText(outputText);

    if (!outputText || outputText.trim().length === 0) {
      console.log(`🔇 Filtered empty output at step ${index}`);
      return null;
    }

    return {
      type: 'output',
      line: step.line,
      function: step.function || 'unknown',
      file: step.file,
      timestamp: step.timestamp,
      value: outputText,
      stdout: outputText,
      explanation: `📤 Output: ${this.truncateOutput(outputText)}`,
      scope: 'output'
    };
  }

  /**
   * Clean output text - remove variable info, function calls, etc.
   */
  cleanOutputText(text) {
    if (!text) return '';
    
    let cleaned = String(text);

    // Remove common metadata patterns
    cleaned = cleaned
      // Remove function signatures: void func(int x)
      .replace(/\b(void|int|char|float|double|bool)\s+\w+\s*\([^)]*\)/g, '')
      // Remove variable declarations: int x = 5
      .replace(/\b(int|char|float|double|bool|auto)\s+\w+\s*=\s*[^;]+;/g, '')
      // Remove addresses: 0x7fff5fbff8c8
      .replace(/0x[0-9a-fA-F]+/g, '')
      // Remove file:line references: main.cpp:15
      .replace(/\w+\.(cpp|c|h|hpp):\d+/g, '')
      // Remove function entry/exit markers
      .replace(/\b(Entering|Exiting|func_enter|func_exit)\b/g, '')
      // Trim excessive whitespace
      .replace(/\s+/g, ' ')
      .trim();

    return cleaned;
  }

  /**
   * Truncate output for explanation (max 50 chars)
   */
  truncateOutput(text) {
    if (!text) return '';
    const cleaned = text.trim();
    if (cleaned.length <= 50) return cleaned;
    return cleaned.substring(0, 47) + '...';
  }

  /**
   * Check if step is from user source file
   */
  isUserSourceFile(file) {
    if (!file || !this.userSourceFile) return false;
    
    const userBase = this.getBasename(this.userSourceFile);
    const stepBase = this.getBasename(file);
    
    return userBase === stepBase;
  }

  /**
   * Check if step is system/library code
   */
  isSystemCode(step) {
    if (!step.file) return false;
    
    const file = step.file.toLowerCase();
    const func = (step.function || '').toLowerCase();

    // System paths
    const systemPaths = [
      '/usr/', '/lib/', 'libc', 'libstdc++', 
      'mingw', 'include/c++', 'include/bits',
      'stl_', 'iostream', 'ostream', 'streambuf'
    ];

    if (systemPaths.some(path => file.includes(path))) {
      return true;
    }

    // System function prefixes
    const systemPrefixes = [
      '__', '_m_', 'std::__', 'std::basic_',
      '__gnu_cxx', '__cxxabi', '_io_'
    ];

    if (systemPrefixes.some(prefix => func.startsWith(prefix))) {
      return true;
    }

    return false;
  }

  /**
   * Check if function is internal (should be filtered)
   */
  isInternalFunction(funcName) {
    if (!funcName) return false;
    
    const internal = [
      '__', '_M_', 'std::__', 'std::basic_',
      'operator<<', 'operator>>', '__ostream_insert',
      '__gnu_cxx', '__cxxabi', '_IO_'
    ];

    return internal.some(prefix => funcName.includes(prefix));
  }

  /**
   * Check if step is main() entry
   */
  isMainEntry(step) {
    return step.function === 'main' && 
           (step.type === 'func_enter' || step.type === 'program_start');
  }

  /**
   * Check if step is global variable initialization
   */
  isGlobalInit(step) {
    // Global init happens before main and should be preserved
    return step.type === 'var' && !this.mainStarted;
  }

  /**
   * Check if step is a variable event
   */
  isVariableEvent(step) {
    const varTypes = ['var', 'int', 'double', 'float', 'char', 'bool', 'long', 'short'];
    return varTypes.includes(step.type);
  }

  /**
   * Check if step is an output event
   */
  isOutputEvent(step) {
    if (step.type === 'output') return true;
    
    const func = step.function || '';
    const outputFuncs = ['printf', 'puts', 'cout', 'cerr', 'operator<<'];
    
    return outputFuncs.some(f => func.includes(f));
  }

  /**
   * Infer primitive type from value
   */
  inferType(value) {
    if (value === null || value === undefined) return 'unknown';
    
    const type = typeof value;
    
    if (type === 'number') {
      return Number.isInteger(value) ? 'int' : 'double';
    }
    if (type === 'string') return 'string';
    if (type === 'boolean') return 'bool';
    
    return 'unknown';
  }

  /**
   * Get basename from file path
   */
  getBasename(path) {
    if (!path) return '';
    return path.replace(/^.*[\\/]/, '');
  }

  /**
   * Reset filter state
   */
  reset() {
    this.mainStarted = false;
    this.globalInitPhase = true;
    this.userSourceFile = null;
    this.seenVariables.clear();
    this.outputBuffer = '';
    this.lastOutputIndex = 0;
  }
}

// ============================================================================
// BACKEND INTEGRATION
// Update: backend/src/services/instrumentation-tracer.service.js
// ============================================================================

/**
 * Add this to your InstrumentationTracer class in convertToSteps method:
 */
class InstrumentationTracerIntegration {
  async convertToSteps(events, executable, sourceFile, programOutput) {
    console.log(`📊 Converting ${events.length} events to steps...`);

    // ... existing code to create rawSteps ...

    // ===================================================================
    // NEW: Apply enhanced filtering
    // ===================================================================
    const stepFilter = new StepFilterService();
    const filteredSteps = stepFilter.filterAndProcessSteps(
      rawSteps, 
      sourceFile,
      programOutput.stdout
    );

    console.log(`✅ Generated ${filteredSteps.length} clean execution steps`);
    console.log(`🔍 Filtered out ${rawSteps.length - filteredSteps.length} internal steps`);
    
    return filteredSteps;
  }
}

// ============================================================================
// FRONTEND FIX: Accept simple assignments (var = value;)
// Update: frontend/src/hooks/useSocket.ts
// ============================================================================

/**
 * Frontend step processing - handle all assignment types
 */
function processFrontendStep(step) {
  // Clone step immutably
  const processed = JSON.parse(JSON.stringify(step));
  
  // ===================================================================
  // FIX: Accept BOTH simple and compound assignments
  // ===================================================================
  
  // Map backend types to frontend types
  if (processed.originalEventType === 'var' || processed.type === 'var') {
    // Determine if declaration or assignment based on isDeclaration flag
    processed.type = processed.isDeclaration ? 'variable_declaration' : 'assignment';
  }

  // Ensure scope is set correctly
  if (!processed.scope) {
    processed.scope = processed.isGlobal ? 'global' : 'local';
  }

  // Ensure primitive type is set
  if (!processed.primitive && processed.originalEventType) {
    const primitiveTypes = ['int', 'double', 'float', 'char', 'bool', 'long'];
    if (primitiveTypes.includes(processed.originalEventType)) {
      processed.primitive = processed.originalEventType;
    }
  }

  return processed;
}

// ============================================================================
// USAGE EXAMPLE
// ============================================================================

// Backend: In your trace generation
async function generateTrace(code, language) {
  // ... compile and execute code ...
  
  const rawEvents = await parseTraceFile(traceOutput);
  const { stdout, stderr } = programOutput;
  
  // Apply filtering
  const stepFilter = new StepFilterService();
  const steps = stepFilter.filterAndProcessSteps(
    rawEvents,
    sourceFile,
    stdout
  );
  
  return {
    steps,
    totalSteps: steps.length,
    metadata: {
      debugger: 'gcc-instrumentation',
      hasOutputTracking: true,
      filteringApplied: true
    }
  };
}

// Frontend: In your useSocket hook
function handleTraceChunk(chunk) {
  const processedSteps = chunk.steps.map(step => processFrontendStep(step));
  
  // Now all steps are properly categorized:
  // - variable_declaration: int x = 5; (first occurrence)
  // - assignment: x = 10; (subsequent)
  // - assignment: x = y + 3; (compound)
  // - output: clean text only
  // - Correct scope: global vs local
  
  setTrace({ steps: processedSteps });
}

// ============================================================================
// EXPORT
// ============================================================================

export default StepFilterService;
export { processFrontendStep, InstrumentationTracerIntegration };