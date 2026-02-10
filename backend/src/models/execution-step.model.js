/**
 * ExecutionStep Model
 * Represents a single step in program execution with memory state and animation data
 */

export class ExecutionStep {
  constructor({
    id,
    line,
    type,
    explanation,
    state,
    animation,
    inputRequest = null,
    stdout = ''
  }) {
    this.id = id;
    this.line = line;
    this.type = type;
    this.explanation = explanation;
    this.state = state || {
      globals: [],
      stack: [],
      heap: [],
      pointers: []
    };
    this.animation = animation || null;
    this.inputRequest = inputRequest;
    this.stdout = stdout;
  }
}

/**
 * Step Types
 */
export const StepType = {
  DECLARATION: 'declaration',
  ASSIGNMENT: 'assignment',
  EXPRESSION: 'expression',
  FUNCTION_CALL: 'function_call',
  FUNCTION_RETURN: 'function_return',
  LOOP_START: 'loop_start',
  LOOP_ITERATION: 'loop_iteration',
  LOOP_COMPRESSED: 'loop_compressed',
  LOOP_END: 'loop_end',
  CONDITION_CHECK: 'condition_check',
  BRANCH_TAKEN: 'branch_taken',
  BRANCH_NOT_TAKEN: 'branch_not_taken',
  ARRAY_ACCESS: 'array_access',
  POINTER_DEREF: 'pointer_deref',
  MALLOC: 'malloc',
  FREE: 'free',
  INPUT_REQUEST: 'input_request',
  OUTPUT: 'output',
  PROGRAM_START: 'program_start',
  PROGRAM_END: 'program_end'
};

/**
 * Animation Types
 */
export const AnimationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  HIGHLIGHT: 'highlight',
  ARROW: 'arrow',
  PUSH: 'push',
  POP: 'pop',
  ALLOCATE: 'allocate',
  DEALLOCATE: 'deallocate'
};