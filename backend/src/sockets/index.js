import instrumentationTracer from '../services/instrumentation-tracer.service.js';
import { SOCKET_EVENTS } from '../constants/events.js';

/**
 * Setup Socket.io event handlers with GCC Instrumentation Tracer
 * Industry-standard approach using -finstrument-functions
 */
export function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    // Send initial status
    socket.emit(SOCKET_EVENTS.COMPILER_STATUS, {
      compiler: 'gcc-instrumentation',
      available: true,
      ready: true,
      features: [
        'Real memory addresses',
        'Heap tracking (new/delete)',
        'Function call tracing',
        'Full C++17 support',
        'Templates, classes, inheritance'
      ],
      message: 'GCC Instrumentation Tracer ready'
    });

    /**
     * Request Compiler status
     */
    socket.on(SOCKET_EVENTS.COMPILER_STATUS_REQUEST, () => {
      socket.emit(SOCKET_EVENTS.COMPILER_STATUS, {
        compiler: 'gcc-instrumentation',
        available: true,
        ready: true,
        message: 'GCC Instrumentation Tracer ready'
      });
    });

    /**
     * Generate execution trace using GCC Instrumentation
     */
    socket.on(SOCKET_EVENTS.CODE_TRACE_GENERATE, async (data) => {
      try {
        const { code, language = 'cpp' } = data;

        if (!code || !code.trim()) {
          socket.emit(SOCKET_EVENTS.CODE_TRACE_ERROR, {
            message: 'No code provided'
          });
          return;
        }

        console.log(`📝 Trace request: ${language.toUpperCase()}, ${code.length} bytes`);

        // Progress: Compiling
        socket.emit(SOCKET_EVENTS.CODE_TRACE_PROGRESS, {
          stage: 'compiling',
          progress: 20,
          message: 'Compiling with GCC instrumentation...'
        });

        // Progress: Executing
        socket.emit(SOCKET_EVENTS.CODE_TRACE_PROGRESS, {
          stage: 'executing',
          progress: 50,
          message: 'Executing instrumented binary...'
        });

        // Progress: Analyzing
        socket.emit(SOCKET_EVENTS.CODE_TRACE_PROGRESS, {
          stage: 'analyzing',
          progress: 70,
          message: 'Analyzing execution trace...'
        });

        // Generate trace
        const traceResult = await instrumentationTracer.generateTrace(code, language);

        if (!traceResult || !traceResult.steps || traceResult.steps.length === 0) {
          throw new Error('No execution steps generated');
        }

        console.log(`✅ Generated ${traceResult.totalSteps} steps for ${socket.id}`);

        // Progress: Formatting
        socket.emit(SOCKET_EVENTS.CODE_TRACE_PROGRESS, {
          stage: 'formatting',
          progress: 90,
          message: 'Formatting trace data...'
        });

        // Send trace in single chunk (can be split if needed)
        console.log('Backend traceResult:', JSON.stringify(traceResult, null, 2));
        socket.emit(SOCKET_EVENTS.CODE_TRACE_CHUNK, {
          chunkId: 0,
          totalChunks: 1,
          steps: traceResult.steps,
          totalSteps: traceResult.totalSteps,
          globals: traceResult.globals || [],
          functions: traceResult.functions || [],
          metadata: {
            ...traceResult.metadata,
            socketId: socket.id,
            timestamp: Date.now()
          }
        });

        // Send completion
        socket.emit(SOCKET_EVENTS.CODE_TRACE_COMPLETE, {
          totalChunks: 1,
          totalSteps: traceResult.totalSteps,
          success: true,
          message: 'Trace generation complete'
        });

        console.log(`✅ Trace sent successfully to ${socket.id}`);

      } catch (error) {
        console.error('❌ Trace generation error:', error);
        
        socket.emit(SOCKET_EVENTS.CODE_TRACE_ERROR, {
          message: error.message || 'Failed to generate trace',
          details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
      }
    });

    /**
     * Disconnect handler
     */
    socket.on('disconnect', () => {
      console.log(`🔌 Client disconnected: ${socket.id}`);
    });
  });
}

export default setupSocketHandlers;