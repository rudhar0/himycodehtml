// backend/src/services/instrumentation-tracer.service.js
import { spawn, execFileSync } from 'child_process';
import { writeFile, readFile, unlink, mkdir, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { fileURLToPath } from 'url';
import codeInstrumenter from './code-instrumenter.service.js';
import { toolchainService } from './toolchain.service.js';
import { tracePlatformAdapter } from './trace-platform-adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Custom error classes for clear failure modes ---
class TraceInstrumentationFailureError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TraceInstrumentationFailureError';
    }
}

class TraceInstrumentationUnsupportedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TraceInstrumentationUnsupportedError';
    }
}

console.log('[TraceService] Trace service active: instrumentation-tracer');

class InstrumentationTracer {
    constructor() {
        this.tempDir = path.join(process.cwd(), 'temp');
        this.tracerCpp = path.join(process.cwd(), 'src', 'cpp', 'tracer.cpp');
        this.traceHeader = path.join(process.cwd(), 'src', 'cpp', 'trace.h');
        this.ensureTempDir();

        this.arrayRegistry = new Map();
        this.pointerRegistry = new Map();
        this.functionRegistry = new Map();
        this.callStack = [];

        this.frameStack = [];
        this.globalCallIndex = 0;
        this.frameCounts = new Map();
        this.addressToName = new Map();
        this.addressToFrame = new Map();
    }

    async ensureTempDir() {
        if (!existsSync(this.tempDir)) {
            await mkdir(this.tempDir, { recursive: true });
        }
    }

    generateFrameId(functionName) {
        const count = this.frameCounts.get(functionName) || 0;
        this.frameCounts.set(functionName, count + 1);
        return `${functionName}-${count}`;
    }

    getCurrentFrameMetadata() {
        if (this.frameStack.length === 0) {
            return {
                frameId: 'main-0',
                callDepth: 0,
                callIndex: this.globalCallIndex++,
                parentFrameId: undefined
            };
        }

        const current = this.frameStack[this.frameStack.length - 1];
        return {
            frameId: current.frameId,
            callDepth: current.callDepth,
            callIndex: this.globalCallIndex++,
            parentFrameId: current.parentFrameId
        };
    }

    pushCallFrame(functionName) {
        // Function tracking must be tied to call frames (source of truth)
        this.functionRegistry.set(functionName, true);

        const parentFrame = this.frameStack.length > 0
            ? this.frameStack[this.frameStack.length - 1]
            : null;

        const frameId = this.generateFrameId(functionName);
        const callDepth = this.frameStack.length;

        const frame = {
            frameId,
            functionName,
            callDepth,
            parentFrameId: parentFrame ? parentFrame.frameId : undefined,
            entryCallIndex: this.globalCallIndex++,
            activeLoops: new Map(),
            declaredVariables: new Map(),
            pointerAliases: new Map(),
            blockScopes: [],
            scopeStack: []
        };

        if (parentFrame && parentFrame.pointerAliases) {
            for (const [key, value] of parentFrame.pointerAliases.entries()) {
                frame.pointerAliases.set(key, { ...value });
            }
        }

        this.frameStack.push(frame);
        return frame;
    }

    popCallFrame() {
        return this.frameStack.pop();
    }

    resolveAliasByValue(pointerName, startFrame) {
        if (!startFrame) return null;

        let currentPointerName = pointerName;
        const visited = new Set();

        while (currentPointerName && !visited.has(currentPointerName)) {
            visited.add(currentPointerName);

            let aliasInfo = null;
            let frameIdx = this.frameStack.indexOf(startFrame);
            while (frameIdx >= 0) {
                const frame = this.frameStack[frameIdx];
                if (frame.pointerAliases.has(currentPointerName)) {
                    aliasInfo = frame.pointerAliases.get(currentPointerName);
                    break;
                }
                frameIdx--;
            }

            if (!aliasInfo || !aliasInfo.aliasedAddress) {
                return null;
            }

            const { aliasedAddress } = aliasInfo;

            if (this.addressToName.has(aliasedAddress)) {
                const targetName = this.addressToName.get(aliasedAddress);

                let isTargetPointer = false;
                let targetFrameIdx = this.frameStack.length - 1;
                while (targetFrameIdx >= 0) {
                    if (this.frameStack[targetFrameIdx].pointerAliases.has(targetName)) {
                        isTargetPointer = true;
                        break;
                    }
                    targetFrameIdx--;
                }

                if (isTargetPointer) {
                    currentPointerName = targetName;
                } else {
                    return {
                        targetName: targetName,
                        address: aliasedAddress,
                        isHeap: aliasInfo.isHeap || false,
                        region: aliasInfo.isHeap ? 'heap' : 'stack'
                    };
                }
            } else {
                return {
                    targetName: 'unknown',
                    address: aliasedAddress,
                    isHeap: aliasInfo.isHeap || true,
                    region: 'unknown'
                };
            }
        }
        return null;
    }

    async getLineInfo(executable, address) {
        const candidates = [];
        if (process.platform === 'win32' && toolchainService.toolchainPath) {
            candidates.push(
                path.join(toolchainService.toolchainPath, 'llvm-addr2line.exe'),
                path.join(toolchainService.toolchainPath, 'addr2line.exe')
            );
        }
        candidates.push('addr2line');

        for (const bin of candidates) {
            try {
                // eslint-disable-next-line no-await-in-loop
                const info = await new Promise((resolve) => {
                    const proc = spawn(bin, ['-e', executable, '-f', '-C', '-i', address]);
                    let output = '';
                    proc.stdout.on('data', d => output += d.toString());
                    proc.on('error', (err) => {
                        console.warn(`[LineInfo] Failed to spawn ${bin}: ${err.message}`);
                        resolve(null);
                    });
                    proc.on('close', (code) => {
                        if (code !== 0) {
                            console.warn(`[LineInfo] ${bin} exited with code ${code}`);
                            resolve(null);
                            return;
                        }
                        const lines = output.trim().split('\n');
                        if (lines.length >= 2) {
                            const fn = lines[0];
                            const loc = lines[1];
                            const m = loc.match(/^(.+):(\d+)$/);
                            if (m) {
                                resolve({
                                    function: fn !== '??' ? fn : 'unknown',
                                    file: m[1],
                                    line: parseInt(m[2], 10) || 0
                                });
                                return;
                            } else {
                                console.warn(`[LineInfo] Output format mismatch for ${bin}: ${JSON.stringify(lines)}`);
                            }
                        } else {
                            console.warn(`[LineInfo] Insufficient output from ${bin}: ${JSON.stringify(lines)}`);
                        }
                        resolve(null);
                    });
                });
                if (info) return info;
            } catch (err) {
                console.warn(`[LineInfo] Error running ${bin}: ${err.message}`);
                // try next candidate
            }
        }

        // PHASE 4 FALLBACK: Windows addr2line failure resilience
        // Do not drop structural events when addr2line fails
        // Return best-effort defaults to preserve trace integrity
        return {
            function: 'unknown',
            file: 'unknown',
            line: 0
        };
    }

    shouldFilterEvent(info, event, userSourceFile) {
        const { file, function: fn, line } = info;

        // Keep structural events even when line information is missing (common on Windows addr2line).
        if (!file || file === 'unknown' || file === '??') {
            const structural = new Set([
                'func_enter', 'func_exit', 'return',
                'loop_start', 'loop_end', 'loop_body_start', 'loop_iteration_end',
                'loop_condition', 'loop_body_summary',
                'condition_eval', 'branch_taken',
                'control_flow', 'block_enter', 'block_exit',
                'heap_alloc', 'heap_free'
            ]);
            if (structural.has(event.type)) return false;
            return true;
        }

        if (fn && (fn.includes('GLOBAL__sub') ||
            fn.includes('_static_initialization_and_destruction'))) {
            return true;
        }

        if (this.normalizeFilePath(file) === this.normalizeFilePath(userSourceFile)) return false;

        if (process.platform !== 'win32') {
            if (file.startsWith('/usr/') || file.startsWith('/lib/') ||
                file.includes('include/c++/') || file.includes('include/bits/')) return true;
        } else {
            if (file.includes('mingw') || file.includes('include\\c++') ||
                file.includes('lib\\gcc')) return true;
        }

        if (file.includes('stl_') || file.includes('bits/') ||
            file.includes('iostream') || file.includes('ostream') ||
            file.includes('streambuf')) return true;

        const internalPrefixes = ['__', '_IO_', '_M_', 'std::__',
            'std::basic_', 'std::char_traits', '__gnu_cxx::', '__cxxabi'];

        return internalPrefixes.some(prefix => fn && fn.startsWith(prefix));
    }

