// backend/src/services/instrumentation-tracer.service.js
import { spawn, execFileSync } from 'child_process';
import { writeFile, readFile, unlink, mkdir, copyFile } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { fileURLToPath } from 'url';
import codeInstrumenter from './code-instrumenter.service.js';
import controlFlowNormalizer from './control-flow-normalizer.service.js';
import inputRequirementsService from './input-requirements.service.js';
import { toolchainService } from './toolchain.service.js';
import { analyzeService } from './analyze.service.js';

import { tracePlatformAdapter } from './trace-platform-adapter.js';
import resourceResolver from './resource-resolver.service.js';

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
        // Use ResourceResolver for portable/packaged paths
        this.projectRoot = resourceResolver.getProjectRoot();
        this.resourcesRoot = resourceResolver.getResourcesRoot();
        this.tempDir = resourceResolver.getTempRoot();

        // Support both dev layout (backend/src/cpp) and prod layout (resources/cpp)
        // Note: this.projectRoot is typically the repo root in dev
        const devTracer = path.join(this.projectRoot, 'backend', 'src', 'cpp', 'tracer.cpp');
        const prodTracer = path.join(this.resourcesRoot, 'cpp', 'tracer.cpp');
        this.tracerCpp = existsSync(prodTracer) ? prodTracer : devTracer;

        const devHeader = path.join(this.projectRoot, 'backend', 'src', 'cpp', 'trace.h');
        const prodHeader = path.join(this.resourcesRoot, 'cpp', 'trace.h');
        this.traceHeader = existsSync(prodHeader) ? prodHeader : devHeader;

        console.log(`[TraceService] Temp directory: ${this.tempDir}`);
        console.log(`[TraceService] Tracer source: ${this.tracerCpp}`);

        this.ensureTempDir();

        this.arrayRegistry = new Map();
        this.pointerRegistry = new Map();
        this.functionRegistry = new Map();
        this.callStack = [];

        this.frameStack = [];
        this.globalCallIndex = 0;
        this.frameCounts = new Map();
        this.addressToName = new Map();
        this.addressResolutionCache = new Map();
        this.activeProcesses = new Set();
        this._stdoutLineBuffer = '';
    }

    /**
     * Resets all internal session-related state.
     * Essential for recovery after timeouts or errors to allow a fresh start ("reopen").
     */
    resetState() {
        console.log('[TraceService] Resetting internal session state...');
        this.arrayRegistry.clear();
        this.pointerRegistry.clear();
        this.functionRegistry.clear();
        this.callStack = [];
        this.frameStack = [];
        this.globalCallIndex = 0;
        this.frameCounts.clear();
        this.addressToName.clear();
        this.addressResolutionCache.clear();
        this._stdoutLineBuffer = '';
    }


    registerProcess(proc) {
        if (!proc) return;
        this.activeProcesses.add(proc);
        proc.on('close', () => this.activeProcesses.delete(proc));
        proc.on('error', () => this.activeProcesses.delete(proc));
    }

    stop() {
        console.log(`[TraceService] Stopping ${this.activeProcesses.size} active processes and resetting state...`);
        for (const proc of this.activeProcesses) {
            try {
                proc.kill('SIGKILL');
            } catch (e) {
                // ignore
            }
        }
        this.activeProcesses.clear();
        this.resetState();
    }


    async ensureTempDir() {
        if (!existsSync(this.tempDir)) {
            await mkdir(this.tempDir, { recursive: true });
        }
    }

    generateFrameId(functionName) {
        // Use globalCallIndex to ensure IDs are globally unique across recursion and replay
        return `${functionName}-${this.globalCallIndex++}`;
    }

    isMainFunction(name) {
        if (!name) return false;
        return name === 'main' || name === '::main' || name.endsWith('main');
    }

    getCurrentFrameMetadata() {
        if (this.frameStack.length === 0) {
            return {
                frameId: 'main-0',
                functionName: 'main',
                callDepth: 0,
                callIndex: this.globalCallIndex,
                parentFrameId: undefined,
                parentId: 'main-0',
                conditionId: null,
                loopId: null
            };
        }

        const current = this.frameStack[this.frameStack.length - 1];
        const activeConditionId = (current.conditionStack && current.conditionStack.length > 0)
            ? current.conditionStack[current.conditionStack.length - 1].conditionId
            : (current.activeConditionId || null);

        // FIX Bug 5: Use loopStack (proper LIFO array) instead of Map.keys().pop()
        const activeLoopId = (current.loopStack && current.loopStack.length > 0)
            ? current.loopStack[current.loopStack.length - 1]
            : (current.activeLoopId || null);

        return {
            frameId: current.frameId,
            functionName: current.functionName,
            callDepth: current.callDepth,
            callIndex: this.globalCallIndex,
            parentFrameId: current.parentFrameId,
            parentId: current.frameId,
            conditionId: activeConditionId,
            loopId: activeLoopId
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
            scopeStack: [],
            // FIX Bug 1: Inherit condition context from parent so recursive/nested
            // calls stay inside their branch container.
            conditionStack: parentFrame?.conditionStack ? [...parentFrame.conditionStack] : [],
            activeConditionId: parentFrame?.activeConditionId || null,
            // FIX Bug 2: Inherit loop context from parent so calls inside loops keep loopId.
            loopStack: parentFrame?.loopStack ? [...parentFrame.loopStack] : [],
            activeLoopId: parentFrame?.activeLoopId || null,
        };

        console.log('[FRAME PUSH]', frameId, 'cond:', frame.activeConditionId, 'loop:', frame.activeLoopId);

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
        if (!address) return { function: 'unknown', file: 'unknown', line: 0 };
        const cacheKey = `${executable}:${address}`;
        if (this.addressResolutionCache.has(cacheKey)) {
            return this.addressResolutionCache.get(cacheKey);
        }

        const candidates = [];
        if (process.platform === 'win32' && toolchainService.toolchainPath) {
            candidates.push(
                path.join(toolchainService.toolchainPath, 'llvm-addr2line.exe'),
                path.join(toolchainService.toolchainPath, 'addr2line.exe')
            );
        }
        candidates.push('addr2line');

        let result = null;
        for (const bin of candidates) {
            try {
                // eslint-disable-next-line no-await-in-loop
                const info = await new Promise((resolve) => {
                    const proc = spawn(bin, ['-e', executable, '-f', '-C', '-i', address]);
                    this.registerProcess(proc);
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
                if (info) {
                    result = info;
                    break;
                }
            } catch (err) {
                console.warn(`[LineInfo] Error running ${bin}: ${err.message}`);
                // try next candidate
            }
        }

        const finalInfo = result || {
            function: 'unknown',
            file: 'unknown',
            line: 0,
            isUnresolved: true
        };
        this.addressResolutionCache.set(cacheKey, finalInfo);
        return finalInfo;
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
                'conditional_start', 'conditional_branch',
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
        const isC = language === 'c';
        const userCompiler = toolchainService.getCompiler(isC ? 'c' : 'cpp');
        const tracerCompiler = toolchainService.getCompiler('cpp');
        const linkCompiler = toolchainService.getCompiler('cpp');
        const userStdFlag = isC ? '-std=c11' : '-std=c++17';
        const tracerStdFlag = '-std=c++17';
        const userIncludeFlags = toolchainService.getIncludeFlags(isC ? 'c' : 'cpp');
        const tracerIncludeFlags = toolchainService.getIncludeFlags('cpp');
        const linkerFlags = toolchainService.getLinkerFlags();

        // --- Step 1.3: Compiler validation (cross-platform safe) ---
        const compilerBasename = path.basename(linkCompiler).toLowerCase();
        if (compilerBasename.includes('clang-cl') || compilerBasename === 'cl.exe') {
            throw new TraceInstrumentationUnsupportedError(
                `Unsupported compiler: ${compilerBasename}. ` +
                `Only clang, clang++, gcc, g++ support -finstrument-functions.`
            );
        }

        const sourceOriginalFile = path.resolve(path.join(this.tempDir, `src_${sessionId}.${ext}`));
        const sourceNormalizedFile = path.resolve(path.join(this.tempDir, `src_${sessionId}.normalized.${ext}`));
        const sourceFile = path.resolve(path.join(this.tempDir, `src_${sessionId}.instrumented.${ext}`));
        const userObj = path.resolve(path.join(this.tempDir, `src_${sessionId}.o`));
        const tracerObj = path.resolve(path.join(this.tempDir, `tracer_${sessionId}.o`));
        const executable = path.resolve(path.join(this.tempDir, `exec_${sessionId}${process.platform === 'win32' ? '.exe' : ''}`));
        const traceOutput = path.resolve(path.join(this.tempDir, `trace_${sessionId}.json`));
        const headerCopy = path.resolve(path.join(this.tempDir, 'trace.h'));

        await writeFile(sourceOriginalFile, code, 'utf-8');

        const normalization = await controlFlowNormalizer.normalizeFile(
            sourceOriginalFile,
            language,
            sourceNormalizedFile
        );
        const instrumented = await codeInstrumenter.instrumentCode(normalization.code, language);

        await writeFile(sourceFile, instrumented, 'utf-8');
        await copyFile(this.traceHeader, headerCopy);

        // --- Step 1.3 + Phase 2: Normalize user compile flags via adapter ---
        const rawUserFlags = ['-c', '-g', '-O0', userStdFlag, '-fno-omit-frame-pointer',
            '-finstrument-functions', ...userIncludeFlags, ...toolchainService.getDeterministicFlags(), '-fno-inline'];
        const normalizedFlags = tracePlatformAdapter.normalizeCompileFlags(rawUserFlags);
        const userCompileArgs = [...normalizedFlags, sourceFile, '-o', userObj];

        if (!userCompileArgs.includes('-finstrument-functions')) {
            throw new TraceInstrumentationFailureError(
                '-finstrument-functions missing from user compile flags'
            );
        }

        // --- Step 1.2: Log exact compile command ---
        console.log('[Compile] User compile command:', userCompiler, userCompileArgs.join(' '));
        console.log('[Compile] Working directory:', this.tempDir);

        const compileUser = new Promise((resolve, reject) => {
            const p = spawn(userCompiler, userCompileArgs);
            this.registerProcess(p);
            let err = '';
            p.stderr.on('data', d => err += d.toString());
            p.on('close', code => code === 0 ? resolve() : reject(new Error(`User compile failed:\n${err}`)));
            p.on('error', e => reject(e));
        });

        const compileTracer = new Promise((resolve, reject) => {
            const disableInstrFlag = tracerCompiler.includes('clang') ? null : '-fno-instrument-functions';
            let tracerArgs = ['-c', '-g', '-O0', tracerStdFlag, '-fno-omit-frame-pointer',
                ...tracerIncludeFlags, ...toolchainService.getDeterministicFlags(), '-fno-inline', this.tracerCpp, '-o', tracerObj];
            if (disableInstrFlag) {
                tracerArgs = [
                    ...tracerArgs.slice(0, tracerArgs.length - 2),
                    disableInstrFlag,
                    ...tracerArgs.slice(tracerArgs.length - 2)
                ];
            }
            // --- Step 1.2: Log tracer compile command ---
            console.log('[Compile] Tracer compile command:', tracerCompiler, tracerArgs.join(' '));

            const p = spawn(tracerCompiler, tracerArgs);
            this.registerProcess(p);
            let err = '';
            p.stderr.on('data', d => err += d.toString());
            p.on('close', code => code === 0 ? resolve() : reject(new Error(`Tracer compile failed:\n${err}`)));
            p.on('error', e => reject(e));
        });

        const timeoutMs = 30000; // 30s timeout for compile/link
        const withTimeout = (promise, name) => Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => {
                console.warn(`[Compile] ${name} timed out. Killing processes...`);
                this.stop();
                reject(new Error(`${name} timed out (30s)`));
            }, timeoutMs))
        ]);

        await withTimeout(Promise.all([compileUser, compileTracer]), 'Compilation');
        await this.validateTracerObject(tracerObj);

        const linkArgs = [userObj, tracerObj, '-o', executable, ...linkerFlags];
        if (process.platform !== 'win32') linkArgs.unshift('-pthread', '-ldl');

        // --- Step 1.2: Log link command ---
        console.log('[Compile] Link command:', linkCompiler, linkArgs.join(' '));

        const linked = await withTimeout(new Promise((resolve, reject) => {
            const link = spawn(linkCompiler, linkArgs);
            this.registerProcess(link);
            let err = '';
            link.stderr.on('data', d => err += d.toString());
            link.on('close', code => {
                if (code === 0) {
                    resolve({
                        executable,
                        sourceFile,
                        sourceOriginalFile,
                        sourceNormalizedFile,
                        traceOutput,
                        headerCopy
                    });
                } else {
                    reject(new Error(`Linking failed:\n${err}`));
                }
            });
            link.on('error', e => reject(e));
        }), 'Linking');


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

    async executeInstrumented(executable, traceOutput, inputs = []) {
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
                stdio: ['pipe', 'pipe', 'pipe'],
                // use shell on Windows to ensure DLL resolution behaves consistently
                shell: process.platform === 'win32'
            });
            this.registerProcess(proc);

            const stdinValues = Array.isArray(inputs) ? inputs : (inputs == null ? [] : [inputs]);
            const stdinPayload = stdinValues.length > 0
                ? `${stdinValues.map(v => `${v ?? ''}`).join('\n')}\n`
                : '';
            try {
                if (stdinPayload.length > 0 && proc.stdin) {
                    proc.stdin.write(stdinPayload);
                }
                if (proc.stdin) {
                    proc.stdin.end();
                }
            } catch (e) {
                console.warn(`[Execute] Failed to write stdin payload: ${e.message}`);
            }

            let stdout = '', stderr = '';
            const stdoutChunks = [];
            const stdoutTimestamps = [];
            this._stdoutLineBuffer = '';

            proc.stdout.on('data', d => {
                const chunk = d.toString();
                this._stdoutLineBuffer += chunk;

                let newlineIndex;
                while ((newlineIndex = this._stdoutLineBuffer.indexOf('\n')) !== -1) {
                    const completeLine = this._stdoutLineBuffer.substring(0, newlineIndex + 1);
                    this._stdoutLineBuffer = this._stdoutLineBuffer.substring(newlineIndex + 1);

                    stdout += completeLine;
                    stdoutChunks.push(completeLine);
                    stdoutTimestamps.push(Date.now() * 1000);
                }
            });
            proc.stderr.on('data', d => stderr += d.toString());

            const timeout = setTimeout(() => {
                console.warn('[Execute] Execution timeout (10 s). Killing all related processes...');
                this.stop(); // Force kill everything and reset state
                reject(new Error('Execution timeout (10 s)'));
            }, 10000);

            timeout.unref();

            proc.on('close', async (code) => {
                clearTimeout(timeout);

                // Flush any remaining partial line
                if (this._stdoutLineBuffer.length > 0) {
                    stdout += this._stdoutLineBuffer;
                    stdoutChunks.push(this._stdoutLineBuffer);
                    stdoutTimestamps.push(Date.now() * 1000);
                    this._stdoutLineBuffer = '';
                }

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


    async convertToSteps(events, executable, sourceFile, programOutput, trackedFunctions, inputLinesMap = null, providedInputs = [], sourceNormalizedFile = null) {
        console.log(`📊 Converting ${events.length} events to beginner-correct steps...`);

        const steps = [];
        let stepIndex = 0;
        const isDeterministic = process.env.TRACE_DETERMINISTIC === 'true';
        const timestampIncrement = isDeterministic ? 1000 : 1;
        let lastKnownTimestamp = 0;
        let mainStarted = false;
        let currentFunction = 'main';
        let currentFrame = null;
        const emittedStepIds = new Set();
        // Maps raw integer conditionId (from tracer.cpp) to the stable string conditionId
        // used in ExecutionStep objects. Key format: "frameId:rawIntId"
        const rawConditionIdToStable = new Map();

        // Reset state
        this.frameStack = [];
        this.globalCallIndex = 0;
        this.frameCounts = new Map();
        this.functionRegistry.clear();
        this.addressToName.clear();

        const enterFunctionFrame = (functionName) => {
            const frame = this.pushCallFrame(functionName);
            currentFrame = frame || null;
            if (DEBUG_FRAME_VALIDATION) {
                console.log(`[Frame Stack] PUSH ${functionName}, stack depth=${this.frameStack.length}`);
            }
            return frame;
        };

        const exitFunctionFrame = (expectedName = null) => {
            if (this.frameStack.length === 0) {
                console.warn('[Frame Stack] Attempted to pop from empty stack');
                return null;
            }
            const top = this.frameStack[this.frameStack.length - 1];
            if (expectedName && top.functionName !== expectedName) {
                console.warn(`[Frame Stack] Popping ${top.functionName} but trace event expected ${expectedName}`);
            }
            const exiting = this.popCallFrame();
            currentFrame = this.frameStack[this.frameStack.length - 1] || null;
            if (DEBUG_FRAME_VALIDATION) {
                console.log(`[Frame Stack] POP ${exiting?.functionName}, stack depth=${this.frameStack.length}`);
            }
            return exiting;
        };

        // Parse program output
        const outputText = typeof programOutput?.stdout === 'string' ? programOutput.stdout : '';
        const outputLines = outputText.split('\n');
        const pendingOutputQueue = [];
        if (programOutput && Array.isArray(programOutput.stdoutChunks) && programOutput.stdoutChunks.length > 0) {
            for (let idx = 0; idx < programOutput.stdoutChunks.length; idx++) {
                const text = programOutput.stdoutChunks[idx];
                if (typeof text !== 'string' || text.length === 0) continue;
                const ts = Array.isArray(programOutput.stdoutTimestamps)
                    ? Number(programOutput.stdoutTimestamps[idx] || idx)
                    : idx;
                pendingOutputQueue.push({ text, ts });
            }
            pendingOutputQueue.sort((a, b) => (a.ts || 0) - (b.ts || 0));

            // FIX 3: Defensive merge pass (Part B)
            // Combine chunks that do not end with a newline to ensure one printf => one step.
            if (pendingOutputQueue.length > 1) {
                const mergedQueue = [];
                let currentChunk = null;

                for (const item of pendingOutputQueue) {
                    if (currentChunk === null) {
                        currentChunk = { ...item };
                    } else {
                        currentChunk.text += item.text;
                        // Keep the earlier timestamp
                    }

                    if (item.text.endsWith('\n')) {
                        mergedQueue.push(currentChunk);
                        currentChunk = null;
                    }
                }
                if (currentChunk !== null) {
                    mergedQueue.push(currentChunk);
                }
                pendingOutputQueue.length = 0;
                pendingOutputQueue.push(...mergedQueue);
            }
        } else {
            const normalizedLines = tracePlatformAdapter.normalizeOutputEvents(outputLines);
            for (let idx = 0; idx < normalizedLines.length; idx++) {
                const text = normalizedLines[idx];
                if (typeof text !== 'string' || text.length === 0) continue;
                pendingOutputQueue.push({ text, ts: idx });
            }
        }

        // Use provided inputLinesMap (from original code) or scan instrumented file
        const inputLines = inputLinesMap || this.scanForInputOperations(sourceFile);
        const pendingInputQueue = Array.isArray(providedInputs)
            ? providedInputs.map(v => `${v ?? ''}`)
            : [];

        // Track functions observed during conversion to keep tracked_functions populated
        const functionSet = new Set(trackedFunctions || []);

        // Normalize source file path for cross-platform comparison
        const normalizeFile = (f) => {
            if (!f) return '';
            return path.basename(f).toLowerCase().replace(/\\/g, '/').trim();
        };
        const userSourceBase = normalizeFile(sourceFile);

        const buildScopeDepthMap = async (filePath) => {
            if (!filePath || !existsSync(filePath)) return new Map();
            let content = '';
            try {
                content = await readFile(filePath, 'utf-8');
            } catch (_) {
                return new Map();
            }
            const lines = content.split(/\r?\n/);
            const map = new Map();
            let depth = 0;
            let inBlockComment = false;
            let inString = false;
            let inChar = false;
            let escape = false;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i] || '';
                let lineDepthStart = depth;
                let lineDepthMax = depth;
                let firstTokenSet = false;
                let inLineComment = false;

                for (let j = 0; j < line.length; j++) {
                    const c = line[j];
                    const next = j + 1 < line.length ? line[j + 1] : '';

                    if (inLineComment) break;
                    if (inBlockComment) {
                        if (c === '*' && next === '/') {
                            inBlockComment = false;
                            j += 1;
                        }
                        continue;
                    }
                    if (inString) {
                        if (escape) {
                            escape = false;
                            continue;
                        }
                        if (c === '\\') {
                            escape = true;
                            continue;
                        }
                        if (c === '"') {
                            inString = false;
                        }
                        continue;
                    }
                    if (inChar) {
                        if (escape) {
                            escape = false;
                            continue;
                        }
                        if (c === '\\') {
                            escape = true;
                            continue;
                        }
                        if (c === '\'') {
                            inChar = false;
                        }
                        continue;
                    }

                    if (c === '/' && next === '/') {
                        inLineComment = true;
                        break;
                    }
                    if (c === '/' && next === '*') {
                        inBlockComment = true;
                        j += 1;
                        continue;
                    }
                    if (c === '"') {
                        inString = true;
                        continue;
                    }
                    if (c === '\'') {
                        inChar = true;
                        continue;
                    }

                    if (!firstTokenSet && !/\s/.test(c)) {
                        if (c === '}') {
                            lineDepthStart = Math.max(0, depth - 1);
                        } else {
                            lineDepthStart = depth;
                        }
                        firstTokenSet = true;
                    }

                    if (c === '{') {
                        depth += 1;
                        lineDepthMax = Math.max(lineDepthMax, depth);
                    } else if (c === '}') {
                        depth = Math.max(0, depth - 1);
                    }
                }

                map.set(i + 1, { start: lineDepthStart, max: Math.max(lineDepthStart, lineDepthMax) });
            }
            return map;
        };

        // CRITICAL FIX: Build scope depth map from the INSTRUMENTED file (sourceFile),
        // because trace events carry line numbers from the instrumented file.
        // Using sourceNormalizedFile caused a line-number mismatch that put every
        // element at the wrong scope depth.
        const scopeDepthByLine = await buildScopeDepthMap(sourceFile);
        const computeHeaderInsertIndex = async (filePath) => {
            if (!filePath || !existsSync(filePath)) return null;
            let content = '';
            try {
                content = await readFile(filePath, 'utf-8');
            } catch (_) {
                return null;
            }
            // If trace.h is already present in the normalized source, there is no line shift.
            if (content.includes('trace.h')) return null;
            const lines = content.split(/\r?\n/);
            let insertIdx = 0;
            for (let i = 0; i < lines.length; i++) {
                const t = lines[i].trim();
                if (t.startsWith('#include')) {
                    insertIdx = i + 1;
                } else if (t && !t.startsWith('#') && !t.startsWith('//')) {
                    break;
                }
            }
            return insertIdx;
        };
        const headerInsertIdx = await computeHeaderInsertIndex(sourceNormalizedFile || sourceFile);
        const normalizeScopeLine = (lineNum) => {
            // No offset needed: we now build the scope depth map from the instrumented file directly.
            return lineNum;
        };

        // Precompute which input lines actually appear in trace events.
        // If a line never appears in events (e.g., plain scanf line), we will
        // emit the input step when we pass it.
        const eventLinesInUserFile = new Set();
        for (const ev of events) {
            if (!ev || !ev.line || !ev.file) continue;
            if (normalizeFile(ev.file) !== userSourceBase) continue;
            eventLinesInUserFile.add(ev.line);
        }
        const inputLinesWithEvents = new Set();
        for (const line of inputLines.keys()) {
            if (eventLinesInUserFile.has(line)) inputLinesWithEvents.add(line);
        }

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

        const isRuntimeCleanupEvent = (ev, info) => {
            const eventType = (ev.type || '').toLowerCase();
            const fn = this.normalizeFunctionName(info?.function || ev.func || '').toLowerCase();
            const file = normalizeFile(info?.file || ev.file || '').toLowerCase();

            if (eventType === 'heap_free') return true;
            if (fn.includes('operator delete')) return true;
            if ((file === '??' || file === 'unknown') && fn.startsWith('std::')) return true;
            if (file.includes('libc++') || file.includes('libstdc++')) return true;

            return false;
        };
        const pushStep = (step) => {
            if (!step || step.stepIndex === -1) return;
            this.globalCallIndex++;
            steps.push(step);
        };
        const nextTime = () => (lastKnownTimestamp += timestampIncrement);

        // NEW: Loop Buffering Stack
        const loopStack = [];
        // Track active loop iterations via the frame scope stack
        const activeLoopIterationStack = [];
        // Loop summary must never include structural events; expand set comprehensively.
        // condition_eval and branch_taken are included here because they must always
        // reach steps[] directly (they are needed by the LayoutEngine's control hierarchy).
        const STRUCTURAL_EVENTS = new Set([
            'func_enter', 'func_exit', 'return', 'scope_exit',
            'loop_start', 'loop_end', 'loop_body_start', 'loop_iteration_end', 'loop_condition', 'loop_body_summary',
            'block_enter', 'block_exit',
            'condition_eval', 'branch_taken', 'conditional_start', 'conditional_branch'
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

            pushStep({
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

        const emitOutputStep = ({ line, functionName, frameMetadata, fileName }) => {
            if (pendingOutputQueue.length === 0) return false;

            const nextOutput = pendingOutputQueue.shift();
            const rawText = nextOutput?.text ?? '';
            if (rawText.length === 0) return false;

            const { rendered, escapes } = this.parseEscapeSequences(rawText);
            pushStep({
                stepIndex: stepIndex++,
                eventType: 'output',
                line: line || 0,
                function: functionName || 'output',
                scope: 'block',
                file: normalizeFile(fileName || 'stdout'),
                timestamp: (lastKnownTimestamp += timestampIncrement),
                text: rendered,
                rawText,
                escapeInfo: escapes,
                explanation: `📤 Output: "${rendered}"`,
                internalEvents: [],
                ...(frameMetadata || this.getCurrentFrameMetadata())
            });

            return true;
        };

        const emitInputStep = ({ line, inputInfo, functionName, frameMetadata, fileName, nextIndex, nextTime, emit }) => {
            if (!inputInfo) return false;

            const inputRequest = {
                type: inputInfo.type,
                variables: inputInfo.variables,
                format: inputInfo.format || undefined,
                expectedTypes: inputInfo.expectedTypes || [],
                line
            };

            const consumedValues = (inputInfo.variables || []).map(() => {
                if (pendingInputQueue.length === 0) return '';
                return pendingInputQueue.shift();
            });
            const pairs = (inputInfo.variables || []).map((name, idx) => ({
                variable: name,
                value: consumedValues[idx] ?? ''
            }));
            const explainText = pairs.length > 0
                ? `INPUT RECEIVED: ${pairs.map(p => `${p.variable} = ${p.value}`).join(', ')}`
                : inputInfo.prompt;

            emit({
                stepIndex: nextIndex(),
                eventType: 'input',
                line,
                function: functionName || currentFunction,
                scope: 'block',
                file: normalizeFile(fileName || sourceFile),
                timestamp: nextTime(),
                explanation: explainText,
                value: consumedValues.length <= 1 ? (consumedValues[0] ?? '') : consumedValues,
                variable: (inputInfo.variables || [])[0] || '',
                inputRequest,
                inputValues: pairs,
                internalEvents: [],
                ...(frameMetadata || this.getCurrentFrameMetadata())
            });

            return true;
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
        const DEBUG_FRAME_VALIDATION = true;
        const validateFrameStack = (context = '') => {
            if (DEBUG_FRAME_VALIDATION) {
                const expectedDepth = this.frameStack.length;
                if (expectedDepth > 500) { // Arbitrary limit for sanity
                    console.warn(`[Frame Validation] Extremely deep stack detected (${expectedDepth}) at ${context}`);
                }
            }
        };

        // Proactively start main frame so Windows builds (where addr2line / function
        // names may be missing) still produce a consistent step sequence.
        stepIndex = 0;
        const mainFrameInit = enterFunctionFrame('main');
        functionSet.add('main');
        pushStep({
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
            parentId: mainFrameInit.frameId,
            isFunctionEntry: true
        });
        pushStep({
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
            callIndex: this.globalCallIndex,
            parentFrameId: mainFrameInit.parentFrameId,
            parentId: mainFrameInit.frameId,
            isFunctionEntry: true
        });
        mainStarted = true;
        currentFunction = 'main';

        for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            if (ev.type) ev.type = ev.type.toLowerCase();
            const isSyntheticReturnTempAssign =
                ev.type === 'assign' &&
                typeof ev.name === 'string' &&
                /^__rv_\d+$/.test(ev.name);
            if (isSyntheticReturnTempAssign) {
                continue;
            }

            // Get file/line info
            let info;
            if (ev.file && ev.line) {
                info = {
                    function: this.normalizeFunctionName(ev.func || 'unknown'),
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

            if (isRuntimeCleanupEvent(ev, info)) {
                continue;
            }

            const isEventNoise = isNoiseFunction(info);

            // Helpers to manage step increments conditionally
            const nextIndex = () => isEventNoise ? -1 : stepIndex++;

            // ==========================================
            // STEP 1: Detect main() entry
            // ==========================================
            // FIX: Also check ev.func === 'main' so that on Windows (where addr2line
            // may return 'unknown'), the first func_enter is still correctly consumed
            // and never handed off to the non-main handler below (which would push a
            // duplicate frame).
            if (!mainStarted && ev.type === 'func_enter' && (ev.func === 'main' || info.function === 'main')) {
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
                'conditional_start', 'conditional_branch',
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

            let step = null;

            // ==========================================
            // Process event types - Handle func_enter FIRST before frameMetadata
            // ==========================================

            if (ev.type === 'func_enter' && info.function !== 'main') {
                // Capture caller's metadata including conditionId before pushing new frame
                const parentMetadata = this.getCurrentFrameMetadata();

                // BUG 1 Fix: Defensive: also read directly from conditionStack top (in case activeConditionId is stale)
                const _parentFrame = this.frameStack[this.frameStack.length - 1];
                const _parentConditionId = (
                    _parentFrame?.conditionStack?.length > 0
                        ? _parentFrame.conditionStack[_parentFrame.conditionStack.length - 1].conditionId
                        : null
                ) || parentMetadata.conditionId || null;

                const _parentLoopId = (
                    _parentFrame?.loopStack?.length > 0
                        ? _parentFrame.loopStack[_parentFrame.loopStack.length - 1]
                        : null
                ) || parentMetadata.loopId || null;

                const newFrame = enterFunctionFrame(info.function);
                validateFrameStack(`Entering ${info.function}`);

                functionSet.add(info.function);
                currentFunction = info.function;

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
                    conditionId: _parentConditionId, // BUG 1 Fix: Inherit caller's active branch
                    loopId: _parentLoopId,
                    callDepth: newFrame.callDepth,
                    callIndex: newFrame.entryCallIndex,
                    parentFrameId: newFrame.parentFrameId,
                    parentId: newFrame.frameId,
                    isFunctionEntry: true
                });
                console.log('[ENTER]', newFrame.frameId, 'cond:', _parentConditionId, 'loop:', _parentLoopId);
                continue;
            }

            // For all other events, get frameMetadata from current state
            const isUserSource = info?.file && normalizeFile(info.file) === userSourceBase;
            let scopeDepth = 0;
            if (info?.line) {
                const scopeLine = normalizeScopeLine(info.line);
                const depthEntry = scopeDepthByLine.get(scopeLine);
                if (depthEntry) {
                    const controlEvalTypes = new Set([
                        'condition_eval',
                        'conditional_start',
                        'branch_taken',
                        'conditional_branch'
                    ]);
                    scopeDepth = controlEvalTypes.has(ev.type)
                        ? depthEntry.start
                        : depthEntry.max;
                }
            }
            currentFrame = this.frameStack[this.frameStack.length - 1]; // Use existing outer variable
            if (!isStructural && !isEventNoise && currentFrame && ev.addr && !this.isMainFunction(info.function)) {
                // Orphan event detection: if an event is credited to a frame that isn't the current top
                // though in this simple stack tracer, we assume the top is always correct.
            }
            const frameMetadata = { ...this.getCurrentFrameMetadata(), scopeDepth };

            // ===================================================================
            // Check if current position crosses an input operation and inject input
            // ===================================================================
            if (mainStarted && info?.line && info?.file && normalizeFile(info.file) === userSourceBase && inputLines.size > 0) {
                const linesToEmit = [];
                for (const [line] of inputLines.entries()) {
                    if (inputLinesWithEvents.has(line)) {
                        if (line === info.line) linesToEmit.push(line);
                    } else if (line < info.line) {
                        linesToEmit.push(line);
                    }
                }

                for (const line of linesToEmit) {
                    const inputInfo = inputLines.get(line);
                    emitInputStep({
                        line,
                        inputInfo,
                        functionName: currentFunction,
                        frameMetadata,
                        fileName: info.file,
                        nextIndex,
                        nextTime,
                        emit: pushStep
                    });
                    inputLines.delete(line);
                }
            }

            // ==========================================
            // Continue processing other event types
            // ==========================================

            if (ev.type === 'func_exit') {
                const exitingFrame = exitFunctionFrame(info.function);
                validateFrameStack(`Exiting ${info.function}`);

                if (!exitingFrame) {
                    continue;
                }

                // BUG 2 Fix: Preserve condition context for the exit/return steps using lastKnownConditionId fallback
                const frameConditionId = (
                    exitingFrame.conditionStack && exitingFrame.conditionStack.length > 0
                        ? exitingFrame.conditionStack[exitingFrame.conditionStack.length - 1].conditionId
                        : null
                ) || exitingFrame.activeConditionId || null;

                const frameLoopId = exitingFrame.activeLoops && exitingFrame.activeLoops.size > 0
                    ? Array.from(exitingFrame.activeLoops.keys()).pop()
                    : null;

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
                            callIndex: this.globalCallIndex, // PURE: remove ++
                            parentFrameId: exitingFrame.parentFrameId,
                            parentId: exitingFrame.frameId
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
                    conditionId: frameConditionId,
                    callDepth: exitingFrame.callDepth,
                    callIndex: this.globalCallIndex, // PURE: remove ++
                    parentFrameId: exitingFrame.parentFrameId,
                    parentId: exitingFrame.frameId,
                    isFunctionExit: true
                });
                console.log("[TRACE STEP]", "func_exit", "frame:", exitingFrame.frameId, "cond:", frameConditionId, "loop:", frameLoopId || null);

                if (exitingFrame.pendingReturn) {
                    const pr = exitingFrame.pendingReturn;
                    pushStep({
                        stepIndex: nextIndex(),
                        eventType: 'return',
                        line: pr.line || info.line,
                        function: pr.function || info.function,
                        scope: 'function',
                        file: normalizeFile(pr.file || info.file),
                        timestamp: nextTime(),
                        returnValue: pr.value,
                        returnType: pr.returnType || 'auto',
                        destinationSymbol: pr.destinationSymbol || null,
                        explanation: pr.destinationSymbol && pr.destinationSymbol !== '__expr'
                            ? `⬅️ return ${pr.value} (stored in ${pr.destinationSymbol})`
                            : `⬅️ return ${pr.value}`,
                        internalEvents: [],
                        frameId: exitingFrame.frameId,
                        conditionId: frameConditionId,
                        callDepth: exitingFrame.callDepth,
                        callIndex: this.globalCallIndex, // PURE: remove ++
                        parentFrameId: exitingFrame.parentFrameId,
                        parentId: exitingFrame.frameId
                    });
                    console.log("[TRACE STEP]", "return", "frame:", exitingFrame.frameId, "cond:", frameConditionId, "loop:", frameLoopId || null);
                }

                currentFunction = this.frameStack.length > 0
                    ? this.frameStack[this.frameStack.length - 1].functionName
                    : 'main';
                if (!currentFunction) currentFunction = 'main';
                continue;
            }

            if (ev.type === 'condition_eval') {
                // Skip if symbols failed
                if (info.isUnresolved) continue;

                // FIX: Stable condition IDs (frameId + line + callIndex)
                const conditionId = `cond-${frameMetadata.frameId}-${info.line}-${this.globalCallIndex}`;
                // Push to condition stack with the current block depth so we can
                // pop it precisely when its matching closing brace fires.
                if (currentFrame) {
                    const currentBlockDepth = (ev.blockDepth !== undefined)
                        ? ev.blockDepth
                        : (currentFrame.blockScopes.length);
                    // Safety guard: never push duplicate conditionId
                    const alreadyTracked = currentFrame.conditionStack.some(
                        e => e.conditionId === conditionId
                    );
                    if (!alreadyTracked) {
                        currentFrame.conditionStack.push({
                            conditionId,
                            blockDepthAtPush: currentBlockDepth
                        });
                    }
                    currentFrame.activeConditionId = conditionId;
                    // BUG 2 Fix: Snapshot: always track the most recent conditionId regardless of stack mutations
                    currentFrame.lastKnownConditionId = conditionId;
                    // Register raw integer id → stable string id so branch_taken can look it up
                    if (ev.conditionId !== undefined && ev.conditionId !== null) {
                        const rawKey = `${frameMetadata.frameId}:${ev.conditionId}`;
                        rawConditionIdToStable.set(rawKey, conditionId);
                    }
                }
                console.log('[COND START]', conditionId, 'frame:', frameMetadata.frameId, 'stack depth:', currentFrame?.conditionStack?.length);

                step = {
                    // FIX: ...frameMetadata FIRST so explicit fields below override inherited conditionId
                    ...frameMetadata,
                    stepIndex: nextIndex(),
                    eventType: 'condition_eval',
                    line: info.line,
                    function: frameMetadata.functionName || currentFunction,
                    scope: 'block',
                    file: normalizeFile(info.file),
                    timestamp: nextTime(),
                    conditionId: conditionId,
                    expression: ev.expression,
                    result: ev.result === 1,
                    controlRole: 'caller',
                    explanation: `🔍 Condition (${ev.expression}) = ${ev.result === 1 ? 'true' : 'false'}`,
                    internalEvents: []
                };
                console.log('[COND STEP conditionId]', step.conditionId, '| frameMetadata.conditionId:', frameMetadata.conditionId, '| expected:', conditionId);

            } else if (ev.type === 'conditional_start') {
                // Skip if symbols failed
                if (info.isUnresolved) continue;

                // FIX: Stable condition IDs
                const conditionId = `cond-${frameMetadata.frameId}-${info.line}-${this.globalCallIndex}`;
                // Push to condition stack with the current block depth
                if (currentFrame) {
                    const currentBlockDepth = (ev.blockDepth !== undefined)
                        ? ev.blockDepth
                        : (currentFrame.blockScopes.length);
                    const alreadyTracked = currentFrame.conditionStack.some(
                        e => e.conditionId === conditionId
                    );
                    if (!alreadyTracked) {
                        currentFrame.conditionStack.push({
                            conditionId,
                            blockDepthAtPush: currentBlockDepth
                        });
                    }
                    currentFrame.activeConditionId = conditionId;
                    // BUG 2 Fix: Snapshot: always track the most recent conditionId regardless of stack mutations
                    currentFrame.lastKnownConditionId = conditionId;
                    // Register raw integer id → stable string id so branch_taken can look it up
                    if (ev.conditionId !== undefined && ev.conditionId !== null) {
                        const rawKey = `${frameMetadata.frameId}:${ev.conditionId}`;
                        rawConditionIdToStable.set(rawKey, conditionId);
                    }
                }
                console.log('[COND START]', conditionId, 'frame:', frameMetadata.frameId, 'stack depth:', currentFrame?.conditionStack?.length);

                step = {
                    // FIX: ...frameMetadata FIRST so explicit fields below override inherited conditionId
                    ...frameMetadata,
                    stepIndex: nextIndex(),
                    eventType: 'conditional_start',
                    line: info.line,
                    function: frameMetadata.functionName || currentFunction,
                    scope: 'block',
                    file: normalizeFile(info.file),
                    timestamp: nextTime(),
                    conditionId: conditionId,
                    conditionType: ev.conditionType || 'switch',
                    expression: ev.expression,
                    controlRole: 'caller',
                    explanation: ev.conditionType === 'switch'
                        ? `🔀 switch (${ev.expression || ''})`
                        : `🔀 condition start (${ev.expression || ''})`,
                    internalEvents: []
                };

            } else if (ev.type === 'branch_taken') {
                // Prefer the raw integer conditionId from the trace event (most accurate).
                // Fall back to the condition stack top if the raw id is missing, or lastKnownConditionId
                // if the condition block just closed and popped the stack.
                let conditionId = frameMetadata.conditionId || (currentFrame ? currentFrame.lastKnownConditionId : null) || null;
                if (ev.conditionId !== undefined && ev.conditionId !== null) {
                    const rawKey = `${frameMetadata.frameId}:${ev.conditionId}`;
                    const stableId = rawConditionIdToStable.get(rawKey);
                    if (stableId) {
                        conditionId = stableId;
                    }
                }

                // Spread frameMetadata FIRST so our explicit conditionId overrides it below.
                step = {
                    ...frameMetadata,
                    stepIndex: nextIndex(),
                    eventType: 'branch_taken',
                    line: info.line,
                    function: frameMetadata.functionName || currentFunction,
                    scope: 'block',
                    file: normalizeFile(info.file),
                    timestamp: nextTime(),
                    conditionId: conditionId,
                    branchType: ev.branchType,
                    controlRole: 'body',
                    explanation: `➡️ Taking ${ev.branchType} branch`,
                    internalEvents: [],
                };

                // CRITICAL FIX: re-push conditionId onto conditionStack for the branch body.
                // block_exit (condition evaluation scope) pops the condition BEFORE branch_taken fires.
                // Without this, all events inside the branch body (including func_enter calls) see
                // an empty conditionStack and get conditionId: null.
                if (currentFrame && conditionId) {
                    const branchBodyDepth = (ev.blockDepth !== undefined)
                        ? ev.blockDepth
                        : currentFrame.blockScopes.length;
                    const alreadyTracked = currentFrame.conditionStack.some(
                        e => e.conditionId === conditionId
                    );
                    if (!alreadyTracked) {
                        currentFrame.conditionStack.push({
                            conditionId,
                            blockDepthAtPush: branchBodyDepth
                        });
                    }
                    currentFrame.activeConditionId = conditionId;
                    // Keep lastKnownConditionId in sync
                    currentFrame.lastKnownConditionId = conditionId;
                    console.log('[DEBUG BRANCH_TAKEN] Pushed conditionId:', conditionId, 'stack length:', currentFrame.conditionStack.length, 'depth:', branchBodyDepth);
                } else {
                    console.log('[DEBUG BRANCH_TAKEN] Failed to push. currentFrame:', !!currentFrame, 'conditionId:', conditionId);
                }

            } else if (ev.type === 'conditional_branch') {
                // Same lookup pattern as branch_taken.
                let conditionId = frameMetadata.conditionId;
                if (ev.conditionId !== undefined && ev.conditionId !== null) {
                    const rawKey = `${frameMetadata.frameId}:${ev.conditionId}`;
                    const stableId = rawConditionIdToStable.get(rawKey);
                    if (stableId) {
                        conditionId = stableId;
                    }
                }

                // Spread frameMetadata FIRST so conditionId below overrides it.
                step = {
                    ...frameMetadata,
                    stepIndex: nextIndex(),
                    eventType: 'conditional_branch',
                    line: info.line,
                    function: frameMetadata.functionName || currentFunction,
                    scope: 'block',
                    file: normalizeFile(info.file),
                    timestamp: nextTime(),
                    conditionId: conditionId,
                    label: ev.label,
                    isMatched: ev.isMatched,
                    isDeclaration: ev.isDeclaration,
                    caseIndex: ev.caseIndex,
                    fallsThrough: ev.fallsThrough,
                    controlRole: 'body',
                    explanation: ev.isDeclaration
                        ? `📌 case ${ev.label}`
                        : `➡️ case ${ev.label}`,
                    internalEvents: [],
                };

            } else if (ev.type === 'arg_bind') {
                step = {
                    stepIndex: nextIndex(),
                    eventType: 'arg_bind',
                    line: info.line,
                    function: frameMetadata.functionName || currentFunction,
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
                    function: frameMetadata.functionName || currentFunction,
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
                    // FIX Bug 5: Push to loopStack (proper LIFO) AND keep activeLoops for housekeeping.
                    currentFrame.activeLoops.set(loopId, { iterations: 0 });
                    if (!currentFrame.loopStack) currentFrame.loopStack = [];
                    currentFrame.loopStack.push(loopId);
                    currentFrame.activeLoopId = loopId;
                }
                console.log('[LOOP START]', loopId);

                const loopStep = {
                    stepIndex: nextIndex(),
                    eventType: 'loop_start',
                    line: info.line,
                    function: frameMetadata.functionName || currentFunction,
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

                if (currentFrame) {
                    // FIX Bug 5: Pop from loopStack and restore activeLoopId.
                    if (currentFrame.activeLoops && currentFrame.activeLoops.has(loopId)) {
                        currentFrame.activeLoops.delete(loopId);
                    }
                    if (currentFrame.loopStack && currentFrame.loopStack.length > 0) {
                        // Only pop if this loop is at the top (LIFO safety guard)
                        if (currentFrame.loopStack[currentFrame.loopStack.length - 1] === loopId) {
                            currentFrame.loopStack.pop();
                        }
                    }
                    currentFrame.activeLoopId = currentFrame.loopStack?.at(-1) || null;
                }

                // Now emit loop_end (after summary flush and cleanup)
                const loopEndStep = {
                    stepIndex: nextIndex(),
                    eventType: 'loop_end',
                    line: info.line,
                    function: frameMetadata.functionName || currentFunction,
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
                    function: frameMetadata.functionName || currentFunction,
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
                    function: frameMetadata.functionName || currentFunction,
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

                // FIX Bug 4: Do NOT pop conditionStack on loop_iteration_end.
                // A loop iteration does NOT own the condition context — conditions inside
                // the loop body are pushed/popped independently by condition_eval and func_exit.
                // Popping here caused every loop iteration to wipe out the conditionId, making
                // all subsequent iterations have conditionId: null.
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
                        function: frameMetadata.functionName || currentFunction,
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
                    function: frameMetadata.functionName || currentFunction,
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
                if (controlType === 'output_flush') {
                    emitOutputStep({
                        line: info.line,
                        functionName: currentFunction,
                        frameMetadata,
                        fileName: info.file
                    });
                } else if (controlType === 'break') {
                    pushStep({
                        stepIndex: nextIndex(),
                        eventType: 'loop_break',
                        line: info.line,
                        function: frameMetadata.functionName || currentFunction,
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
                        function: frameMetadata.functionName || currentFunction,
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
                    function: frameMetadata.functionName || currentFunction,
                    scope: 'block',
                    file: normalizeFile(info.file),
                    timestamp: nextTime(),
                    blockDepth: ev.blockDepth || 0,
                    explanation: `{ Entering code block`,
                    internalEvents: [],
                    ...frameMetadata
                });

            } else if (ev.type === 'block_exit') {
                // FIX 2: snapshot context BEFORE mutations
                const condBefore = currentFrame?.activeConditionId || null;
                const loopBefore = currentFrame?.activeLoopId || null;

                if (currentFrame && currentFrame.scopeStack.length > 0) {
                    const topScope = currentFrame.scopeStack[currentFrame.scopeStack.length - 1];
                    if (topScope.type === 'block') {
                        const destroyedSymbols = Array.from(topScope.variables);

                        if (destroyedSymbols.length > 0) {
                            pushStep({
                                stepIndex: nextIndex(),
                                eventType: 'scope_exit',
                                line: info.line,
                                function: frameMetadata.functionName || currentFunction,
                                scope: 'block',
                                file: normalizeFile(info.file),
                                timestamp: nextTime(),
                                scopeType: 'block',
                                blockDepth: ev.blockDepth || 0,
                                destroyedSymbols: destroyedSymbols,
                                explanation: `} Block scope exit - destroying: ${destroyedSymbols.join(', ')}`,
                                internalEvents: [],
                                ...frameMetadata,
                                conditionId: condBefore,
                                loopId: loopBefore
                            });
                        }

                        currentFrame.scopeStack.pop();
                        // Pop any conditions whose block scope has now closed.
                        // A condition pushed at blockDepth N is "done" when we exit
                        // a block that brings depth back to < N.
                        if (currentFrame.conditionStack && currentFrame.conditionStack.length > 0) {
                            const exitingBlockDepth = ev.blockDepth !== undefined
                                ? ev.blockDepth
                                : (currentFrame.blockScopes.length);
                            // Pop all conditions that were opened at a depth deeper than exitingBlockDepth
                            while (
                                currentFrame.conditionStack.length > 0 &&
                                currentFrame.conditionStack[currentFrame.conditionStack.length - 1].blockDepthAtPush >= exitingBlockDepth
                            ) {
                                currentFrame.conditionStack.pop();
                            }
                            // Update activeConditionId to new stack top
                            currentFrame.activeConditionId = currentFrame.conditionStack.length > 0
                                ? currentFrame.conditionStack[currentFrame.conditionStack.length - 1].conditionId
                                : null;
                        }
                    }
                }

                if (currentFrame && currentFrame.blockScopes.length > 0) {
                    currentFrame.blockScopes.pop();
                }

                pushStep({
                    stepIndex: nextIndex(),
                    eventType: 'block_exit',
                    line: info.line,
                    function: frameMetadata.functionName || currentFunction,
                    scope: 'block',
                    file: normalizeFile(info.file),
                    timestamp: nextTime(),
                    blockDepth: ev.blockDepth || 0,
                    explanation: `} Exiting code block`,
                    internalEvents: [],
                    ...frameMetadata,
                    conditionId: condBefore,
                    loopId: loopBefore
                });

                // CLOSE CONDITION WHEN BLOCK ENDS
if (currentFrame && currentFrame.conditionStack && currentFrame.conditionStack.length > 0) {

    const closedCond = currentFrame.conditionStack.pop();

    currentFrame.activeConditionId =
        currentFrame.conditionStack.length > 0
            ? currentFrame.conditionStack[currentFrame.conditionStack.length - 1].conditionId
            : null;

    console.log(
        '[COND END]',
        closedCond?.conditionId,
        'frame:',
        currentFrame.frameId,
        'remaining:',
        currentFrame.conditionStack.length
    );
}

            } else if (ev.type === 'array_create') {
                if (ev.addr) {
                    this.addressToName.set(ev.addr, ev.name);
                }
                step = {
                    stepIndex: nextIndex(),
                    eventType: 'array_create',
                    line: info.line,
                    function: frameMetadata.functionName || currentFunction,
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
                    function: frameMetadata.functionName || currentFunction,
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
                    function: frameMetadata.functionName || currentFunction,
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
                    function: frameMetadata.functionName || currentFunction,
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
                        function: frameMetadata.functionName || currentFunction,
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
                    function: frameMetadata.functionName || currentFunction,
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
                            function: frameMetadata.functionName || currentFunction,
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
                    function: frameMetadata.functionName || currentFunction,
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
                if (currentFrame) {
                    currentFrame.pendingReturn = {
                        value: ev.value,
                        returnType: ev.returnType,
                        destinationSymbol: ev.destinationSymbol,
                        line: info.line,
                        function: frameMetadata.functionName || currentFunction,
                        file: info.file
                    };
                }
                step = null;

            } else if (ev.type === 'heap_alloc' && ev.isHeap) {
                step = {
                    stepIndex: nextIndex(),
                    eventType: 'heap_alloc',
                    line: info.line,
                    function: frameMetadata.functionName || currentFunction,
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
                    function: frameMetadata.functionName || currentFunction,
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
        // STEP 4: Emit any output that did not match output_flush anchors
        // ==========================================
        while (pendingOutputQueue.length > 0) {
            emitOutputStep({
                line: 0,
                functionName: currentFunction || 'main',
                frameMetadata: this.getCurrentFrameMetadata(),
                fileName: sourceFile
            });
        }

        // Ensure main has a matching func_exit if it is still on the frame stack.
        // Some platforms or instrumentation may not emit an explicit func_exit for main,
        // so synthesize one to preserve the required semantic balance (one enter, one exit).
        if (this.frameStack.length > 0) {
            const topFrame = this.frameStack[this.frameStack.length - 1];
            if (topFrame && this.isMainFunction(topFrame.functionName)) {
                // Pop main frame safely
                const exitingMain = exitFunctionFrame();

                // Emit any scope exits for main if needed (destroy remaining symbols)
                if (exitingMain && exitingMain.scopeStack && exitingMain.scopeStack.length > 0) {
                    const allDestroyed = new Set();
                    for (const s of exitingMain.scopeStack) {
                        if (s.variables) for (const v of s.variables) allDestroyed.add(v);
                    }
                    if (allDestroyed.size > 0) {
                        pushStep({
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
                            callIndex: this.globalCallIndex, // PURE: remove ++
                            parentFrameId: exitingMain.parentFrameId,
                            parentId: exitingMain.frameId
                        });
                    }
                }

                // Emit synthetic func_exit for main
                pushStep({
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
                    callIndex: this.globalCallIndex,
                    parentFrameId: exitingMain ? exitingMain.parentFrameId : undefined,
                    parentId: exitingMain ? exitingMain.frameId : 'main-0',
                    isFunctionExit: true
                });
            }
        }

        // Emit any remaining input steps (no matching trace line found).
        if (inputLines.size > 0 && mainStarted) {
            const fallbackNextIndex = () => stepIndex++;
            const fallbackNextTime = () => (lastKnownTimestamp += timestampIncrement);
            for (const [line, inputInfo] of inputLines.entries()) {
                emitInputStep({
                    line,
                    inputInfo,
                    functionName: currentFunction,
                    frameMetadata: this.getCurrentFrameMetadata(),
                    fileName: sourceFile,
                    nextIndex: fallbackNextIndex,
                    nextTime: fallbackNextTime,
                    emit: (step) => pushStep(step)
                });
            }
            inputLines.clear();
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
        pushStep({
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

        if (process.env.CODEVIZ_TRACE_VALIDATE === '1') {
            this.validateGeneratedSteps(steps);
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

    validateGeneratedSteps(steps) {
        let lastType = null;
        for (const step of steps) {
            // Verify branch_taken has conditionId
            if (step.eventType === 'branch_taken') {
                if (!step.conditionId) {
                    console.warn(`TRACE WARNING: branch_taken missing conditionId at index ${step.stepIndex}`);
                }
            }

            // Verify frameId exists for structural events
            const needsFrameId = ['func_enter', 'func_exit', 'return', 'assign', 'branch_taken'];
            if (needsFrameId.includes(step.eventType)) {
                if (!step.frameId) {
                    console.warn(`TRACE WARNING: ${step.eventType} missing frameId at index ${step.stepIndex}`);
                }
            }

            // Verify event ordering - e.g. condition_eval followed by branch_taken
            if (lastType === 'condition_eval' && step.eventType !== 'branch_taken') {
                // Not necessarily wrong if there are intermediate assignments, but wait, condition_eval and branch_taken should be adjacent?
                // Depending on trace implementation, they might have pointer aliases but usually branch_taken is right after condition_eval.
            }

            lastType = step.eventType;
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

    async generateTrace(code, language = 'cpp', inputs = []) {
        console.log('🚀 Starting trace generation...');

        this.arrayRegistry.clear();
        this.pointerRegistry.clear();
        this.functionRegistry.clear();
        this.callStack = [];

        this.frameStack = [];
        this.globalCallIndex = 0;
        this.frameCounts = new Map();

        const syntaxResult = await analyzeService.validateSyntax({ code, language });
        if (!syntaxResult.valid) {
            const errorMsg = syntaxResult.errors.map(e => `[Line ${e.line}] ${e.message}`).join('\n');
            throw new Error(`Syntax Error:\n${errorMsg}`);
        }

        const inputAnalysis = inputRequirementsService.analyzeInputRequirements(code, language);
        const normalizedInputs = inputRequirementsService.normalizeProvidedInputs(
            inputs,
            inputAnalysis.requirements
        );
        if (normalizedInputs.warnings.length > 0) {
            console.warn(`[Input] ${normalizedInputs.warnings.join(' | ')}`);
        }

        const rawInputLinesMap = this.scanForInputOperations(code, language);
        const inputLinesMap = this._adjustInputLinesMapForHeader(code, rawInputLinesMap);

        let exe, src, srcOriginal, srcNormalized, traceOut, hdr;
        try {
            ({
                executable: exe,
                sourceFile: src,
                sourceOriginalFile: srcOriginal,
                sourceNormalizedFile: srcNormalized,
                traceOutput: traceOut,
                headerCopy: hdr
            } =
                await this.compile(code, language));

            const { stdout, stderr, stdoutChunks, stdoutTimestamps } = await this.executeInstrumented(
                exe,
                traceOut,
                normalizedInputs.values
            );
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

            const steps = await this.convertToSteps(
                events,
                exe,
                src,
                { stdout, stderr, stdoutChunks, stdoutTimestamps },
                functions,
                inputLinesMap,
                normalizedInputs.values,
                srcNormalized
            );

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
                    providedInputCount: normalizedInputs.values.length,
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
            await this.cleanup([exe, src, srcOriginal, srcNormalized, traceOut, hdr]);
        }
    }

    async cleanup(files) {
        for (const f of files) {
            if (f && existsSync(f)) {
                try { await unlink(f); } catch (_) { }
            }
        }
    }

    _adjustInputLinesMapForHeader(originalCode, inputLinesMap) {
        if (inputLinesMap.size === 0) return inputLinesMap;
        // If the code already has trace.h, addTraceHeader() is a no-op — no shift needed
        if (originalCode.includes('trace.h')) return inputLinesMap;

        // Replicate addTraceHeader's insertIdx logic exactly
        const lines = originalCode.split('\n');
        let insertIdx = 0;
        for (let i = 0; i < lines.length; i++) {
            const t = lines[i].trim();
            if (t.startsWith('#include')) { insertIdx = i + 1; }
            else if (t && !t.startsWith('#') && !t.startsWith('//')) break;
        }

        // insertIdx is 0-based. Original 1-based line L shifts to L+1
        // when its 0-based index (L-1) >= insertIdx  =>  L > insertIdx
        const adjusted = new Map();
        for (const [lineNum, info] of inputLinesMap.entries()) {
            const newLine = lineNum > insertIdx ? lineNum + 1 : lineNum;
            adjusted.set(newLine, { ...info, line: newLine });
        }
        console.log(`[InputLinesFix] Header at idx ${insertIdx}; adjusted ${inputLinesMap.size} scanf entries`);
        return adjusted;
    }

    scanForInputOperations(sourceOrCode, language = 'c') {
        try {
            const content = existsSync(sourceOrCode)
                ? readFileSync(sourceOrCode, 'utf-8')
                : (typeof sourceOrCode === 'string' ? sourceOrCode : '');
            if (!content) return new Map();

            const inputLines = new Map();
            const analysis = inputRequirementsService.analyzeInputRequirements(content, language);
            const groupedByLine = new Map();
            for (const req of analysis.requirements) {
                if (!groupedByLine.has(req.line)) groupedByLine.set(req.line, []);
                groupedByLine.get(req.line).push(req);
            }
            for (const [lineNumber, reqs] of groupedByLine.entries()) {
                const variables = reqs.map(r => r.variable);
                const expectedTypes = reqs.map(r => r.type);
                inputLines.set(lineNumber, {
                    line: lineNumber,
                    type: reqs[0]?.callType || 'scanf',
                    format: reqs[0]?.format || '',
                    variables,
                    expectedTypes,
                    requests: reqs,
                    prompt: `INPUT RECEIVED (${variables.join(', ')})`
                });
            }

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
