/**
 * useSocket Hook - WITH ARRAY SUPPORT
 * 
 * FIXES:
 * 1. Added array event type normalization
 * 2. Added array event handlers in step processing
 * 3. Proper array state tracking
 */

import { useEffect, useState, useCallback } from 'react';
import { socketService, type SocketEventCallback } from '@services/socket.service';
import { useExecutionStore } from '@store/slices/executionSlice';
import { useGCCStore } from '@store/slices/gccSlice';
import toast from 'react-hot-toast';
import { ExecutionTrace, ExecutionStep, Variable } from '@types/index';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const cloneStep = (step: ExecutionStep): ExecutionStep => {
  if (!step) return {} as ExecutionStep;
  
  try {
    const cloned = JSON.parse(JSON.stringify(step));
    
    if ((cloned as any).eventType && !cloned.type) {
      cloned.type = (cloned as any).eventType;
    }
    if ((cloned as any).eventType) {
      (cloned as any).originalEventType = (cloned as any).eventType;
    }
    
    if ((cloned as any).stdout && cloned.type === 'output') {
      cloned.value = (cloned as any).stdout;
    }
    
    return cloned as ExecutionStep;
  } catch (error) {
    console.error('[cloneStep] Failed to clone step:', error, step);
    return {} as ExecutionStep;
  }
};

/**
 * Normalize backend step types including ARRAY EVENTS
 */
const normalizeStepType = (type: string): string => {
  if (!type) return 'line_execution';
  
  const lowerType = type.toLowerCase().trim();
  
  const typeMapping: Record<string, string> = {
    // ===================================================================
    // ARRAY EVENT TYPES (NEW - CRITICAL)
    // ===================================================================
    'array_create': 'array_declaration',
    'array_init': 'array_initialization', 
    'array_index_assign': 'array_assignment',
    
    // ===================================================================
    // INSTRUMENTATION BACKEND TYPES
    // ===================================================================
    'func_enter': 'func_enter',
    'func_exit': 'func_exit',
    'var': 'var',
    'heap_alloc': 'heap_allocation',
    'heap_free': 'heap_free',
    'program_end': 'program_end',
    'program_start': 'program_start',
    'stdout': 'output',
    'print': 'output',
    'declare': 'declare',
    'assign': 'assign',
    
    // LLDB types
    'step_in': 'function_call',
    'step_out': 'function_return',
    'step_over': 'line_execution',
    
    // Semantic types
    'line_execution': 'line_execution',
    'variable_declaration': 'variable_declaration',
    'pointer_declaration': 'variable_declaration',
    'array_declaration': 'array_declaration',
    'assignment': 'assignment',
    'object_creation': 'object_creation',
    'object_destruction': 'object_destruction',
    'function_call': 'function_call',
    'function_return': 'function_return',
    'loop_start': 'loop_start',
    'loop_iteration': 'loop_iteration',
    'loop_end': 'loop_end',
    'conditional_start': 'conditional_start',
    'conditional_branch': 'conditional_branch',
    'array_access': 'array_access',
    'pointer_deref': 'pointer_deref',
    'heap_allocation': 'heap_allocation',
    'output': 'output',
    'input_request': 'input_request',
    
    // Backend primitive types
    'int': 'var',
    'double': 'var',
    'float': 'var',
    'char': 'var',
    'bool': 'var',
    'long': 'var',
    'short': 'var',
    'string': 'var',
    'variable': 'var',
    'variable_assignment': 'assignment',
    'variable_change': 'assignment',
    
    // GDB types
    'next': 'line_execution',
    'step': 'function_call',
    'finish': 'function_return',
  };
  
  const normalized = typeMapping[lowerType];
  if (normalized) {
    return normalized;
  }
  
  console.warn(`[normalizeStepType] Unknown step type: "${type}". Defaulting to "line_execution".`);
  return 'line_execution';
};

const normalizeCallStack = (
  callStack: ExecutionStep['state']['callStack']
): NonNullable<ExecutionStep['state']['callStack']> => {
  if (callStack && Array.isArray(callStack) && callStack.length > 0) {
    return callStack;
  }
  
  return [{
    function: '(global scope)',
    file: 'unknown',
    line: 0,
    locals: {},
  }];
};

const normalizeLocals = (locals: any): Record<string, Variable> => {
  if (!locals) return {};
  
  if (!Array.isArray(locals)) {
    return locals as Record<string, Variable>;
  }
  
  const localsObj: Record<string, Variable> = {};
  (locals as Variable[]).forEach((v: any) => {
    if (v && v.name) {
      localsObj[v.name] = v;
    }
  });
  
  return localsObj;
};