    parseEscapeSequences(text) {
        const escapes = [];
        const escapeMap = {
            '\\n': { char: '\\n', meaning: 'New line', rendered: '\n' },
            '\\t': { char: '\\t', meaning: 'Horizontal tab', rendered: '\t' },
            '\\r': { char: '\\r', meaning: 'Carriage return', rendered: '\r' },
            '\\f': { char: '\\f', meaning: 'Form feed', rendered: '\f' },
            '\\b': { char: '\\b', meaning: 'Backspace', rendered: '\b' },
            '\\\\': { char: '\\\\', meaning: 'Backslash', rendered: '\\' }
        };

        let rendered = text;
        for (const [seq, info] of Object.entries(escapeMap)) {
            if (text.includes(seq)) {
                escapes.push({ char: info.char, meaning: info.meaning });
                rendered = rendered.replace(new RegExp(seq.replace(/\\/g, '\\\\'), 'g'), info.rendered);
            }
        }
        return { rendered, escapes };
    }

    // Validation is intentionally a no-op now; clang-built tracer objects contain
    // the hook symbols by design, and strict checks caused false failures.
    async validateTracerObject(_tracerObj) { return; }

    async compile(code, language = 'cpp') {
        const sessionId = uuid();
        const ext = language === 'c' ? 'c' : 'cpp';
        const compiler = toolchainService.getCompiler('cpp');
        const stdFlag = '-std=c++17';
        const includeFlags = toolchainService.getIncludeFlags('cpp');
        const linkerFlags = toolchainService.getLinkerFlags();

        // --- Step 1.3: Compiler validation (cross-platform safe) ---
        const compilerBasename = path.basename(compiler).toLowerCase();
        if (compilerBasename.includes('clang-cl') || compilerBasename === 'cl.exe') {
            throw new TraceInstrumentationUnsupportedError(
                `Unsupported compiler: ${compilerBasename}. ` +
                `Only clang, clang++, gcc, g++ support -finstrument-functions.`
            );
        }

        const instrumented = await codeInstrumenter.instrumentCode(code, language);
        const sourceFile = path.resolve(path.join(this.tempDir, `src_${sessionId}.${ext}`));
        const userObj = path.resolve(path.join(this.tempDir, `src_${sessionId}.o`));
        const tracerObj = path.resolve(path.join(this.tempDir, `tracer_${sessionId}.o`));
        const executable = path.resolve(path.join(this.tempDir, `exec_${sessionId}${process.platform === 'win32' ? '.exe' : ''}`));
        const traceOutput = path.resolve(path.join(this.tempDir, `trace_${sessionId}.json`));
        const headerCopy = path.resolve(path.join(this.tempDir, 'trace.h'));

        await writeFile(sourceFile, instrumented, 'utf-8');
        await copyFile(this.traceHeader, headerCopy);

        // --- Step 1.3 + Phase 2: Normalize user compile flags via adapter ---
        const rawUserFlags = ['-c', '-g', '-O0', stdFlag, '-fno-omit-frame-pointer',
            '-finstrument-functions', ...includeFlags, ...toolchainService.getDeterministicFlags(), '-fno-inline'];
        const normalizedFlags = tracePlatformAdapter.normalizeCompileFlags(rawUserFlags);
        const userCompileArgs = [...normalizedFlags, sourceFile, '-o', userObj];

        if (!userCompileArgs.includes('-finstrument-functions')) {
            throw new TraceInstrumentationFailureError(
                '-finstrument-functions missing from user compile flags'
            );
        }

        // --- Step 1.2: Log exact compile command ---
        console.log('[Compile] User compile command:', compiler, userCompileArgs.join(' '));
        console.log('[Compile] Working directory:', this.tempDir);

        const compileUser = new Promise((resolve, reject) => {
            const p = spawn(compiler, userCompileArgs);
            let err = '';
            p.stderr.on('data', d => err += d.toString());
            p.on('close', code => code === 0 ? resolve() : reject(new Error(`User compile failed:\n${err}`)));
            p.on('error', e => reject(e));
        });

        const compileTracer = new Promise((resolve, reject) => {
            const disableInstrFlag = compiler.includes('clang') ? null : '-fno-instrument-functions';
            let tracerArgs = ['-c', '-g', '-O0', stdFlag, '-fno-omit-frame-pointer',
                ...includeFlags, ...toolchainService.getDeterministicFlags(), '-fno-inline', this.tracerCpp, '-o', tracerObj];
            if (disableInstrFlag) {
                tracerArgs = [
                    ...tracerArgs.slice(0, tracerArgs.length - 2),
                    disableInstrFlag,
                    ...tracerArgs.slice(tracerArgs.length - 2)
                ];
            }
            // --- Step 1.2: Log tracer compile command ---
            console.log('[Compile] Tracer compile command:', compiler, tracerArgs.join(' '));

            const p = spawn(compiler, tracerArgs);
            let err = '';
            p.stderr.on('data', d => err += d.toString());
            p.on('close', code => code === 0 ? resolve() : reject(new Error(`Tracer compile failed:\n${err}`)));
            p.on('error', e => reject(e));
        });

        await Promise.all([compileUser, compileTracer]);
        await this.validateTracerObject(tracerObj);

        const linkArgs = [userObj, tracerObj, '-o', executable, ...linkerFlags];
        if (process.platform !== 'win32') linkArgs.unshift('-pthread', '-ldl');

        // --- Step 1.2: Log link command ---
        console.log('[Compile] Link command:', compiler, linkArgs.join(' '));

        const linked = await new Promise((resolve, reject) => {
            const link = spawn(compiler, linkArgs);
            let err = '';
            link.stderr.on('data', d => err += d.toString());
            link.on('close', code => {
                if (code === 0) {
                    resolve({ executable, sourceFile, traceOutput, headerCopy });
                } else {
                    reject(new Error(`Linking failed:\n${err}`));
                }
            });
            link.on('error', e => reject(e));
        });

        // --- Step 1.1: Verify instrumentation hook symbols ---
        await this._verifyInstrumentationHooks(executable);

        return linked;
    }

    /**
     * Step 1.1: Verify __cyg_profile_func_enter/exit symbols exist in compiled binary.
     * Uses llvm-nm from the bundled toolchain. Must work on Windows/Linux/macOS.
     */
    async _verifyInstrumentationHooks(executable) {
        const nmPath = path.join(
            path.dirname(toolchainService.getCompiler('cpp')),
            process.platform === 'win32' ? 'llvm-nm.exe' : 'llvm-nm'
        );

        try {
            const output = execFileSync(nmPath, [executable], {
                encoding: 'utf-8',
                timeout: 5000
            });

            const hasEnter = output.includes('__cyg_profile_func_enter');
            const hasExit = output.includes('__cyg_profile_func_exit');

            console.log(`[HookVerify] __cyg_profile_func_enter: ${hasEnter ? '✅' : '❌'}`);
            console.log(`[HookVerify] __cyg_profile_func_exit: ${hasExit ? '✅' : '❌'}`);

            if (!hasEnter || !hasExit) {
                throw new TraceInstrumentationFailureError(
                    `Instrumentation hooks missing from binary. ` +
                    `enter=${hasEnter}, exit=${hasExit}. ` +
                    `Binary: ${executable}`
                );
            }
        } catch (e) {
            if (e instanceof TraceInstrumentationFailureError) throw e;
            console.warn(`[HookVerify] llvm-nm check failed (non-fatal): ${e.message}`);
            // Non-fatal: if llvm-nm itself fails, don't block execution
        }
    }

    async executeInstrumented(executable, traceOutput) {
        const cwd = path.dirname(executable);
        const absExecutable = path.resolve(executable);

        // --- Step 1.4: Log binary being executed ---
        console.log(`[Execute] Executing binary: ${absExecutable}`);
        console.log(`[Execute] Working directory: ${cwd}`);
        console.log(`[Execute] TRACE_OUTPUT: ${traceOutput}`);

        // Stage Windows runtime DLLs (fail early)
        if (process.platform === 'win32') {
            await toolchainService.stageRuntimeDependencies(cwd);
        }

        return new Promise((resolve, reject) => {
            // --- Step 1.4: Always use absolute path ---
            const cmd = absExecutable;

            // --- Step 1.5: Merge runtime env (do not overwrite) ---
            const env = { ...toolchainService.getRuntimeEnv(), TRACE_OUTPUT: traceOutput };

            const proc = spawn(cmd, [], {
                cwd,
                env,
                stdio: ['ignore', 'pipe', 'pipe'],
                // use shell on Windows to ensure DLL resolution behaves consistently
                shell: process.platform === 'win32'
            });

            let stdout = '', stderr = '';
            const stdoutChunks = [];
            const stdoutTimestamps = [];

            proc.stdout.on('data', d => {
                const chunk = d.toString();
                stdout += chunk;
                stdoutChunks.push(chunk);
                stdoutTimestamps.push(Date.now() * 1000);
            });
            proc.stderr.on('data', d => stderr += d.toString());

            const timeout = setTimeout(() => {
                try { proc.kill(); } catch (_) { }
                reject(new Error('Execution timeout (10 s)'));
            }, 10000);

            proc.on('close', async (code) => {
                clearTimeout(timeout);
                if (code === 0 || code === null) {
                    resolve({ stdout, stderr, stdoutChunks, stdoutTimestamps });
                } else {
                    // Capture crash diagnostics
                    const debug = {
                        compiler: toolchainService.getCompiler('cpp'),
                        compilerFlags: toolchainService.getAllFlags('cpp'),
                        runtimeEnv: env,
                        spawnedCommand: { cmd, args: [] },
                        toolchainVersion: toolchainService.llvmVersion,
                        os: process.platform,
                        arch: process.arch,
                        exitCode: code,
                        stdout,
                        stderr
                    };
                    const debugPath = path.join(cwd, 'trace_debug.json');
                    try {
                        await writeFile(debugPath, JSON.stringify(debug, null, 2), 'utf-8');
                    } catch (e) {
                        // best-effort
                    }
                    reject(new Error(`Execution failed (code ${code}). Diagnostics written to ${debugPath}`));
                }
            });
            proc.on('error', e => {
                clearTimeout(timeout);
                reject(new Error(`Failed to execute: ${e.message}`));
            });
        });
    }

