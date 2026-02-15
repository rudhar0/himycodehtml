// src/engine/worker/engine.worker.ts
import { processRawTrace, normalizeStepType } from '../traceProcessor';
import { RelationManager } from '../relation';
import { PositionManager } from '../position';

/**
 * Session Descriptor
 */
interface Session {
  id: string;
  relation: RelationManager;
  position: PositionManager;
  trace: any; // ExecutionTrace
  lastStep: number;
}

/**
 * Session Pool — Reusable instances to minimize allocation churn
 */
class SessionPool {
  private pool = new Map<string, Session>();
  private readonly MAX_SESSIONS = 5;

  getOrCreate(id: string): Session {
    if (this.pool.has(id)) {
      return this.pool.get(id)!;
    }

    if (this.pool.size >= this.MAX_SESSIONS) {
      // Evict oldest (LRU)
      const first = this.pool.keys().next().value;
      if (first) this.pool.delete(first);
    }

    const session: Session = {
      id,
      relation: new RelationManager(),
      position: new PositionManager(),
      trace: null,
      lastStep: -1
    };
    this.pool.set(id, session);
    return session;
  }

  delete(id: string) {
    this.pool.delete(id);
  }
}

const pool = new SessionPool();

/**
 * Worker Message Router
 */
self.onmessage = async (e: MessageEvent) => {
  const { type, payload, sessionId } = e.data;
  const session = pool.getOrCreate(sessionId);

  switch (type) {
    case 'PROCESS_TRACE': {
      const start = performance.now();
      const { chunks, maxSteps } = payload;
      const { trace } = processRawTrace(chunks, maxSteps);
      session.trace = trace;
      
      self.postMessage({
        type: 'TRACE_PROCESSED',
        payload: { 
          totalSteps: trace.totalSteps,
          // We transfer the trace back but keep a local copy for layout jumps
          trace,
          latency: performance.now() - start
        },
        sessionId
      });
      break;
    }

    case 'CALCULATE_LAYOUT': {
      const start = performance.now();
      const { stepIndex, forceRebuild } = payload;
      
      if (!session.trace) {
        self.postMessage({ type: 'ERROR', payload: 'Trace not loaded', sessionId });
        return;
      }

      const relation = session.relation;
      const position = session.position;

      // DAG-style incremental update
      if (forceRebuild || stepIndex < session.lastStep) {
        relation.reset();
        for (let i = 0; i <= stepIndex; i++) {
          relation.applyStep(session.trace.steps[i], i);
        }
      } else {
        // Incrementally apply steps from last known position
        for (let i = session.lastStep + 1; i <= stepIndex; i++) {
          relation.applyStep(session.trace.steps[i], i);
        }
      }

      session.lastStep = stepIndex;

      // Calculate position
      position.updateFromRelation(relation.getTree(), stepIndex);
      const positions = position.getAllPositions();
      const delta = position.getDelta();

      // Return results (Map to Object for serialization)
      const positionsObj: Record<string, any> = {};
      positions.forEach((v, k) => positionsObj[k] = v);

      self.postMessage({
        type: 'LAYOUT_COMPLETE',
        payload: {
          positions: positionsObj,
          delta: {
            added: Object.fromEntries(delta.added),
            updated: Object.fromEntries(delta.updated),
            removed: Array.from(delta.removed)
          },
          latency: performance.now() - start
        },
        sessionId
      });
      break;
    }

    case 'CLEANUP':
      pool.delete(sessionId);
      break;
  }
};
