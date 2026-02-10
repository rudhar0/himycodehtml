import { useEffect } from 'react';
import { socketService } from '../api/socket.service';
import { useExecutionStore } from '../store/slices/executionSlice';
import { ExecutionTrace, SocketIOError } from '../types';
import { SOCKET_EVENTS } from '../constants/events';

export const useExecutionTrace = () => {
  const {
    setTrace,
    clearTrace,
    setAnalyzing,
    setAnalysisProgress,
    startAnalysis,
    executionTrace,
    getCurrentStep
  } = useExecutionStore();

  useEffect(() => {
    const handleTraceProgress = (data: { progress: number; stage: string }) => {
      console.log(`Frontend: Analysis progress: ${data.stage} (${data.progress}%)`);
      setAnalysisProgress(data.progress, data.stage);
    };

    const handleTraceChunk = (trace: ExecutionTrace) => {
      console.log('Frontend: Received execution trace chunk', trace);
      // Normalize steps to ensure locals is a record and populate birthStep when missing.
      if (trace.steps && Array.isArray(trace.steps)) {
        // Ensure locals are objects and collect first-seen birthStep per variable
        const seenLocals = new Set<string>();
        const seenGlobals = new Set<string>();

        trace.steps.forEach((step) => {
          try {
            // Normalize callStack locals
            if (step.state && step.state.callStack && step.state.callStack.length > 0) {
              const frame = step.state.callStack[0];
              if (Array.isArray(frame.locals)) {
                const localsObj: Record<string, any> = {};
                frame.locals.forEach((v: any) => { localsObj[v.name] = v; });
                frame.locals = localsObj;
              }

              if (frame.locals && typeof frame.locals === 'object') {
                Object.keys(frame.locals).forEach((name) => {
                  const v = frame.locals[name];
                  if (!seenLocals.has(name)) {
                    // mark first-seen step as birthStep if backend didn't provide one
                    if (v && v.birthStep === undefined) {
                      v.birthStep = step.id;
                    }
                    seenLocals.add(name);
                  }
                });
              }
            }

            // Normalize globals
            if (step.state && step.state.globals && typeof step.state.globals === 'object') {
              const globals = step.state.globals;
              Object.keys(globals).forEach((gname) => {
                const gv = globals[gname];
                if (!seenGlobals.has(gname)) {
                  if (gv && gv.birthStep === undefined) {
                    gv.birthStep = step.id;
                  }
                  seenGlobals.add(gname);
                }
              });
            }
          } catch (e) {
            // ignore normalization errors
          }
        });
      }

      if (trace.steps && trace.steps.length > 2) {
        setTrace(trace);
      } else {
        // Handle gracefully the case with very few steps, which indicates an issue.
        console.error('Frontend: Received trace with insufficient steps, indicating a possible compilation or runtime error.');
        clearTrace();
        setAnalyzing(false);
        // Display an error message to the user
        // This part needs a UI component to show the error. For now, we log it.
        alert('Failed to generate a valid execution trace. The code may have issues or not produce any executable steps.');
      }
    };

    const handleTraceComplete = (data: { totalSteps: number }) => {
      console.log(`Frontend: Trace generation complete. Total steps: ${data.totalSteps}`);
      setAnalysisProgress(100, 'complete');
      setAnalyzing(false);
    };

    const handleTraceError = (error: SocketIOError) => {
      console.error('Frontend: Execution Error', error);
      clearTrace();
      setAnalyzing(false);
      // Optionally display error message to user
      alert(`An error occurred during trace generation: ${error.message}`);
    };

    // Subscribe to events
    socketService.on(SOCKET_EVENTS.CODE_TRACE_PROGRESS, handleTraceProgress);
    socketService.on(SOCKET_EVENTS.CODE_TRACE_CHUNK, handleTraceChunk);
    socketService.on(SOCKET_EVENTS.CODE_TRACE_COMPLETE, handleTraceComplete);
    socketService.on(SOCKET_EVENTS.CODE_TRACE_ERROR, handleTraceError);

    // No need for startAnalysis here, it is triggered by UI interaction

    // Cleanup on unmount
    return () => {
      socketService.off(SOCKET_EVENTS.CODE_TRACE_PROGRESS, handleTraceProgress);
      socketService.off(SOCKET_EVENTS.CODE_TRACE_CHUNK, handleTraceChunk);
      socketService.off(SOCKET_EVENTS.CODE_TRACE_COMPLETE, handleTraceComplete);
      socketService.off(SOCKET_EVENTS.CODE_TRACE_ERROR, handleTraceError);
    };
  }, [setTrace, clearTrace, setAnalyzing, setAnalysisProgress, startAnalysis]);

  return {
    executionTrace,
    currentStep: getCurrentStep(),
  };
};