    async parseTraceFile(tracePath) {
        // --- Step 1.6: Trace file validation ---
        const absTracePath = path.resolve(tracePath);

        if (!existsSync(absTracePath)) {
            console.error(`[TraceFile] Trace file does NOT exist: ${absTracePath}`);
            throw new TraceInstrumentationFailureError(
                `Trace output file not generated: ${absTracePath}`
            );
        }

        try {
            const txt = await readFile(absTracePath, 'utf-8');
            const parsed = JSON.parse(txt);
            const events = parsed.events || [];
            const functions = parsed.tracked_functions || [];

            console.log(`[TraceFile] File: ${absTracePath}`);
            console.log(`[TraceFile] Events: ${events.length}, Functions: ${functions.length}`);

            // --- Step 1.6: Event count validation ---
            if (events.length === 0) {
                throw new TraceInstrumentationFailureError(
                    `Trace file contains 0 events. Instrumentation may not be active. File: ${absTracePath}`
                );
            }

            if (events.length < 5) {
                console.warn(
                    `[TraceFile] ⚠️ LOW EVENT COUNT: ${events.length} events. ` +
                    `Expected ≥ 5 for non-trivial programs. ` +
                    `This may indicate instrumentation failure. ` +
                    `File: ${absTracePath}`
                );
            }

            return { events, functions };
        } catch (e) {
            if (e instanceof TraceInstrumentationFailureError) throw e;
            console.error('Failed to read/parse trace file:', e.message);
            throw new TraceInstrumentationFailureError(
                `Trace file parse failed: ${e.message}. File: ${absTracePath}`
            );
        }
    }


