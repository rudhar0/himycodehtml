/**
 * Trace Compression Middleware
 * Reduces execution trace size before sending to frontend
 * Implements chunking for large traces
 */

import { LIMITS } from '../constants/limits.js';

class TraceCompressor {
  /**
   * Compress execution trace to reduce data size
   */
  compressTrace(trace) {
    try {
      console.log('compressTrace called with:', {
        isArray: Array.isArray(trace),
        type: typeof trace,
        hasSteps: trace?.steps !== undefined,
        length: Array.isArray(trace) ? trace.length : trace?.steps?.length
      });
      
      const steps = Array.isArray(trace) ? trace : (trace?.steps || []);
      const globals = Array.isArray(trace) ? [] : (trace?.globals || []);
      
      console.log('Extracted:', {
        stepsCount: steps.length,
        globalsCount: globals.length,
        stepsIsArray: Array.isArray(steps),
        globalsIsArray: Array.isArray(globals)
      });
      
      const compressed = {
        steps: this.compressSteps(steps),
        totalSteps: steps.length,
        globals: this.compressVariables(globals),
        functions: Array.isArray(trace) ? [] : (trace?.functions || []),
        metadata: {
          compressed: true,
          originalSize: this.estimateSize(trace),
          timestamp: Date.now()
        }
      };

      compressed.metadata.compressedSize = this.estimateSize(compressed);
      compressed.metadata.compressionRatio = 
        (compressed.metadata.compressedSize / compressed.metadata.originalSize * 100).toFixed(2) + '%';

      return compressed;
    } catch (error) {
      console.error('compressTrace error:', error);
      console.error('Trace input:', JSON.stringify(trace, null, 2).substring(0, 500));
      throw error;
    }
  }

  /**
   * Compress individual execution steps
   */
  compressSteps(steps) {
    if (!Array.isArray(steps)) {
      console.error('compressSteps: steps is not an array:', typeof steps);
      return [];
    }
    
    return steps.map((step, index) => {
      if (!step || typeof step !== 'object') {
        console.error(`compressSteps: Invalid step at index ${index}:`, step);
        return null;
      }
      
      const compressed = {
        id: step.id ?? index,
        type: step.type || 'unknown',
        line: step.line || 0,
        explanation: step.explanation || '',
        
        // Only include state diff instead of full state
        stateDiff: index > 0 ? this.calculateStateDiff(steps[index - 1]?.state, step.state) : (step.state || {}),
        
        // Compress animation config
        animation: this.compressAnimation(step.animation),
        
        // Keep critical flags
        ...(step.pauseExecution && { pauseExecution: true }),
        ...(step.inputRequest && { inputRequest: step.inputRequest })
      };

      return compressed;
    }).filter(step => step !== null);
  }

  /**
   * Calculate diff between two states
   * Only send what changed
   */
  calculateStateDiff(prevState, currentState) {
    if (!prevState) return currentState;
    if (!currentState) return null;

    const diff = {};

    // Check globals
    const globalsDiff = this.diffObjects(prevState.globals, currentState.globals);
    if (Object.keys(globalsDiff).length > 0) {
      diff.globals = globalsDiff;
    }

    // Check stack (handle arrays and undefined)
    const prevStack = prevState.stack || [];
    const currStack = currentState.stack || [];
    if (JSON.stringify(prevStack) !== JSON.stringify(currStack)) {
      diff.stack = currStack;
    }

    // Check heap
    const heapDiff = this.diffObjects(prevState.heap, currentState.heap);
    if (Object.keys(heapDiff).length > 0) {
      diff.heap = heapDiff;
    }

    // Check call stack (handle arrays and undefined)
    const prevCallStack = prevState.callStack || [];
    const currCallStack = currentState.callStack || [];
    if (JSON.stringify(prevCallStack) !== JSON.stringify(currCallStack)) {
      diff.callStack = currCallStack;
    }

    return Object.keys(diff).length > 0 ? diff : null;
  }

  /**
   * Diff two objects
   */
  diffObjects(obj1, obj2) {
    const diff = {};
    
    if (!obj1) obj1 = {};
    if (!obj2) obj2 = {};

    // Check for changes and additions
    for (const key in obj2) {
      if (JSON.stringify(obj1[key]) !== JSON.stringify(obj2[key])) {
        diff[key] = obj2[key];
      }
    }

    // Mark deletions
    for (const key in obj1) {
      if (!(key in obj2)) {
        diff[key] = null; // null indicates deletion
      }
    }

    return diff;
  }

