import kill from 'tree-kill';
import logger from './logger.js';

/**
 * Robustly kills a process and all its children.
 * Uses the tree-kill library for cross-platform recursive termination.
 */
export function killProcessTree(pid, signal = 'SIGKILL') {
    if (!pid) return;

    kill(pid, signal, (err) => {
        if (err) {
            // Error usually means process is already gone, or permissions issue
            logger.debug(`[ProcessManager] tree-kill info for PID ${pid}: ${err.message}`);
        } else {
            logger.debug(`[ProcessManager] Successfully killed process tree for PID ${pid}`);
        }
    });
}