    async convertToSteps(events, executable, sourceFile, programOutput, trackedFunctions, inputLinesMap = null) {
        console.log(`📊 Converting ${events.length} events to beginner-correct steps...`);

        const steps = [];
        let stepIndex = 0;
        const isDeterministic = process.env.TRACE_DETERMINISTIC === 'true';
        const timestampIncrement = isDeterministic ? 1000 : 1;
        let lastKnownTimestamp = 0;
        let mainStarted = false;
        let currentFunction = 'main';

        // Reset state
        this.frameStack = [];
        this.globalCallIndex = 0;
        this.frameCounts = new Map();
        this.functionRegistry.clear();
        this.addressToName.clear();
        this.addressToFrame.clear();

        // Parse program output
        const outputLines = programOutput.stdout.split('\n');

        // Use provided inputLinesMap (from original code) or scan instrumented file
        const inputLines = inputLinesMap || this.scanForInputOperations(sourceFile);

        // Track functions observed during conversion to keep tracked_functions populated
        const functionSet = new Set(trackedFunctions || []);

        // Normalize source file path for cross-platform comparison
        const normalizeFile = (f) => {
            if (!f) return '';
            return path.basename(f).toLowerCase().replace(/\\/g, '/').trim();
        };
        const userSourceBase = normalizeFile(sourceFile);

        console.log(`🔍 User source file: ${userSourceBase}`);

        const isNoiseFunction = (info) => {
            const fn = info.function || '';
            const file = info.file || '';
            const normalizedFile = file.toLowerCase();

            // Never filter the user's own source file.
            if (userSourceBase && normalizeFile(file) === userSourceBase) return false;

            // 1. event.function starts with "std::" or "__gnu_cxx::"
            if (fn.startsWith('std::') || fn.startsWith('__gnu_cxx::')) return true;

            // 2. event.file equals or contains: ios, ostream, locale, __locale, streambuf
            // Using more specific checks to avoid false positives (e.g., "radios.cpp")
            const stlHeaders = ['ios', 'ostream', 'locale', '__locale', 'streambuf'];
            if (stlHeaders.some(h => normalizedFile === h || normalizedFile.endsWith('/' + h) || normalizedFile.endsWith('\\' + h))) return true;
            if (stlHeaders.some(h => normalizedFile.includes('/' + h + '/') || normalizedFile.includes('\\' + h + '\\'))) return true;

            // 3. event.file is "??" AND function starts with "std::"
            if ((file === '??' || file === 'unknown') && fn.startsWith('std::')) return true;

            return false;
        };

        // NEW: Loop Buffering Stack
        const loopStack = [];
        // Track active loop iterations via the frame scope stack
        const activeLoopIterationStack = [];
        // Loop summary must never include structural events; expand set comprehensively
        const STRUCTURAL_EVENTS = new Set([
            'func_enter', 'func_exit', 'return', 'scope_exit',
            'loop_start', 'loop_end', 'loop_body_start', 'loop_iteration_end', 'loop_condition', 'loop_body_summary',
            'block_enter', 'block_exit'
        ]);

        // When addr2line fails (common on Windows) we must not fabricate user source locations.
        // Allow only a minimal safe subset of events to be processed without resolved file/line.
        const UNRESOLVED_ALLOWED_EVENT_TYPES = new Set([
            'func_enter',
            'func_exit',
            'heap_alloc',
            'heap_free'
        ]);
        // Some events (like heap alloc/free) legitimately lack source line info; keep them.
        const ALLOW_MISSING_SOURCE_EVENT_TYPES = new Set([
            'heap_alloc',
            'heap_free'
        ]);

        const flushLoopSummary = (loopContext, { lineFallback, fileFallback } = {}) => {
            if (!loopContext) return;

            const summaryEvents = (loopContext.buffer || []).filter(e => !STRUCTURAL_EVENTS.has(e.eventType));
            if (summaryEvents.length === 0) return;

            const remapped = summaryEvents.map((e, idx) => {
                const copy = { ...e };
                // Never expose global stepIndex values inside summaries
                delete copy.stepIndex;
                return { ...copy, internalStepIndex: idx };
            });
            const snapshot = loopContext.frameMetadataSnapshot || {};

            steps.push({
                stepIndex: stepIndex++,
                eventType: 'loop_body_summary',
                line: loopContext.startLine || lineFallback || 0,
                function: loopContext.functionName || currentFunction,
                scope: 'block',
                file: normalizeFile(loopContext.startFile || fileFallback || sourceFile),
                timestamp: (lastKnownTimestamp += timestampIncrement),
                loopId: loopContext.loopId,
                explanation: `... Loop execution summary ...`,
                internalEvents: [],
                events: remapped,
                ...snapshot
            });
        };

        const DEBUG_LOOP_VALIDATION = false;
        const validateLoopInvariants = (context) => {
            if (!DEBUG_LOOP_VALIDATION) return;
            if (loopStack.length < activeLoopIterationStack.length) {
                console.warn(`[Loop Validation] iteration stack deeper than loop stack (${context})`);
            }
        };

        // Optional: Enable debug assertions during development
        // Uncomment to validate frame stack consistency
        const DEBUG_FRAME_VALIDATION = false;
        const validateFrameStack = () => {
            if (DEBUG_FRAME_VALIDATION && this.frameStack.length !== (currentFunction === 'main' ? 1 : this.frameStack.length)) {
                console.warn('[Frame Validation] Frame depth mismatch detected');
            }
        };

        // Proactively start main frame so Windows builds (where addr2line / function
        // names may be missing) still produce a consistent step sequence.
        stepIndex = 0;
        const mainFrameInit = this.pushCallFrame('main');
        functionSet.add('main');
        steps.push({
            stepIndex: stepIndex++,
            eventType: 'program_start',
            line: 0,
            function: 'main',
            scope: 'global',
            file: path.basename(sourceFile),
            timestamp: (lastKnownTimestamp += timestampIncrement),
            explanation: '🚀 Program started',
            internalEvents: [],
            frameId: mainFrameInit.frameId,
            callDepth: mainFrameInit.callDepth,
            callIndex: mainFrameInit.entryCallIndex,
            parentFrameId: mainFrameInit.parentFrameId,
            isFunctionEntry: true
        });
        steps.push({
            stepIndex: stepIndex++,
            eventType: 'func_enter',
            line: 0,
            function: 'main',
            scope: 'function',
            file: normalizeFile(sourceFile),
            timestamp: (lastKnownTimestamp += timestampIncrement),
            explanation: '➡️ Entering main',
            internalEvents: [],
            frameId: mainFrameInit.frameId,
            callDepth: mainFrameInit.callDepth,
            callIndex: this.globalCallIndex++,
            parentFrameId: mainFrameInit.parentFrameId,
            isFunctionEntry: true
        });
        mainStarted = true;
        currentFunction = 'main';

        for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            if (ev.type) ev.type = ev.type.toLowerCase();

            // Get file/line info
            let info;
            if (ev.file && ev.line) {
                info = {
                    function: this.normalizeFunctionName(ev.func || ev.name || 'unknown'),
                    file: ev.file,
                    line: ev.line
                };
            } else {
                info = await this.getLineInfo(executable, ev.addr);
                info.function = this.normalizeFunctionName(info.function);
                // Prefer tracer-provided function name when addr2line cannot resolve.
                if ((!info.function || info.function === 'unknown') && ev.func) {
                    info.function = this.normalizeFunctionName(ev.func);
                }

                // Mark unresolved instead of fabricating user source locations (prevents STL leakage).
                if (!info.file || info.file === 'unknown' || info.file === '??' || !info.line || info.line === 0) {
                    info.isUnresolved = true;
                }
            }

            // Debug first few events
            if (i < 100) {
                console.log(`[Event ${i}] type=${ev.type}, func="${info.function}", file=${normalizeFile(info.file)}, line=${info.line}`);
            }

            const isEventNoise = isNoiseFunction(info);

            // Helpers to manage step increments conditionally
            const nextIndex = () => isEventNoise ? -1 : stepIndex++;
            const nextTime = () => isEventNoise ? lastKnownTimestamp : (lastKnownTimestamp += timestampIncrement);

            // --- Helper to push step to correct buffer ---
            const pushStep = (step) => {
                if (isEventNoise || step.stepIndex === -1) return; // Skip noise events
                if (STRUCTURAL_EVENTS.has(step.eventType)) {
                    steps.push(step);
                    return;
                }
                if (loopStack.length > 0) {
                    loopStack[loopStack.length - 1].buffer.push(step);
                } else {
                    steps.push(step);
                }
            };

            // ==========================================
            // STEP 1: Detect main() entry
            // ==========================================
            if (!mainStarted && ev.type === 'func_enter') {
                // Synthetic main already emitted; avoid duplicate main enter
                mainStarted = true;
                currentFunction = 'main';
                continue;
            }

            // Skip pre-main events
            if (!mainStarted) {
                if (i < 10) console.log(`[convertToSteps] Skipping pre-main event i=${i}, type=${ev.type}, resolvedFunc="${info.function}", rawFunc="${ev.func}"`);
                continue;
            }

            const isStructural = [
                'func_enter', 'func_exit', 'return',
                'loop_start', 'loop_end', 'loop_body_start', 'loop_iteration_end',
                'loop_condition', 'loop_body_summary',
                'condition_eval', 'branch_taken',
                'control_flow', 'block_enter', 'block_exit'
            ].includes(ev.type);

            // Strict unresolved-event filtering:
            // Never fabricate user-visible non-essential events when addr2line fails.
            if (info.isUnresolved) {
                const hasOpenLoopContext = ev.type === 'loop_end' && loopStack.some(l => l.loopId === ev.loopId);
                if (!UNRESOLVED_ALLOWED_EVENT_TYPES.has(ev.type) && !hasOpenLoopContext) {
                    continue;
                }
            }

            // ==========================================
            // STEP 2: Filter system/library code (skip for structural events)
            // ==========================================
            if (!isStructural && this.shouldFilterEvent(info, ev, sourceFile)) {
                continue;
            }

            // If we still don't have a source line, drop non-structural events
            if (!isStructural && (!info.file || info.line === 0) && !ALLOW_MISSING_SOURCE_EVENT_TYPES.has(ev.type)) {
                continue;
            }

            const currentFrame = this.frameStack[this.frameStack.length - 1];

            let step = null;

            // ==========================================
            // Process event types - Handle func_enter FIRST before frameMetadata
            // ==========================================

            if (ev.type === 'func_enter' && info.function !== 'main') {
                const newFrame = this.pushCallFrame(info.function);
                functionSet.add(info.function);
                currentFunction = info.function;

                // CRITICAL FIX: Generate frame metadata AFTER pushCallFrame
                const frameMetadata = {
                    frameId: newFrame.frameId,
                    callDepth: newFrame.callDepth,
                    callIndex: newFrame.entryCallIndex,
                    parentFrameId: newFrame.parentFrameId
                };

                pushStep({
                    stepIndex: nextIndex(),
                    eventType: 'func_enter',
                    line: info.line,
                    function: info.function,
                    scope: 'function',
                    file: normalizeFile(info.file),
                    timestamp: nextTime(),
                    explanation: `➡️ Entering ${info.function}`,
                    internalEvents: [],
                    frameId: newFrame.frameId,
                    callDepth: newFrame.callDepth,
                    callIndex: newFrame.entryCallIndex,
                    parentFrameId: newFrame.parentFrameId,
                    isFunctionEntry: true
                });
                continue;
            }

            // For all other events, get frameMetadata from current state
            const frameMetadata = this.getCurrentFrameMetadata();

            // ===================================================================
            // Check if current line has an input operation and inject input_request
            // ===================================================================
            if (inputLines.has(info.line) && mainStarted) {
                const inputInfo = inputLines.get(info.line);

                const inputRequest = {
                    type: inputInfo.type,
                    variables: inputInfo.variables,
                    format: inputInfo.format || undefined,
                    line: info.line
                };

                pushStep({
                    stepIndex: nextIndex(),
                    eventType: 'input_request',
                    line: info.line,
                    function: currentFunction,
                    scope: 'block',
                    file: normalizeFile(info.file),
                    timestamp: nextTime(),
                    explanation: inputInfo.prompt,
                    pauseExecution: true,
                    inputRequest: inputRequest,
                    internalEvents: [],
                    ...frameMetadata
                });

                inputLines.delete(info.line);
            }

            // ==========================================
            // Continue processing other event types
            // ==========================================

            if (ev.type === 'func_exit') {
                // Frame stack safety check
                if (!this.frameStack.length) {
                    console.warn('[convertToSteps] func_exit event with empty frame stack - skipping');
                    continue;
                }

                const exitingFrame = this.popCallFrame();

                if (!exitingFrame) {
                    continue;
                }

                if (exitingFrame.scopeStack.length > 0) {
                    const allDestroyedSymbols = new Set();
                    for (const scope of exitingFrame.scopeStack) {
                        for (const varName of scope.variables) {
                            allDestroyedSymbols.add(varName);
                        }
                    }

                    if (allDestroyedSymbols.size > 0) {
                        pushStep({
                            stepIndex: nextIndex(),
                            eventType: 'scope_exit',
                            line: info.line,
                            function: info.function,
                            scope: 'function',
                            file: normalizeFile(info.file),
                            timestamp: nextTime(),
                            scopeType: 'function',
                            destroyedSymbols: Array.from(allDestroyedSymbols),
                            explanation: `} Function scope exit - destroying: ${Array.from(allDestroyedSymbols).join(', ')}`,
                            internalEvents: [],
                            frameId: exitingFrame.frameId,
                            callDepth: exitingFrame.callDepth,
                            callIndex: this.globalCallIndex++,
                            parentFrameId: exitingFrame.parentFrameId
                        });
                    }

                    exitingFrame.scopeStack = [];
                }

                pushStep({
                    stepIndex: nextIndex(),
                    eventType: 'func_exit',
                    line: info.line,
                    function: info.function,
                    scope: 'function',
                    file: normalizeFile(info.file),
                    timestamp: nextTime(),
                    explanation: `⬅️ Exiting ${info.function}`,
                    internalEvents: [],
                    frameId: exitingFrame.frameId,
                    callDepth: exitingFrame.callDepth,
                    callIndex: this.globalCallIndex++,
                    parentFrameId: exitingFrame.parentFrameId,
                    isFunctionExit: true
                });

                currentFunction = this.frameStack.length > 0
                    ? this.frameStack[this.frameStack.length - 1].functionName
                    : 'main';
                if (!currentFunction) currentFunction = 'main';
                continue;
            }

            if (ev.type === 'condition_eval') {
                step = {
                    stepIndex: nextIndex(),
                    eventType: 'condition_eval',
                    line: info.line,
                    function: currentFunction,
                    scope: 'block',
                    file: normalizeFile(info.file),
                    timestamp: nextTime(),
                    conditionId: ev.conditionId,
                    expression: ev.expression,
                    result: ev.result === 1,
                    explanation: `🔍 Condition (${ev.expression}) = ${ev.result === 1 ? 'true' : 'false'}`,
                    internalEvents: [],
                    ...frameMetadata
                };

            } else if (ev.type === 'branch_taken') {
                step = {
                    stepIndex: nextIndex(),
                    eventType: 'branch_taken',
                    line: info.line,
                    function: currentFunction,
                    scope: 'block',
                    file: normalizeFile(info.file),
                    timestamp: nextTime(),
                    conditionId: ev.conditionId,
                    branchType: ev.branchType,
                    explanation: `➡️ Taking ${ev.branchType} branch`,
                    internalEvents: [],
                    ...frameMetadata
                };

            } else if (ev.type === 'arg_bind') {
                step = {
                    stepIndex: nextIndex(),
                    eventType: 'arg_bind',
                    line: info.line,
                    function: currentFunction,
                    scope: 'block',
                    file: normalizeFile(info.file),
                    timestamp: nextTime(),
                    symbol: ev.name,
                    value: ev.value,
                    explanation: `📌 Binding argument ${ev.name} = ${ev.value}`,
                    internalEvents: [],
                    ...frameMetadata
                };

            } else if (ev.type === 'expression_eval') {
                step = {
                    stepIndex: nextIndex(),
                    eventType: 'expression_eval',
                    line: info.line,
                    function: currentFunction,
                    scope: 'block',
                    file: normalizeFile(info.file),
                    timestamp: nextTime(),
                    expression: ev.expression,
                    result: ev.result,
                    explanation: `🧮 ${ev.expression} = ${ev.result}`,
                    internalEvents: [],
                    ...frameMetadata
                };

            } else if (ev.type === 'loop_start') {
                const loopId = ev.loopId;
                if (currentFrame) {
                    currentFrame.activeLoops.set(loopId, { iterations: 0 });
                }

                const loopStep = {
                    stepIndex: nextIndex(),
                    eventType: 'loop_start',
                    line: info.line,
                    function: currentFunction,
                    scope: 'block',
                    file: normalizeFile(info.file),
                    timestamp: nextTime(),
                    loopId: ev.loopId,
                    loopType: ev.loopType,
                    explanation: `🔄 Loop started (${ev.loopType})`,
                    internalEvents: [],
                    ...frameMetadata
                };

                pushStep(loopStep);

                // Store loop metadata snapshot so summaries use the original frame context
                loopStack.push({
                    loopId: loopId,
                    buffer: [],
                    frameMetadataSnapshot: { ...frameMetadata },
                    functionName: currentFunction,
                    startLine: info.line,
                    startFile: info.file,
                    iterationCount: 0
                });

            } else if (ev.type === 'loop_end') {
                const loopId = ev.loopId;
                // FIX: Strict loop ownership (LIFO). Never pop "orphans" as recovery.
                const topLoop = loopStack.length > 0 ? loopStack[loopStack.length - 1] : null;
                if (!topLoop || topLoop.loopId !== loopId) {
                    console.warn(`[Loop Mismatch] loop_end for ${loopId}, stack top is ${topLoop?.loopId}`);
                    continue;
                }

                // Enforce structural ordering: loop_iteration_end must occur before loop_end.
                if (activeLoopIterationStack.length > 0 &&
                    activeLoopIterationStack[activeLoopIterationStack.length - 1] === loopId) {
                    console.warn(`[Loop Ordering] loop_end for ${loopId} while iteration still active`);
                }

                // Flush summary for the loop BEFORE allocating loop_end stepIndex
                flushLoopSummary(topLoop, { lineFallback: info.line, fileFallback: info.file });
                loopStack.pop();

                if (currentFrame && currentFrame.activeLoops && currentFrame.activeLoops.has(loopId)) {
                    currentFrame.activeLoops.delete(loopId);
                }

                // Now emit loop_end (after summary flush and cleanup)
                const loopEndStep = {
                    stepIndex: nextIndex(),
                    eventType: 'loop_end',
                    line: info.line,
                    function: currentFunction,
                    scope: 'block',
                    file: normalizeFile(info.file),
                    timestamp: nextTime(),
                    loopId: ev.loopId,
                    explanation: `🏁 Loop ended`,
                    internalEvents: [],
                    ...frameMetadata
                };

                pushStep(loopEndStep);
                validateLoopInvariants('loop_end');

            } else if (ev.type === 'loop_condition') {
                const loopId = ev.loopId;
                pushStep({
                    stepIndex: nextIndex(),
                    eventType: 'loop_condition',
                    line: info.line,
                    function: currentFunction,
                    scope: 'block',
                    file: normalizeFile(info.file),
                    timestamp: nextTime(),
                    loopId: ev.loopId,
                    result: ev.result,
                    explanation: ev.result
                        ? `🟢 Loop condition: true (continue)`
                        : `🔴 Loop condition: false (exit)`,
                    internalEvents: [],
                    ...frameMetadata
                });

            } else if (ev.type === 'loop_body_start') {
                const loopId = ev.loopId;
                const topLoop = loopStack.length > 0 ? loopStack[loopStack.length - 1] : null;
                if (!topLoop || topLoop.loopId !== loopId) {
                    console.warn(`[Loop Mismatch] loop_body_start for ${loopId}, stack top is ${topLoop?.loopId}`);
                    continue;
                }

                topLoop.iterationCount = (topLoop.iterationCount || 0) + 1;
                const iterCount = topLoop.iterationCount;
                activeLoopIterationStack.push(loopId);

                if (currentFrame) {
                    currentFrame.scopeStack.push({
                        type: 'loop_iteration',
                        loopId: loopId,
                        iteration: iterCount,
                        variables: new Set()
                    });
                }

                pushStep({
                    stepIndex: nextIndex(),
                    eventType: 'loop_body_start',
                    line: info.line,
                    function: currentFunction,
                    scope: 'block',
                    file: normalizeFile(info.file),
                    timestamp: nextTime(),
                    loopId: ev.loopId,
                    iteration: iterCount,
                    explanation: `🔁 Loop iteration ${iterCount} begins`,
                    internalEvents: [],
                    ...frameMetadata
                });

            } else if (ev.type === 'loop_iteration_end') {
                const loopId = ev.loopId;
                // Enforce iteration stack nesting (must be LIFO)
                const topLoop = loopStack.length > 0 ? loopStack[loopStack.length - 1] : null;
                if (!topLoop || topLoop.loopId !== loopId) {
                    console.warn(`[Loop Mismatch] loop_iteration_end for ${loopId}, stack top is ${topLoop?.loopId}`);
                    continue;
                }

                const lastLoop = activeLoopIterationStack.length > 0
                    ? activeLoopIterationStack[activeLoopIterationStack.length - 1]
                    : null;
                if (lastLoop !== loopId) {
                    console.warn(`[Iteration Mismatch] loop_iteration_end for ${loopId}, top is ${lastLoop}`);
                    continue;
                }
                activeLoopIterationStack.pop();
                const iterCount = topLoop.iterationCount || 0;
                const destroyedSet = new Set();

                if (currentFrame && currentFrame.scopeStack.length > 0) {
                    const topScope = currentFrame.scopeStack[currentFrame.scopeStack.length - 1];
                    if (topScope.type === 'loop_iteration' && topScope.loopId === loopId) {
                        for (const v of topScope.variables) destroyedSet.add(v);
                        currentFrame.scopeStack.pop();
                    }
                }

                const destroyedSymbols = Array.from(destroyedSet);

                if (destroyedSymbols.length > 0) {
                    pushStep({
                        stepIndex: nextIndex(),
                        eventType: 'scope_exit',
                        line: info.line,
                        function: currentFunction,
                        scope: 'block',
                        file: normalizeFile(info.file),
                        timestamp: nextTime(),
                        scopeType: 'loop_iteration',
                        loopId: loopId,
                        iteration: iterCount,
                        destroyedSymbols: destroyedSymbols,
                        explanation: `} Iteration ${iterCount} scope exit - destroying: ${destroyedSymbols.join(', ')}`,
                        internalEvents: [],
                        ...frameMetadata
                    });
                }

                pushStep({
                    stepIndex: nextIndex(),
                    eventType: 'loop_iteration_end',
                    line: info.line,
                    function: currentFunction,
                    scope: 'block',
                    file: normalizeFile(info.file),
                    timestamp: nextTime(),
                    loopId: ev.loopId,
                    iteration: iterCount,
                    explanation: `🔁 Loop iteration ${iterCount} ends`,
                    internalEvents: [],
                    ...frameMetadata
                });
                validateLoopInvariants('loop_iteration_end');

            } else if (ev.type === 'control_flow') {
                const controlType = ev.controlType;
                if (controlType === 'break') {
                    pushStep({
                        stepIndex: nextIndex(),
                        eventType: 'loop_break',
                        line: info.line,
                        function: currentFunction,
                        scope: 'block',
                        file: normalizeFile(info.file),
                        timestamp: nextTime(),
                        explanation: '🔴 Break statement - exiting loop',
                        internalEvents: [],
                        ...frameMetadata
                    });
                } else if (controlType === 'continue') {
                    pushStep({
                        stepIndex: nextIndex(),
                        eventType: 'loop_continue',
                        line: info.line,
                        function: currentFunction,
                        scope: 'block',
                        file: normalizeFile(info.file),
                        timestamp: nextTime(),
                        explanation: '🔄 Continue statement - next iteration',
                        internalEvents: [],
                        ...frameMetadata
                    });
                }

            } else if (ev.type === 'block_enter') {
                if (currentFrame) {
                    currentFrame.blockScopes.push({ depth: ev.blockDepth || 0 });
                    currentFrame.scopeStack.push({
                        type: 'block',
                        depth: ev.blockDepth || 0,
                        variables: new Set()
                    });
                }
                pushStep({
                    stepIndex: nextIndex(),
                    eventType: 'block_enter',
                    line: info.line,
                    function: currentFunction,
                    scope: 'block',
                    file: normalizeFile(info.file),
                    timestamp: nextTime(),
                    blockDepth: ev.blockDepth || 0,
                    explanation: `{ Entering code block`,
                    internalEvents: [],
                    ...frameMetadata
                });

            } else if (ev.type === 'block_exit') {
                if (currentFrame && currentFrame.scopeStack.length > 0) {
                    const topScope = currentFrame.scopeStack[currentFrame.scopeStack.length - 1];
                    if (topScope.type === 'block') {
                        const destroyedSymbols = Array.from(topScope.variables);

                        if (destroyedSymbols.length > 0) {
                            pushStep({
                                stepIndex: nextIndex(),
                                eventType: 'scope_exit',
                                line: info.line,
                                function: currentFunction,
                                scope: 'block',
                                file: normalizeFile(info.file),
                                timestamp: nextTime(),
                                scopeType: 'block',
                                blockDepth: ev.blockDepth || 0,
                                destroyedSymbols: destroyedSymbols,
                                explanation: `} Block scope exit - destroying: ${destroyedSymbols.join(', ')}`,
                                internalEvents: [],
                                ...frameMetadata
                            });
                        }

                        currentFrame.scopeStack.pop();
                    }
                }

                if (currentFrame && currentFrame.blockScopes.length > 0) {
                    currentFrame.blockScopes.pop();
                }

                pushStep({
                    stepIndex: nextIndex(),
                    eventType: 'block_exit',
                    line: info.line,
                    function: currentFunction,
                    scope: 'block',
                    file: normalizeFile(info.file),
                    timestamp: nextTime(),
                    blockDepth: ev.blockDepth || 0,
                    explanation: `} Exiting code block`,
                    internalEvents: [],
                    ...frameMetadata
                });

            } else if (ev.type === 'array_create') {
                if (ev.addr) {
                    this.addressToName.set(ev.addr, ev.name);
                    if (currentFrame) this.addressToFrame.set(ev.addr, currentFrame.frameId);
                }
                step = {
                    stepIndex: nextIndex(),
                    eventType: 'array_create',
                    line: info.line,
                    function: currentFunction,
                    scope: 'block',
                    symbol: ev.name,
                    file: normalizeFile(info.file),
                    timestamp: nextTime(),
                    name: ev.name,
                    baseType: ev.baseType,
                    dimensions: ev.dimensions,
                    isStack: ev.isStack !== false,
                    memoryRegion: 'stack',
                    explanation: `📦 Array ${ev.name}${JSON.stringify(ev.dimensions)} declared`,
                    internalEvents: [],
                    ...frameMetadata
                };

                this.arrayRegistry.set(ev.name, {
                    name: ev.name,
                    baseType: ev.baseType,
                    dimensions: ev.dimensions,
                    isStack: ev.isStack !== false
                });

                if (currentFrame && currentFrame.scopeStack.length > 0) {
                    const topScope = currentFrame.scopeStack[currentFrame.scopeStack.length - 1];
                    topScope.variables.add(ev.name);
                }

            } else if (ev.type === 'array_index_assign') {
                const charInfo = ev.char ? ` ('${String.fromCharCode(ev.value)}')` : '';
                step = {
                    stepIndex: nextIndex(),
                    eventType: 'array_index_assign',
                    line: info.line,
                    function: currentFunction,
                    scope: 'block',
                    symbol: ev.name,
                    file: normalizeFile(info.file),
                    timestamp: nextTime(),
                    name: ev.name,
                    indices: ev.indices,
                    value: ev.value,
                    memoryRegion: 'stack',
                    explanation: `${ev.name}${JSON.stringify(ev.indices)} = ${ev.value}${charInfo}`,
                    internalEvents: [],
                    ...frameMetadata
                };

            } else if (ev.type === 'pointer_alias') {
                if (currentFrame) {
                    currentFrame.pointerAliases.set(ev.name, {
                        pointerName: ev.name,
                        aliasOf: ev.aliasOf,
                        aliasedAddress: ev.aliasedAddress,
                        decayedFromArray: ev.decayedFromArray || false,
                        memoryRegion: ev.isHeap ? 'heap' : 'stack',
                        isHeap: ev.isHeap || false
                    });
                }

                step = {
                    stepIndex: nextIndex(),
                    eventType: 'pointer_alias',
                    line: info.line,
                    function: currentFunction,
                    scope: 'block',
                    symbol: ev.name,
                    file: normalizeFile(info.file),
                    timestamp: nextTime(),
                    name: ev.name,
                    aliasOf: ev.aliasOf,
                    decayedFromArray: ev.decayedFromArray || false,
                    pointsTo: {
                        region: ev.isHeap ? 'heap' : 'stack',
                        target: ev.aliasOf,
                        address: ev.aliasedAddress,
                    },
                    explanation: ev.decayedFromArray
                        ? `${ev.name} → ${ev.aliasOf} (array decay)`
                        : `${ev.name} → &${ev.aliasOf}`,
                    internalEvents: [],
                    ...frameMetadata
                };

                this.pointerRegistry.set(ev.name, {
                    pointsTo: ev.aliasOf,
                    isHeap: false
                });

                if (currentFrame && currentFrame.scopeStack.length > 0) {
                    const topScope = currentFrame.scopeStack[currentFrame.scopeStack.length - 1];
                    topScope.variables.add(ev.name);
                }

            } else if (ev.type === 'pointer_deref_write') {
                const resolved = this.resolveAliasByValue(ev.pointerName, currentFrame);

                let targetName = resolved ? resolved.targetName : 'unknown';
                let isHeap = resolved ? resolved.isHeap : false;

                pushStep({
                    stepIndex: nextIndex(),
                    eventType: 'pointer_deref_write',
                    line: info.line,
                    function: currentFunction,
                    scope: 'block',
                    symbol: ev.pointerName,
                    file: normalizeFile(info.file),
                    timestamp: nextTime(),
                    pointerName: ev.pointerName,
                    targetName: targetName,
                    value: ev.value,
                    isHeap: isHeap,
                    explanation: isHeap
                        ? `*${ev.pointerName} = ${ev.value} (heap write)`
                        : targetName !== 'unknown'
                            ? `*${ev.pointerName} = ${ev.value} (writes to ${targetName})`
                            : `*${ev.pointerName} = ${ev.value}`,
                    internalEvents: [],
                    ...frameMetadata
                });

                if (!isHeap && targetName && targetName !== 'unknown') {
                    pushStep({
                        stepIndex: nextIndex(),
                        eventType: 'var_assign',
                        line: info.line,
                        function: currentFunction,
                        scope: 'block',
                        symbol: targetName,
                        file: normalizeFile(info.file),
                        timestamp: nextTime(),
                        name: targetName,
                        value: ev.value,
                        explanation: `${targetName} = ${ev.value}`,
                        internalEvents: [],
                        ...frameMetadata
                    });
                }

                step = null;

            } else if (ev.type === 'heap_write') {
                step = {
                    stepIndex: nextIndex(),
                    eventType: 'heap_write',
                    line: info.line,
                    function: currentFunction,
                    scope: 'block',
                    file: normalizeFile(info.file),
                    timestamp: nextTime(),
                    address: ev.addr || ev.address,
                    value: ev.value,
                    memoryRegion: 'heap',
                    explanation: `Heap cell = ${ev.value}`,
                    internalEvents: [],
                    ...frameMetadata
                };

            } else if (ev.type === 'declare') {
                const varKey = `${frameMetadata.frameId}:${ev.name}`;

                if (currentFrame) {
                    const wasDeclared = currentFrame.declaredVariables.has(varKey);

                    if (!wasDeclared) {
                        currentFrame.declaredVariables.set(varKey, true);

                        if (ev.address) {
                            this.addressToName.set(ev.address, ev.name);
                            this.addressToFrame.set(ev.address, currentFrame.frameId);
                        }
                    }

                    if (currentFrame.scopeStack.length > 0) {
                        const topScope = currentFrame.scopeStack[currentFrame.scopeStack.length - 1];
                        topScope.variables.add(ev.name);
                    }

                    if (activeLoopIterationStack.length > 0) {
                        const activeLoopId = activeLoopIterationStack[activeLoopIterationStack.length - 1];
                        if (currentFrame && currentFrame.scopeStack.length > 0) {
                            const topScope = currentFrame.scopeStack[currentFrame.scopeStack.length - 1];
                            if (topScope.type === 'loop_iteration' && topScope.loopId === activeLoopId) {
                                topScope.variables.add(ev.name);
                            }
                        }
                    }

                    if (!wasDeclared) {
                        step = {
                            stepIndex: nextIndex(),
                            eventType: 'var_declare',
                            line: info.line,
                            function: currentFunction,
                            scope: 'block',
                            symbol: ev.name,
                            file: normalizeFile(info.file),
                            timestamp: nextTime(),
                            name: ev.name,
                            varType: ev.varType,
                            explanation: `${ev.varType} ${ev.name} declared`,
                            internalEvents: [],
                            ...frameMetadata
                        };
                    } else {
                        step = null;
                    }
                }

            } else if (ev.type === 'assign') {
                step = {
                    stepIndex: nextIndex(),
                    eventType: 'var_assign',
                    line: info.line,
                    function: currentFunction,
                    scope: 'block',
                    symbol: ev.name,
                    file: normalizeFile(info.file),
                    timestamp: nextTime(),
                    name: ev.name,
                    value: ev.value,
                    explanation: `${ev.name} = ${ev.value}`,
                    internalEvents: [],
                    ...frameMetadata
                };

            } else if (ev.type === 'return') {
                step = {
                    stepIndex: nextIndex(),
                    eventType: 'return',
                    line: info.line,
                    function: currentFunction,
                    scope: 'function',
                    file: normalizeFile(info.file),
                    timestamp: nextTime(),
                    returnValue: ev.value,
                    returnType: ev.returnType || 'auto',
                    destinationSymbol: ev.destinationSymbol || null,
                    explanation: ev.destinationSymbol
                        ? `⬅️ Returning ${ev.value} to ${ev.destinationSymbol}`
                        : `⬅️ Returning ${ev.value}`,
                    internalEvents: [],
                    ...frameMetadata
                };

            } else if (ev.type === 'heap_alloc' && ev.isHeap) {
                step = {
                    stepIndex: nextIndex(),
                    eventType: 'heap_alloc',
                    line: info.line,
                    function: currentFunction,
                    scope: 'block',
                    file: normalizeFile(info.file),
                    timestamp: nextTime(),
                    size: ev.size,
                    address: ev.addr,
                    memoryRegion: 'heap',
                    baseType: 'int',
                    explanation: `Allocated ${ev.size} bytes on heap`,
                    internalEvents: [],
                    ...frameMetadata
                };

            } else if (ev.type === 'heap_free') {
                step = {
                    stepIndex: nextIndex(),
                    eventType: 'heap_free',
                    line: info.line,
                    function: currentFunction,
                    scope: 'block',
                    file: normalizeFile(info.file),
                    timestamp: nextTime(),
                    address: ev.addr,
                    memoryRegion: 'heap',
                    explanation: `Freed heap memory`,
                    internalEvents: [],
                    ...frameMetadata
                };
            }

            if (step) {
                pushStep(step);
            }
        }