// ============================================================================
// ARRAY TRACKING
// ============================================================================

interface ArrayState {
  name: string;
  baseType: string;
  dimensions: number[];
  values: any[];
  address: string;
  birthStep: number;
  owner: string;
}

// ============================================================================
// MAIN HOOK
// ============================================================================

export function useSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const { setTrace, setAnalysisProgress, setAnalyzing } = useExecutionStore();
  const { setGCCStatus } = useGCCStore();

  const connect = useCallback(async () => {
    if (isConnected || isConnecting) return;
    setIsConnecting(true);
    try {
      await socketService.connect();
      setIsConnected(true);
      toast.success('Connected to server');
      socketService.requestCompilerStatus();
    } catch (error) {
      console.error('Failed to connect:', error);
      toast.error('Failed to connect to server');
      setIsConnected(false);
    } finally {
      setIsConnecting(false);
    }
  }, [isConnected, isConnecting]);

  const disconnect = useCallback(() => {
    socketService.disconnect();
    setIsConnected(false);
    toast.success('Disconnected from server');
  }, []);

  useEffect(() => {
    const handleConnectionState: SocketEventCallback = (data) => 
      setIsConnected(data.connected);
    
    const handleGCCStatus: SocketEventCallback = (data) => 
      setGCCStatus(data);
    
    const handleSyntaxError: SocketEventCallback = (data) => {
      const errorMessage = Array.isArray(data.errors)
        ? data.errors.map((e: any) => (typeof e === 'string' ? e : e.message)).join('; ')
        : data.message || 'Syntax error';
      toast.error(`Error: ${errorMessage}`);
      setAnalyzing(false);
    };
    
    const handleTraceProgress: SocketEventCallback = (data) => {
      console.log(`📊 Progress: ${data.stage} - ${data.progress}%`);
      setAnalysisProgress(data.progress, data.stage);
    };

    let receivedChunks: any[] = [];
    
    const handleTraceChunk: SocketEventCallback = (chunk) => {
      console.log(`📦 Chunk ${chunk.chunkId + 1}/${chunk.totalChunks}: ${chunk.steps?.length || 0} steps`);
      receivedChunks.push(chunk);
    };

    /**
     * CRITICAL HANDLER - WITH ARRAY SUPPORT
     */
    const handleTraceComplete: SocketEventCallback = (data) => {
      console.log(`✅ Trace complete: ${data.totalSteps} total steps`);
      
      try {
        // Collect chunks
        if (receivedChunks.length === 0) {
          if (data && data.steps) {
            receivedChunks.push(data);
          } else {
            throw new Error('No trace data received');
          }
        }

        const allRawSteps: any[] = receivedChunks.flatMap(chunk => chunk.steps || []);

        // Expand internal events
        const expandedSteps: any[] = [];
        allRawSteps.forEach(step => {
            const { internalEvents, ...mainStep } = step;
            expandedSteps.push(mainStep);
            if (internalEvents) {
                internalEvents.forEach((internal: any) => {
                    const expandedStep = { ...mainStep, ...internal };
                    if (expandedStep.type && !expandedStep.eventType) {
                        expandedStep.eventType = expandedStep.type;
                    }
                    expandedSteps.push(expandedStep);
                });
            }
        });

        if (expandedSteps.length === 0) {
          throw new Error('No steps found in received trace data.');
        }

        console.log(`📋 Processing ${expandedSteps.length} raw steps from backend`);

        // ===================================================================
        // PROCESS STEPS WITH ARRAY SUPPORT
        // ===================================================================
        let currentMemoryState: MemoryState = {
            globals: {},
            stack: [],
            heap: {},
            callStack: [],
            stdout: ""
        };
        
        // Track arrays separately
        const arrayRegistry = new Map<string, ArrayState>();
        const variableBirthStepMap = new Map<string, number>();
        const processedSteps: ExecutionStep[] = [];

        expandedSteps.forEach((originalStep: any, index: number) => {
          const step = cloneStep(originalStep);
          const nextMemoryState: MemoryState = JSON.parse(JSON.stringify(currentMemoryState));
          
          const originalType = step.type;
          step.type = normalizeStepType(step.type);

          const functionName = (step.function || "").trim().replace(/\r/g, '');
          
          console.log(`[Step ${index}] Type: ${step.type}, Name: ${step.name || 'N/A'}`);
          
          switch (step.type) {
            case 'func_enter':
              nextMemoryState.callStack.push({
                function: functionName,
                line: step.line,
                locals: {},
              });
              console.log(`✅ Function entered: ${functionName}`);
              break;
              
            case 'func_exit':
              if (nextMemoryState.callStack.length > 0) {
                const exited = nextMemoryState.callStack.pop();
                console.log(`✅ Function exited: ${exited?.function}`);
              }
              break;
              
            // ===================================================================
            // ARRAY DECLARATION
            // ===================================================================
            case 'array_declaration': {
              const arrayName = step.name;
              const baseType = (step as any).baseType || 'int';
              const dimensions = (step as any).dimensions || [1];
              const address = (step as any).address || step.addr;
              
              console.log(`🔲 ARRAY CREATED: ${arrayName}[${dimensions.join('][')}] (${baseType}) @ ${address}`);
              
              // Initialize with default values
              const totalSize = dimensions.reduce((a: number, b: number) => a * b, 1);
              const initialValues = new Array(totalSize).fill(0);
              
              const arrayState: ArrayState = {
                name: arrayName,
                baseType,
                dimensions,
                values: initialValues,
                address,
                birthStep: index,
                owner: functionName || 'main'
              };
              
              arrayRegistry.set(arrayName, arrayState);
              
              // Store array metadata in step
              (step as any).arrayData = arrayState;
              break;
            }
            
            // ===================================================================
            // ARRAY INITIALIZATION
            // ===================================================================
            case 'array_initialization': {
              const arrayName = step.name;
              const values = (step as any).values || [];
              
              console.log(`🔲 ARRAY INITIALIZED: ${arrayName} = [${values.join(',')}]`);
              
              const arrayState = arrayRegistry.get(arrayName);
              if (arrayState) {
                arrayState.values = [...values];
                (step as any).arrayData = arrayState;
              }
              break;
            }
            
            // ===================================================================
            // ARRAY ELEMENT ASSIGNMENT
            // ===================================================================
            case 'array_assignment': {
              const arrayName = step.name;
              const indices = (step as any).indices || [];
              const value = step.value;
              
              console.log(`🔲 ARRAY UPDATED: ${arrayName}[${indices.join('][')}] = ${value}`);
              
              const arrayState = arrayRegistry.get(arrayName);
              if (arrayState) {
                // Convert multi-dimensional index to flat index
                const flatIndex = calculateFlatIndex(indices, arrayState.dimensions);
                if (flatIndex >= 0 && flatIndex < arrayState.values.length) {
                  arrayState.values[flatIndex] = value;
                  (step as any).arrayData = { ...arrayState };
                  (step as any).updatedIndices = [indices];
                }
              }
              break;
            }
            
            // ===================================================================
            // REGULAR VARIABLE
            // ===================================================================
            case 'var': {
              const currentFrame = nextMemoryState.callStack[nextMemoryState.callStack.length - 1];
              const declaredType = (step as any).varType || (step as any).eventType || originalType;
              
              if (currentFrame) {
                const varName = step.name;
                if (varName) {
                  const existingVar = currentFrame.locals[varName];
                  if (!existingVar) {
                    const newVar: Variable = {
                      name: varName,
                      value: step.value,
                      type: declaredType,
                      primitive: declaredType,
                      address: step.addr,
                      scope: 'local',
                      isInitialized: true,
                      isAlive: true,
                      birthStep: index,
                    };
                    currentFrame.locals[varName] = newVar;
                    variableBirthStepMap.set(varName, index);
                  } else {
                    existingVar.value = step.value;
                  }
                }
              } else {
                // Global variable
                const varName = step.name;
                if (varName) {
                  const existingVar = nextMemoryState.globals[varName];
                  if (!existingVar) {
                    const newVar: Variable = {
                      name: varName,
                      value: step.value,
                      type: declaredType,
                      primitive: declaredType,
                      address: step.addr,
                      scope: 'global',
                      isInitialized: true,
                      isAlive: true,
                      birthStep: index,
                    };
                    nextMemoryState.globals[varName] = newVar;
                    variableBirthStepMap.set(varName, index);
                  } else {
                    existingVar.value = step.value;
                  }
                }
              }
              break;
            }
            
            case 'declare': {
              // Handle declare event
              console.log(`📝 Variable declared: ${step.name}`);
              break;
            }
            
            case 'assign': {
              // Handle assign event
              console.log(`📝 Variable assigned: ${step.name} = ${step.value}`);
              break;
            }
            
            case 'output':
              nextMemoryState.stdout = (nextMemoryState.stdout || "") + step.value;
              break;
          }
          
          // Attach current array states to step
          (step as any).arrays = Array.from(arrayRegistry.values());
          
          step.state = nextMemoryState;
          step.id = index;
          if (!step.explanation) {
            step.explanation = `Executing ${step.type} at line ${step.line}`;
          }

          processedSteps.push(step as ExecutionStep);
          currentMemoryState = nextMemoryState;
        });

        // ===================================================================
        // FINAL PROCESSING
        // ===================================================================
        const validSteps = processedSteps.filter(step => step.id !== undefined);

        if (validSteps.length === 0) {
          throw new Error('No valid steps after processing.');
        }

        console.log(`✅ Processed ${validSteps.length} valid steps with ${arrayRegistry.size} arrays`);
        
        const trace: ExecutionTrace = {
          steps: validSteps,
          totalSteps: validSteps.length,
          globals: receivedChunks[0]?.globals || [],
          functions: receivedChunks[0]?.functions || [],
          metadata: { 
            ...receivedChunks[0]?.metadata || {}, 
            debugger: 'instrumentation',
            hasSemanticInfo: true,
            hasArraySupport: true,
            arrayCount: arrayRegistry.size
          },
        };

        setTrace(trace);
        setAnalyzing(false);
        toast.success(`✅ Generated ${validSteps.length} execution steps with ${arrayRegistry.size} arrays`);
        
        receivedChunks = [];

      } catch (error: any) {
        console.error('❌ Failed to process trace:', error);
        toast.error(`Failed to process trace: ${error.message}`);
        setAnalyzing(false);
        receivedChunks = [];
      }
    };

    const handleTraceError: SocketEventCallback = (data) => {
      console.error('❌ Trace error:', data);
      toast.error(`Execution failed: ${data.message || 'Unknown error'}`);
      setAnalyzing(false);
    };

    const handleInputRequired: SocketEventCallback = (data) => {
      console.log('📥 Input required:', data);
    };

    // Subscribe to events
    socketService.on('connection:state', handleConnectionState);
    socketService.on('compiler:status', handleGCCStatus);
    socketService.on('code:syntax:error', handleSyntaxError);
    socketService.on('code:trace:progress', handleTraceProgress);
    socketService.on('code:trace:chunk', handleTraceChunk);
    socketService.on('code:trace:complete', handleTraceComplete);
    socketService.on('code:trace:error', handleTraceError);
    socketService.on('execution:input_required', handleInputRequired);

    return () => {
      socketService.off('connection:state', handleConnectionState);
      socketService.off('compiler:status', handleGCCStatus);
      socketService.off('code:syntax:error', handleSyntaxError);
      socketService.off('code:trace:progress', handleTraceProgress);
      socketService.off('code:trace:chunk', handleTraceChunk);
      socketService.off('code:trace:complete', handleTraceComplete);
      socketService.off('code:trace:error', handleTraceError);
      socketService.off('execution:input_required', handleInputRequired);
    };
  }, [setTrace, setAnalyzing, setAnalysisProgress, setGCCStatus]);

  const generateTrace = useCallback((code: string, language: string) => {
    if (!isConnected) {
      toast.error('Not connected to server');
      return;
    }
    console.log('🚀 Requesting trace generation...');
    setAnalyzing(true);
    socketService.generateTrace(code, language);
  }, [isConnected, setAnalyzing]);

  const requestGCCStatus = useCallback(() => {
    if (!isConnected) return;
    socketService.requestCompilerStatus();
  }, [isConnected]);

  return {
    isConnected,
    isConnecting,
    connect,
    disconnect,
    generateTrace,
    requestGCCStatus,
  };
}

// ============================================================================
// HELPER: CALCULATE FLAT INDEX
// ============================================================================
function calculateFlatIndex(indices: number[], dimensions: number[]): number {
  if (indices.length === 1) {
    return indices[0];
  }
  if (indices.length === 2) {
    const [i, j] = indices;
    return i * dimensions[1] + j;
  }
  if (indices.length === 3) {
    const [i, j, k] = indices;
    return i * dimensions[1] * dimensions[2] + j * dimensions[2] + k;
  }
  return indices[0];
}

export default useSocket;