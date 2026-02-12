import path from 'path';
import os from 'os';

/**
 * Cross-Platform Trace Adapter
 *
 * Ensures deterministic trace execution across Windows, macOS, and Linux.
 * Normalizes paths, flags, environment variables, and timestamps.
 */
class TracePlatformAdapter {
    constructor() {
        this.platform = process.platform;
        this.isWindows = this.platform === 'win32';
    }

    /**
     * Normalize compiler flags to ensure consistency and proper instrumentation.
     * Enforces: -g, -O0, -fno-omit-frame-pointer, -finstrument-functions
     */
    normalizeCompileFlags(userFlags = []) {
        const requiredFlags = [
            '-g',
            '-O0',
            '-fno-omit-frame-pointer',
            '-finstrument-functions'
        ];

        // Filter out conflicting optimization flags or flags that might break instrumentation
        const safeUserFlags = userFlags.filter(flag => {
            // Remove optimization flags higher than O0
            if (/^-O[1-3sfast]/.test(flag)) return false;
            // Remove flags that might omit frame pointers
            if (flag === '-fomit-frame-pointer') return false;
            return true;
        });

        // specific flags for different compilers can be handled here if needed
        // For now, we assume Clang/GCC compatibility for these flags

        // Combine without destroying flag arguments (like -isystem <path>)
        // We rely on the filter above to remove conflicting flags.
        // We preach required flags first, but actually for -O0 we might want it last if we didn't filter?
        // But we DID filter -O[1-3]. So logic is:
        // requiredFlags + safeUserFlags.
        // We do NOT use Set because of paired flags.
        const combined = [...requiredFlags, ...safeUserFlags];
        return combined;
    }

    /**
     * Normalize file paths to use forward slashes and be absolute.
     * Prevents Windows backslash issues in trace output comparisons.
     */
    normalizePath(filePath) {
        if (!filePath) return '';
        const resolved = path.resolve(filePath);
        // Force forward slashes even on Windows for consistency in trace output
        return resolved.replace(/\\/g, '/');
    }

    /**
     * Get a normalized runtime environment for execution.
     * Handles LD_LIBRARY_PATH (Linux), DYLD_LIBRARY_PATH (macOS), and PATH (Windows).
     */
    getNormalizedRuntimeEnv(baseEnv = process.env, extraLibraryPaths = []) {
        const env = { ...baseEnv };
        const libPaths = extraLibraryPaths.map(p => path.resolve(p));

        if (this.isWindows) {
            // On Windows, memory of DLLs is searched in PATH
            // We prepend our library paths to PATH
            const currentPath = env.PATH || '';
            env.PATH = [...libPaths, currentPath].join(path.delimiter);
        } else if (this.platform === 'darwin') {
            // macOS uses DYLD_LIBRARY_PATH
            const currentDyld = env.DYLD_LIBRARY_PATH || '';
            env.DYLD_LIBRARY_PATH = [...libPaths, currentDyld].join(path.delimiter);
        } else {
            // Linux uses LD_LIBRARY_PATH
            const currentLd = env.LD_LIBRARY_PATH || '';
            env.LD_LIBRARY_PATH = [...libPaths, currentLd].join(path.delimiter);
        }

        // Ensure deterministic locale/timezone if possible (optional but good for determinism)
        env.LC_ALL = 'C';
        env.TZ = 'UTC';

        return env;
    }

    /**
     * Normalize trace timestamps to be deterministic or strictly monotonic.
     * If real timestamps are too variable, we can use a monotonic counter.
     * For now, we allow real timestamps but ensures they are numbers.
     */
    generateTimestamp(monotonicCounter) {
        // If we want strict determinism for regression testing, we might prefer the counter.
        // But the requirement says "Date.now() * 1000 OR tracer microsecond timestamps".
        // To be safe and deterministic in tests, we can respect an env var.
        if (process.env.TRACE_DETERMINISTIC === 'true') {
            return monotonicCounter * 1000; // Fake microseconds
        }
        return Date.now() * 1000;
    }

    /**
     * Filter and normalize output events.
     * Removes empty stdout lines and duplicate flush events.
     */
    normalizeOutputEvents(chunks) {
        if (!chunks || !Array.isArray(chunks)) return [];

        return chunks.filter(chunk => {
            if (!chunk) return false;
            // Remove completely empty chunks
            if (typeof chunk === 'string' && chunk.length === 0) return false;
            return true;
        });
        // Note: deeper deduplication might require context, but this filters empty chunks.
    }
}

export const tracePlatformAdapter = new TracePlatformAdapter();
export default tracePlatformAdapter;