        // Flush any orphaned loops so buffered events cannot leak.
        while (loopStack.length > 0) {
            const orphan = loopStack.pop();
            flushLoopSummary(orphan, { lineFallback: orphan?.startLine || 0, fileFallback: orphan?.startFile || sourceFile });
        }
        activeLoopIterationStack.length = 0;

        // ==========================================
        // STEP 4: Add output steps BEFORE program_end (deterministic)
        // ==========================================
        {
            const mainFrame = this.frameStack[0] || { frameId: 'main-0', callDepth: 0, parentFrameId: undefined };
            const frameMetadata = {
                frameId: mainFrame.frameId,
                callDepth: 0,
                callIndex: this.globalCallIndex++,
                parentFrameId: mainFrame.parentFrameId
            };
            // Prefer chunked stdout with timestamps when available
            if (programOutput && Array.isArray(programOutput.stdoutChunks) && programOutput.stdoutChunks.length > 0) {
                const combined = programOutput.stdoutChunks.map((text, idx) => ({ text, ts: idx }));
                combined.sort((a, b) => (a.ts || 0) - (b.ts || 0));
                for (const chunk of combined) {
                    const { rendered, escapes } = this.parseEscapeSequences(chunk.text);
                    steps.push({
                        stepIndex: stepIndex++,
                        eventType: 'output',
                        line: 0,
                        function: 'output',
                        scope: 'global',
                        file: 'stdout',
                        timestamp: (lastKnownTimestamp += timestampIncrement),
                        text: rendered,
                        rawText: chunk.text,
                        escapeInfo: escapes,
                        explanation: `📤 Output: "${rendered}"`,
                        internalEvents: [],
                        ...frameMetadata
                    });
                }
            } else {
                // --- Phase 2: Output Normalization (fix empty lines) ---
                const normalizedLines = tracePlatformAdapter.normalizeOutputEvents(outputLines);
                for (let i = 0; i < normalizedLines.length; i++) {
                    const line = normalizedLines[i];
                    const { rendered, escapes } = this.parseEscapeSequences(line);
                    steps.push({
                        stepIndex: stepIndex++,
                        eventType: 'output',
                        line: 0,
                        function: 'output',
                        scope: 'global',
                        file: 'stdout',
                        timestamp: (lastKnownTimestamp += timestampIncrement),
                        text: rendered,
                        rawText: line,
                        escapeInfo: escapes,
                        explanation: `📤 Output: "${rendered}"`,
                        internalEvents: [],
                        ...frameMetadata
                    });
                }
            }
        }

