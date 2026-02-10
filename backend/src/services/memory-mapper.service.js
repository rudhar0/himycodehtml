import logger from '../utils/logger.js';

class MemoryMapperService {
  /**
   * Transforms raw GDB data into the structured `MemoryState` the frontend expects.
   * @param {Array} gdbVariables - Variables from GDB's `-stack-list-variables`.
   * @param {Array} gdbStack - Stack frames from GDB's `-stack-list-frames`.
   * @returns {object} A `MemoryState` object.
   */
  createMemoryState(gdbVariables, gdbStack) {
    const locals = {};
    gdbVariables.forEach(v => {
        locals[v.name] = {
            name: v.name,
            value: v.value,
            type: v.type,
            address: v.addr || '0x0',
            scope: 'local',
        }
    });
    const { stack, callStack } = this.createStackAndCallStack(gdbStack, locals);

    return {
      globals: {},
      stack,
      heap: {},
      callStack,
    };
  }

  /**
   * Creates a MemoryState object from DAP data.
   * @param {Array} dapStackFrames - Stack frames from DAP.
   * @param {Array} dapVariables - An array of variable arrays from DAP (one per scope).
   * @returns {object} A `MemoryState` object.
   */
  async createStateFromDAP(dapStackFrames, variablesByFrame, dapController) {
    const { stack, callStack } = await this.createStackAndCallStack(dapStackFrames, variablesByFrame, dapController);

    return {
      globals: {}, // Globals can be populated from a 'Globals' scope if available
      stack,
      heap: {}, // Heap can be populated by following pointers
      callStack,
    };
  }

  async createStackAndCallStack(frames, variablesByFrame, dapController) {
    const stack = [];
    const callStack = [];

    if (!frames) {
      return { stack, callStack };
    }

    for (const [index, frame] of frames.entries()) {
      const frameId = frame.id || frame.level;
      const functionName = frame.name || frame.func || 'unknown';
      const frameVariables = variablesByFrame[frameId] || [];
      const frameLocals = await this.processVariables(frameVariables, frameId, dapController, frameId);
      
      const stackFrame = {
        frameId,
        function: functionName,
        returnType: '?',
        locals: frameLocals,
        returnAddress: frame.addr || '0x0',
      };
      stack.push(stackFrame);

      const callFrame = {
        function: functionName,
        returnType: '?',
        params: {}, // We can try to distinguish params from locals if scope name is available
        locals: frameLocals,
        frameId,
        returnAddress: frame.addr || '0x0',
        isActive: index === 0,
      };
      callStack.push(callFrame);
    }

    return { stack, callStack };
  }

  async processVariables(dapVariables, parentId, dapController, frameId) {
    const result = {};
    if (!dapVariables) return result;

    for (const v of dapVariables) {
      const uniqueId = `${parentId}:${v.name}`;
      const variable = {
        uniqueId,
        name: v.name,
        type: v.type,
        value: v.value,
        address: v.memoryReference || `ref:${v.variablesReference}`,
        scope: 'local', // Or determined from scope
        isInitialized: true,
        isAlive: true,
        children: v.children && Object.keys(v.children).length > 0 ? await this.processVariables(v.children, uniqueId, dapController, frameId) : {},
      };

      if (v.type && v.type.includes('*') && v.value !== '0x0' && v.value !== 'nullptr') {
        try {
          const evaluation = await dapController.evaluate(`*(${v.name})`, frameId);
          variable.pointsTo = {
            value: evaluation.result,
            type: evaluation.type,
            variablesReference: evaluation.variablesReference,
          };
        } catch (error) {
          logger.warn({ err: error, var: v.name, frameId }, 'Failed to evaluate pointer');
          variable.pointsTo = { value: 'Error dereferencing pointer' };
        }
      }

      result[v.name] = variable;
    }

    return result;
  }
}

const memoryMapperService = new MemoryMapperService();
export default memoryMapperService;