  /**
   * Compress animation config
   */
  compressAnimation(animation) {
    if (!animation) return null;

    // Remove redundant data
    const compressed = {
      t: animation.type,
      tg: animation.target,
      d: animation.duration || 500
    };

    // Only include optional fields if present
    if (animation.effect) compressed.e = animation.effect;
    if (animation.element) compressed.el = animation.element;
    if (animation.frameId) compressed.fid = animation.frameId;
    if (animation.from !== undefined) compressed.f = animation.from;
    if (animation.to !== undefined) compressed.to = animation.to;

    return compressed;
  }

  /**
   * Compress variable list
   */
  compressVariables(variables) {
    if (!Array.isArray(variables)) {
      console.error('compressVariables: variables is not an array:', typeof variables, variables);
      return [];
    }
    
    return variables.map((v, index) => {
      if (!v || typeof v !== 'object') {
        console.warn(`compressVariables: Invalid variable at index ${index}:`, v);
        return null;
      }
      
      return {
        n: v.name,
        t: v.type,
        v: v.value,
        a: v.address,
        s: v.scope,
        ...(v.birthStep !== undefined && { b: v.birthStep }),
        ...(v.deathStep !== undefined && { d: v.deathStep })
      };
    }).filter(v => v !== null);
  }

  /**
   * Split trace into chunks for transmission
   */
  chunkTrace(trace, chunkSize = LIMITS.TRACE_CHUNK_SIZE) {
    const compressed = this.compressTrace(trace);
    const steps = compressed.steps;
    const chunks = [];

    // Calculate number of chunks needed
    const numChunks = Math.ceil(steps.length / chunkSize);

    for (let i = 0; i < numChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, steps.length);

      chunks.push({
        chunkId: i,
        totalChunks: numChunks,
        steps: steps.slice(start, end),
        
        // Include metadata only in first chunk
        ...(i === 0 && {
          totalSteps: compressed.totalSteps,
          globals: compressed.globals,
          functions: compressed.functions,
          metadata: compressed.metadata
        })
      });
    }

    return chunks;
  }

  /**
   * Estimate data size in bytes
   */
  estimateSize(data) {
    return new Blob([JSON.stringify(data)]).size;
  }

  /**
   * Decompress trace on frontend (utility function)
   * Frontend will use this to reconstruct full states
   */
  static decompressOnFrontend(compressedSteps, initialState) {
    const fullSteps = [];
    let currentState = initialState;

    for (const step of compressedSteps) {
      // Reconstruct full state from diff
      if (step.stateDiff) {
        currentState = this.applyStateDiff(currentState, step.stateDiff);
      }

      fullSteps.push({
        ...step,
        state: JSON.parse(JSON.stringify(currentState)), // Deep clone
        animation: this.decompressAnimation(step.animation)
      });
    }

    return fullSteps;
  }

  /**
   * Apply state diff to reconstruct full state
   */
  static applyStateDiff(currentState, diff) {
    const newState = JSON.parse(JSON.stringify(currentState)); // Deep clone

    if (diff.globals) {
      newState.globals = { ...newState.globals, ...diff.globals };
      // Remove null entries (deletions)
      for (const key in diff.globals) {
        if (diff.globals[key] === null) {
          delete newState.globals[key];
        }
      }
    }

    if (diff.stack) {
      newState.stack = diff.stack;
    }

    if (diff.heap) {
      newState.heap = { ...newState.heap, ...diff.heap };
      for (const key in diff.heap) {
        if (diff.heap[key] === null) {
          delete newState.heap[key];
        }
      }
    }

    if (diff.callStack) {
      newState.callStack = diff.callStack;
    }

    return newState;
  }

  /**
   * Decompress animation config
   */
  static decompressAnimation(compressed) {
    if (!compressed) return null;

    return {
      type: compressed.t,
      target: compressed.tg,
      duration: compressed.d,
      ...(compressed.e && { effect: compressed.e }),
      ...(compressed.el && { element: compressed.el }),
      ...(compressed.fid && { frameId: compressed.fid }),
      ...(compressed.f !== undefined && { from: compressed.f }),
      ...(compressed.to !== undefined && { to: compressed.to })
    };
  }
}

export const traceCompressor = new TraceCompressor();