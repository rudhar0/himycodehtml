// frontend/src/socket/executionStructure.socket.ts
// ============================================================
// ExecutionStructure Socket Listener
//
// ISOLATED: Listens ONLY for the new execution:structure:graph
// socket event. Does NOT touch the existing trace socket events.
// ============================================================

import { ExecutionStructureStore } from '../engine/executionStructureBuilder';
import type { ExecutionGraph } from '../engine/executionStructureBuilder';

// ---------------------------------------------------------------------------
// Event constant — must match backend constants/events.js
// ---------------------------------------------------------------------------
export const EXECUTION_STRUCTURE_GRAPH_EVENT = 'execution:structure:graph';

// ---------------------------------------------------------------------------
// Payload type
// ---------------------------------------------------------------------------
interface ExecutionStructureGraphPayload {
  graph: ExecutionGraph;
}

// ---------------------------------------------------------------------------
// Register listener on a socket instance
// ---------------------------------------------------------------------------

/**
 * Register the execution structure graph listener on a socket.
 *
 * Call this once after your socket is connected, alongside your
 * existing trace event listeners, e.g.:
 *
 *   registerExecutionStructureListener(socket);
 *
 * @param socket - Any socket.io-compatible socket instance.
 */
export function registerExecutionStructureListener(socket: any): void {
  if (!socket) {
    console.warn('[ESB Socket] No socket provided — listener not registered');
    return;
  }

  socket.on(
    EXECUTION_STRUCTURE_GRAPH_EVENT,
    (payload: ExecutionStructureGraphPayload) => {
      if (!payload || !payload.graph) {
        console.warn('[ESB Socket] Received empty execution structure payload');
        return;
      }

      try {
        ExecutionStructureStore.load(payload.graph);
        console.log('[ESB Socket] Graph loaded into store successfully');
      } catch (err) {
        console.error('[ESB Socket] Failed to load graph:', err);
      }
    }
  );

  console.log('[ESB Socket] Registered listener for:', EXECUTION_STRUCTURE_GRAPH_EVENT);
}

/**
 * Unregister the listener (call on cleanup / socket disconnect).
 */
export function unregisterExecutionStructureListener(socket: any): void {
  if (!socket) return;
  socket.off(EXECUTION_STRUCTURE_GRAPH_EVENT);
  ExecutionStructureStore.clear();
  console.log('[ESB Socket] Listener unregistered + store cleared');
}
