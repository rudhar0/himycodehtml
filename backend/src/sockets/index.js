import instrumentationTracer from '../services/instrumentation-tracer.service.js';
import { SOCKET_EVENTS } from '../constants/events.js';
import { sessionRegistry } from './session-registry.js';
import inputRequirementsService from '../services/input-requirements.service.js';
import { handleLSP } from './handlers/lsp.handler.js';

/**
 * Setup Socket.io event handlers with GCC Instrumentation Tracer
 * Industry-standard approach using -finstrument-functions
 */
export function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    const session = sessionRegistry.register(socket);
    handleLSP(socket, io);
    console.log(
      `Client connected: ${socket.id} (clientInstanceId=${session.clientInstanceId || 'n/a'})`,
    );

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
      sessionRegistry.touch(socket.id);
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
        sessionRegistry.touch(socket.id);
        const { code, language = 'cpp', inputs = [] } = data;

        if (!code || !code.trim()) {
          socket.emit(SOCKET_EVENTS.CODE_TRACE_ERROR, {
            message: 'No code provided'
          });
          return;
        }

        console.log(`📝 Trace request: ${language.toUpperCase()}, ${code.length} bytes`);

        // Progress: Starting
        socket.emit(SOCKET_EVENTS.CODE_TRACE_PROGRESS, {
          stage: 'starting',
          progress: 10,
          message: 'Receiving source code...'
        });

        // Progress: Compiling
        socket.emit(SOCKET_EVENTS.CODE_TRACE_PROGRESS, {
          stage: 'compiling',
          progress: 30,
          message: 'Compiling with Clang + tracer injection...'
        });

        // Progress: Executing
        socket.emit(SOCKET_EVENTS.CODE_TRACE_PROGRESS, {
          stage: 'executing',
          progress: 50,
          message: 'Running instrumented binary...'
        });

        const inputAnalysis = inputRequirementsService.analyzeInputRequirements(code, language);
        const normalizedInputs = inputRequirementsService.normalizeProvidedInputs(
          inputs,
          inputAnalysis.requirements
        );
        if (normalizedInputs.warnings.length > 0) {
          console.warn(`[Input] ${normalizedInputs.warnings.join(' | ')}`);
        }

        // Progress: Tracing
        socket.emit(SOCKET_EVENTS.CODE_TRACE_PROGRESS, {
          stage: 'tracing',
          progress: 70,
          message: 'Collecting trace events (FRAME PUSH / POP)...'
        });

        // Generate trace
        const traceResult = await instrumentationTracer.generateTrace(
          code,
          language,
          normalizedInputs.values
        );

        if (!traceResult || !traceResult.steps || traceResult.steps.length === 0) {
          throw new Error('No execution steps generated');
        }

        console.log(`✅ Generated ${traceResult.totalSteps} steps for ${socket.id}`);

        // Progress: Parsing
        socket.emit(SOCKET_EVENTS.CODE_TRACE_PROGRESS, {
          stage: 'parsing',
          progress: 85,
          message: 'Parsing trace → JSON step objects...'
        });

        // Progress: Sending
        socket.emit(SOCKET_EVENTS.CODE_TRACE_PROGRESS, {
          stage: 'sending',
          progress: 95,
          message: 'Sending steps to frontend canvas...'
        });

        // Send trace in single chunk (can be split if needed)
        console.log(`📡 Sending trace to ${socket.id} (${traceResult.steps.length} steps)`);
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
      sessionRegistry.unregister(socket.id, 'disconnect');
      console.log(`Client disconnected: ${socket.id}`);
    });
  });
}

export default setupSocketHandlers;