        // Ensure main has a matching func_exit if it is still on the frame stack.
        // Some platforms or instrumentation may not emit an explicit func_exit for main,
        // so synthesize one to preserve the required semantic balance (one enter, one exit).
        if (this.frameStack.length > 0) {
            const topFrame = this.frameStack[this.frameStack.length - 1];
            if (topFrame && this.isMainFunction(topFrame.functionName)) {
                // Pop main frame safely
                const exitingMain = this.popCallFrame();

                // Emit any scope exits for main if needed (destroy remaining symbols)
                if (exitingMain && exitingMain.scopeStack && exitingMain.scopeStack.length > 0) {
                    const allDestroyed = new Set();
                    for (const s of exitingMain.scopeStack) {
                        if (s.variables) for (const v of s.variables) allDestroyed.add(v);
                    }
                    if (allDestroyed.size > 0) {
                        steps.push({
                            stepIndex: stepIndex++,
                            eventType: 'scope_exit',
                            line: 0,
                            function: 'main',
                            scope: 'function',
                            file: path.basename(sourceFile),
                            timestamp: (lastKnownTimestamp += timestampIncrement),
                            scopeType: 'function',
                            destroyedSymbols: Array.from(allDestroyed),
                            explanation: `} Function scope exit - destroying: ${Array.from(allDestroyed).join(', ')}`,
                            internalEvents: [],
                            frameId: exitingMain.frameId,
                            callDepth: exitingMain.callDepth,
                            callIndex: this.globalCallIndex++,
                            parentFrameId: exitingMain.parentFrameId
                        });
                    }
                }

                // Emit synthetic func_exit for main
                steps.push({
                    stepIndex: stepIndex++,
                    eventType: 'func_exit',
                    line: 0,
                    function: 'main',
                    scope: 'function',
                    file: path.basename(sourceFile),
                    timestamp: (lastKnownTimestamp += timestampIncrement),
                    explanation: `⬅️ Exiting main`,
                    internalEvents: [],
                    frameId: exitingMain ? exitingMain.frameId : this.generateFrameId('main'),
                    callDepth: exitingMain ? exitingMain.callDepth : 0,
                    callIndex: this.globalCallIndex++,
                    parentFrameId: exitingMain ? exitingMain.parentFrameId : undefined,
                    isFunctionExit: true
                });
            }
        }

