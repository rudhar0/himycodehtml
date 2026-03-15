/**
 * Socket.io event name constants
 * Keep in sync with frontend constants
 * Updated for Clang + LibTooling
 */

export const SOCKET_EVENTS = {
  // Client → Server
  COMPILER_STATUS_REQUEST: 'compiler:status:request',
  CODE_ANALYZE_SYNTAX: 'code:analyze:syntax',
  CODE_ANALYZE_CHUNK: 'code:analyze:chunk',
  CODE_TRACE_GENERATE: 'code:trace:generate',
  
  EXECUTION_INPUT_PROVIDE: 'execution:input:provide',
  EXECUTION_PAUSE: 'execution:pause',
  EXECUTION_RESUME: 'execution:resume',
  
  // Server → Client
  COMPILER_STATUS: 'compiler:status',
  CODE_SYNTAX_RESULT: 'code:syntax:result',
  CODE_SYNTAX_ERROR: 'code:syntax:error',
  
  CODE_TRACE_PROGRESS: 'code:trace:progress',
  CODE_TRACE_CHUNK: 'code:trace:chunk',
  CODE_TRACE_COMPLETE: 'code:trace:complete',
  CODE_TRACE_ERROR: 'code:trace:error',
  
  EXECUTION_INPUT_RECEIVED: 'execution:input:received',
  EXECUTION_PAUSED: 'execution:paused',
  EXECUTION_RESUMED: 'execution:resumed'
};

export default SOCKET_EVENTS;