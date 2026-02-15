/**
 * useSocket Hook — Refactored
 *
 * Delegates all trace processing to the engine's TraceProcessor.
 * This hook only handles:
 *   1. Socket connection lifecycle
 *   2. Event subscriptions
 *   3. UI feedback (toasts)
 */

import { useEffect, useState, useCallback } from 'react';
import { socketService, type SocketEventCallback } from '../api/socket.service';
import { useExecutionStore } from '@store/slices/executionSlice';
import { useGCCStore } from '@store/slices/gccSlice';
import toast from 'react-hot-toast';
import { processRawTrace, MAX_TRACE_STEPS } from '../engine/traceProcessor';

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
      setAnalysisProgress(data.progress, data.stage);
    };

    let receivedChunks: any[] = [];

    const handleTraceChunk: SocketEventCallback = (chunk) => {
      receivedChunks.push(chunk);
    };

    /**
     * Trace complete — delegates to engine/traceProcessor.processRawTrace()
     */
    const handleTraceComplete: SocketEventCallback = (data) => {
      try {
        // Collect chunks
        if (receivedChunks.length === 0) {
          if (data && data.steps) {
            receivedChunks.push(data);
          } else {
            throw new Error('No trace data received');
          }
        }

        // ── Delegate to TraceProcessor ──
        const { trace, arrayRegistry } = processRawTrace(
          receivedChunks,
          MAX_TRACE_STEPS,
        );

        setTrace(trace);
        setAnalyzing(false);
        toast.success(
          `✅ Generated ${trace.totalSteps} execution steps` +
            (arrayRegistry.size > 0 ? ` with ${arrayRegistry.size} arrays` : ''),
        );

        receivedChunks = [];
      } catch (error: any) {
        console.error('Failed to process trace:', error);
        toast.error(`Failed to process trace: ${error.message}`);
        setAnalyzing(false);
        receivedChunks = [];
      }
    };

    const handleTraceError: SocketEventCallback = (data) => {
      console.error('Trace error:', data);
      toast.error(`Execution failed: ${data.message || 'Unknown error'}`);
      setAnalyzing(false);
    };

    const handleInputRequired: SocketEventCallback = (_data) => {
      // Input handling is done in VisualizationCanvas.tsx
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
    setAnalyzing(true);
    socketService.generateTrace(code, language);
  }, [isConnected, setAnalyzing]);

  const requestGCCStatus = useCallback(() => {
    if (!isConnected) return;
    socketService.requestCompilerStatus();
  }, [isConnected]);

  const provideInput = useCallback((input: string) => {
    if (!isConnected) {
      toast.error('Not connected to server');
      return;
    }
    socketService.emit('send_input', { input });
  }, [isConnected]);

  return {
    isConnected,
    isConnecting,
    connect,
    disconnect,
    generateTrace,
    requestGCCStatus,
    provideInput,
  };
}

export default useSocket;