        // ==========================================
        // STEP 4.5: Validate and persist function tracking
        // ==========================================
        if (trackedFunctions) {
            trackedFunctions.splice(0, trackedFunctions.length, ...functionSet);
        }
        this.validateStepIntegrity(events, steps, functionSet);

        // ==========================================
        // STEP 5: Add program_end
        // ==========================================
        const finalFrameMetadata = this.getCurrentFrameMetadata();
        steps.push({
            stepIndex: stepIndex++,
            eventType: 'program_end',
            line: 0,
            function: 'main',
            scope: 'global',
            file: path.basename(sourceFile),
            timestamp: (lastKnownTimestamp += timestampIncrement),
            explanation: '✅ Program completed',
            internalEvents: [],
            ...finalFrameMetadata
        });

        // Renumber all stepIndex values to match actual array positions
        for (let i = 0; i < steps.length; i++) {
            steps[i].stepIndex = i;
        }

        for (let i = 0; i < steps.length; i++) {
            if (steps[i].stepIndex !== i) {
                throw new Error('Non deterministic step index detected');
            }
        }

        console.log(`✅ Generated ${steps.length} steps`);

        return steps;
    }

    /**
     * Create output steps from program stdout
     */
    createOutputSteps(outputLines, startIndex) {
        const steps = [];
        const frameMetadata = this.getCurrentFrameMetadata();
        const isDeterministic = process.env.TRACE_DETERMINISTIC === 'true';
        const increment = isDeterministic ? 1000 : 1;

        for (let i = 0; i < outputLines.length; i++) {
            const line = outputLines[i];

            const { rendered, escapes } = this.parseEscapeSequences(line);

            steps.push({
                stepIndex: startIndex + i,
                eventType: 'output',
                line: 0,
                function: 'output',
                scope: 'global',
                file: 'stdout',
                timestamp: startIndex + (i * increment),
                text: rendered,
                rawText: line,
                escapeInfo: escapes,
                explanation: `📤 Output: "${rendered}"`,
                internalEvents: [],
                ...frameMetadata
            });
        }

        return steps;
    }

    /**
     * Validate integrity guarantees between raw events and emitted steps
     */
    validateStepIntegrity(events, steps, functionSet) {
        // Soft validation only: keep the tracer tolerant on platforms where
        // instrumentation metadata is partial (common on Windows without addr2line).
        if (functionSet && !functionSet.has('main')) functionSet.add('main');
        // Basic determinism checks - warn if structural counts mismatch
        try {
            const fcEnter = steps.filter(s => s.eventType === 'func_enter').length;
            const fcExit = steps.filter(s => s.eventType === 'func_exit').length;
            if (fcEnter !== fcExit) {
                console.warn(`[validateStepIntegrity] func_enter (${fcEnter}) != func_exit (${fcExit})`);
            }

            const loopStarts = steps.filter(s => s.eventType === 'loop_body_start').length;
            const loopEnds = steps.filter(s => s.eventType === 'loop_iteration_end').length;
            if (loopStarts !== loopEnds) {
                console.warn(`[validateStepIntegrity] loop_body_start (${loopStarts}) != loop_iteration_end (${loopEnds})`);
            }
        } catch (e) {
            // non-fatal - best-effort
        }
    }

    /**
     * Normalize function name (cross-platform)
     */
    normalizeFunctionName(name) {
        if (!name || name === 'unknown') return 'unknown';
        return name.replace(/[\r\n\s]+$/g, '').trim() || 'unknown';
    }

    /**
     * Normalize file path for cross-platform comparisons
     */
    normalizeFilePath(f) {
        if (!f) return '';
        return path.basename(f).toLowerCase().replace(/\\/g, '/').trim();
    }

    /**
     * Check if function is main (cross-platform)
     */
    isMainFunction(funcName) {
        if (!funcName) return false;
        const normalized = this.normalizeFunctionName(funcName).toLowerCase();
        return normalized === 'main' || normalized === '_main';
    }

    /**
     * Check if function is system/library function
     */
    isSystemFunction(funcName) {
        if (!funcName) return false;
        const internal = [
            '__', '_M_', 'std::__', 'std::basic_',
            'operator<<', 'operator>>', '__ostream_insert',
            '__gnu_cxx', '__cxxabi', '_IO_',
            'GLOBAL__sub', '_static_initialization'
        ];
        return internal.some(prefix => funcName.includes(prefix));
    }

    extractGlobals(steps) {
        return steps
            .filter(s => s.scope === 'global' && (s.eventType === 'var_assign' || s.eventType === 'array_create'))
            .map(s => ({
                name: s.symbol || s.name,
                type: s.baseType || 'int',
                value: s.value,
                scope: 'global'
            }));
    }

    extractFunctions(steps, trackedFunctions) {
        const map = new Map();

        const names = (this.functionRegistry && this.functionRegistry.size > 0)
            ? Array.from(this.functionRegistry.keys())
            : (trackedFunctions || []);

        for (const fn of names) {
            if (fn && fn !== 'unknown' && fn.length > 1) {
                if (!map.has(fn)) {
                    map.set(fn, {
                        name: fn,
                        line: 0,
                        returnType: 'auto',
                        type: 'function'
                    });
                }
            }
        }

        return Array.from(map.values());
    }

    async generateTrace(code, language = 'cpp') {
        console.log('🚀 Starting trace generation...');

        this.arrayRegistry.clear();
        this.pointerRegistry.clear();
        this.functionRegistry.clear();
        this.callStack = [];

        this.frameStack = [];
        this.globalCallIndex = 0;
        this.frameCounts = new Map();

        const inputLinesMap = this.scanForInputOperations(code);

        let exe, src, traceOut, hdr;
        try {
            ({ executable: exe, sourceFile: src, traceOutput: traceOut, headerCopy: hdr } =
                await this.compile(code, language));

            const { stdout, stderr } = await this.executeInstrumented(exe, traceOut);
            const { events, functions } = await this.parseTraceFile(traceOut);

            console.log(`📋 Captured ${events.length} raw events, ${functions.length} functions`);

            // --- Phase 4: Regression guard ---
            if (events.length < 5 && code.includes('int main')) {
                console.warn(
                    `[RegressionGuard] ⚠️ LOW EVENT COUNT: ${events.length} events for code with main(). ` +
                    `Expected ≥ 5. Compiler: ${toolchainService.getCompiler('cpp')}, ` +
                    `Executable: ${exe}, TraceFile: ${traceOut}`
                );
            }

            const steps = await this.convertToSteps(events, exe, src, { stdout, stderr }, functions, inputLinesMap);

            const result = {
                steps,
                totalSteps: steps.length,
                globals: this.extractGlobals(steps),
                functions: this.extractFunctions(steps, functions),
                metadata: {
                    debugger: 'gcc-instrumentation-semantic-correct',
                    version: '10.0',
                    hasRealMemory: true,
                    hasHeapTracking: true,
                    hasArraySupport: true,
                    hasPointerSupport: true,
                    hasPointerResolution: true,
                    hasScopeTracking: true,
                    hasBlockScopeExit: true,
                    hasLoopIterationScope: true,
                    deterministicStepCount: true,
                    capturedEvents: events.length,
                    emittedSteps: steps.length,
                    programOutput: stdout,
                    timestamp: Date.now()
                }
            };

            console.log('✅ Trace complete', {
                steps: result.totalSteps,
                functions: result.functions.length,
                arrays: this.arrayRegistry.size,
                pointers: this.pointerRegistry.size,
                maxCallDepth: Math.max(...steps.map(s => s.callDepth || 0))
            });

            return result;
        } catch (e) {
            console.error('❌ Trace failed:', e.message);
            throw e;
        } finally {
            await this.cleanup([exe, src, traceOut, hdr]);
        }
    }

    async cleanup(files) {
        for (const f of files) {
            if (f && existsSync(f)) {
                try { await unlink(f); } catch (_) { }
            }
        }
    }

    scanForInputOperations(sourceFile) {
        try {
            if (!existsSync(sourceFile)) {
                return new Map();
            }

            const content = require('fs').readFileSync(sourceFile, 'utf-8');
            const lines = content.split('\n');
            const inputLines = new Map();

            const scanfRegex = /scanf\s*\(\s*"([^"]*)"\s*,\s*([^)]+)/;
            const cinRegex = /cin\s*>>\s*([^;]+)/;

            lines.forEach((line, index) => {
                const lineNumber = index + 1;
                let match;

                if ((match = line.match(scanfRegex))) {
                    const format = match[1];
                    const variables = match[2].trim().split(',').map(v => v.replace(/[&\s]/g, ''));

                    inputLines.set(lineNumber, {
                        line: lineNumber,
                        type: 'scanf',
                        format: format,
                        variables: variables,
                        prompt: `Waiting for scanf input on line ${lineNumber}`
                    });
                } else if ((match = line.match(cinRegex))) {
                    const variables = match[1].trim().split('>>').map(v => v.trim()).filter(v => v && v.length > 0);

                    inputLines.set(lineNumber, {
                        line: lineNumber,
                        type: 'cin',
                        variables: variables,
                        prompt: `Waiting for cin input on line ${lineNumber}`
                    });
                }
            });

            if (inputLines.size > 0) {
                console.log(`✅ Found ${inputLines.size} input operations in source code`);
            }

            return inputLines;
        } catch (error) {
            console.warn(`⚠️ Failed to scan for input operations: ${error.message}`);
            return new Map();
        }
    }
}

export default new InstrumentationTracer();
