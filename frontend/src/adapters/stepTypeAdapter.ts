// frontend/src/adapters/stepTypeAdapter.ts
/**
 * Step Type Adapter - Maps new backend step types to frontend animation actions
 * 
 * COMPATIBILITY LAYER - DO NOT DELETE
 * This ensures new backend steps trigger existing animations
 */

export type BackendStepType = 
  | 'program_start'
  | 'program_end'
  | 'func_enter'
  | 'func_exit'
  | 'var'
  | 'heap_alloc'
  | 'heap_free'
  | 'function_call'
  | 'function_return'
  | 'variable_assignment'
  | 'variable_change'
  | 'variable_declaration'
  | 'condition_evaluation'
  | 'loop_iteration'
  | 'loop_start'
  | 'loop_end'
  | 'heap_allocation'
  | 'heap_deallocation'
  | 'output'
  | 'input_request'
  | 'line_execution';

export type FrontendAnimationAction = 
  | 'animateFunctionEnter'
  | 'animateFunctionExit'
  | 'animateVariableCreate'
  | 'animateVariableUpdate'
  | 'animateConditionCheck'
  | 'animateLoopPulse'
  | 'animateHeapAlloc'
  | 'animateHeapFree'
  | 'animateOutput'
  | 'animateInput'
  | 'animateLineExecution'
  | 'noAnimation';

/**
 * Core mapping table - Backend type → Frontend animation action
 */
const STEP_TYPE_MAPPING: Record<BackendStepType, FrontendAnimationAction> = {
  // Program lifecycle
  'program_start': 'noAnimation',
  'program_end': 'noAnimation',
  
  // Function calls (NEW backend format)
  'func_enter': 'animateFunctionEnter',
  'func_exit': 'animateFunctionExit',
  
  // Function calls (LEGACY support)
  'function_call': 'animateFunctionEnter',
  'function_return': 'animateFunctionExit',
  
  // Variables (NEW backend format)
  'var': 'animateVariableUpdate',
  
  // Variables (LEGACY support)
  'variable_assignment': 'animateVariableUpdate',
  'variable_change': 'animateVariableUpdate',
  'variable_declaration': 'animateVariableCreate',
  
  // Heap (NEW backend format)
  'heap_alloc': 'animateHeapAlloc',
  'heap_free': 'animateHeapFree',
  
  // Heap (LEGACY support)
  'heap_allocation': 'animateHeapAlloc',
  'heap_deallocation': 'animateHeapFree',
  
  // Control flow (NEW backend format)
  'condition_evaluation': 'animateConditionCheck',
  'loop_iteration': 'animateLoopPulse',
  
  // Control flow (LEGACY support)
  'loop_start': 'animateLoopPulse',
  'loop_end': 'animateLoopPulse',
  
  // I/O
  'output': 'animateOutput',
  'input_request': 'animateInput',
  
  // Generic fallback
  'line_execution': 'animateLineExecution',
};

/**
 * Get animation action for a backend step type
 */
export function getAnimationAction(stepType: string): FrontendAnimationAction {
  const normalizedType = stepType as BackendStepType;
  return STEP_TYPE_MAPPING[normalizedType] || 'animateLineExecution';
}

/**
 * Check if step should trigger animation
 */
export function shouldAnimate(stepType: string): boolean {
  const action = getAnimationAction(stepType);
  return action !== 'noAnimation';
}

/**
 * Extract condition result from explanation (TRUE/FALSE)
 * Used for condition_evaluation steps
 */
export function extractConditionResult(explanation: string): boolean | null {
  const lowerExp = explanation.toLowerCase();
  
  // Look for explicit TRUE/FALSE
  if (lowerExp.includes('true') || lowerExp.includes('evaluates to true')) {
    return true;
  }
  if (lowerExp.includes('false') || lowerExp.includes('evaluates to false')) {
    return false;
  }
  
  // Look for comparison results
  const truePatterns = ['condition met', 'branch taken', 'is true'];
  const falsePatterns = ['condition not met', 'branch skipped', 'is false'];
  
  for (const pattern of truePatterns) {
    if (lowerExp.includes(pattern)) return true;
  }
  
  for (const pattern of falsePatterns) {
    if (lowerExp.includes(pattern)) return false;
  }
  
  return null; // Unknown
}

/**
 * Extract loop iteration count from explanation
 * Used for loop_iteration steps
 */
export function extractLoopIteration(explanation: string): number | null {
  // Match patterns like "iteration 5", "loop count: 3", etc.
  const patterns = [
    /iteration\s+(\d+)/i,
    /loop\s+count:\s*(\d+)/i,
    /\((\d+)\/\d+\)/,  // (5/10) format
  ];
  
  for (const pattern of patterns) {
    const match = explanation.match(pattern);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }
  }
  
  return null;
}

/**
 * Detect if step is cout/printf output (should NOT animate separately)
 */
export function isOutputStep(step: any): boolean {
  if (step.type === 'output') return true;
  
  const exp = step.explanation?.toLowerCase() || '';
  return exp.includes('cout') || 
         exp.includes('printf') || 
         exp.includes('puts') ||
         exp.includes('std::cout');
}

/**
 * Detect if step is cin/scanf input (should PAUSE animation)
 */
export function isInputStep(step: any): boolean {
  if (step.type === 'input_request') return true;
  
  const exp = step.explanation?.toLowerCase() || '';
  return exp.includes('cin') || 
         exp.includes('scanf') || 
         exp.includes('waiting for input');
}

/**
 * Get animation metadata for a step
 */
export interface AnimationMetadata {
  action: FrontendAnimationAction;
  shouldAnimate: boolean;
  conditionResult?: boolean | null;
  loopIteration?: number | null;
  isOutput: boolean;
  isInput: boolean;
  requiresPause: boolean;
}

export function getAnimationMetadata(step: any): AnimationMetadata {
  const action = getAnimationAction(step.type);
  const metadata: AnimationMetadata = {
    action,
    shouldAnimate: shouldAnimate(step.type),
    isOutput: isOutputStep(step),
    isInput: isInputStep(step),
    requiresPause: isInputStep(step),
  };
  
  // Extract condition result for condition steps
  if (action === 'animateConditionCheck') {
    metadata.conditionResult = extractConditionResult(step.explanation);
  }
  
  // Extract iteration for loop steps
  if (action === 'animateLoopPulse') {
    metadata.loopIteration = extractLoopIteration(step.explanation);
  }
  
  return metadata;
}