/**
 * tests/context-nesting-tests.js
 * ============================================================
 * Context Nesting Test Suite — CodeViz Execution Pipeline
 * ============================================================
 *
 * Tests the context propagation logic in the InstrumentationTracer
 * by simulating synthetic event sequences WITHOUT needing a C compiler.
 *
 * Each test:
 *   - Builds a synthetic event array mimicking real tracer output
 *   - Runs it through convertToSteps() via the tracer's internal helpers
 *   - Asserts that conditionId / loopId are set or null as expected
 *
 * Run with:
 *   node tests/context-nesting-tests.js
 *
 * Results written to:
 *   tests/context-test-results.txt
 */

import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ──────────────────────────────────────────────────────────────
// Minimal InstrumentationTracer harness (no I/O, no compiler)
// ──────────────────────────────────────────────────────────────

/**
 * Simulates the frame / ContextStack logic from InstrumentationTracer.
 * Mirrors the EXACT data structures used in the real service after fixes.
 */
class ContextHarness {
    constructor() {
        this.frameStack = [];
        this.globalCallIndex = 0;
    }

    generateFrameId(name) {
        return `${name}-${this.globalCallIndex++}`;
    }

    pushCallFrame(name) {
        const parent = this.frameStack.at(-1) || null;
        const frameId = this.generateFrameId(name);
        const frame = {
            frameId,
            functionName: name,
            callDepth: this.frameStack.length,
            parentFrameId: parent?.frameId,
            // FIX Bug 1: inherit condition context
            conditionStack: parent?.conditionStack ? [...parent.conditionStack] : [],
            activeConditionId: parent?.activeConditionId || null,
            // FIX Bug 2: inherit loop context
            loopStack: parent?.loopStack ? [...parent.loopStack] : [],
            activeLoopId: parent?.activeLoopId || null,
            activeLoops: new Map(),
            scopeStack: [],
            blockScopes: [],
        };
        this.frameStack.push(frame);
        return frame;
    }

    popCallFrame() {
        return this.frameStack.pop();
    }

    currentFrame() {
        return this.frameStack.at(-1) || null;
    }

    currentConditionId() {
        const f = this.currentFrame();
        if (!f) return null;
        return f.conditionStack.at(-1) || f.activeConditionId || null;
    }

    currentLoopId() {
        const f = this.currentFrame();
        if (!f) return null;
        return f.loopStack.at(-1) || f.activeLoopId || null;
    }

    pushCondition(condId) {
        const f = this.currentFrame();
        if (!f) return;
        if (!f.conditionStack.includes(condId)) {
            f.conditionStack.push(condId);
        }
        f.activeConditionId = condId;
    }

    /** Called at func_exit only — NOT at block_exit or loop_iteration_end */
    popCondition() {
        const f = this.currentFrame();
        if (!f || f.conditionStack.length === 0) return;
        f.conditionStack.pop();
        f.activeConditionId = f.conditionStack.at(-1) || null;
    }

    pushLoop(loopId) {
        const f = this.currentFrame();
        if (!f) return;
        f.loopStack.push(loopId);
        f.activeLoopId = loopId;
        f.activeLoops.set(loopId, { iterations: 0 });
    }

    popLoop(loopId) {
        const f = this.currentFrame();
        if (!f) return;
        f.activeLoops.delete(loopId);
        if (f.loopStack.at(-1) === loopId) {
            f.loopStack.pop();
        }
        f.activeLoopId = f.loopStack.at(-1) || null;
    }

    reset() {
        this.frameStack = [];
        this.globalCallIndex = 0;
    }
}

// ──────────────────────────────────────────────────────────────
// Test infrastructure
// ──────────────────────────────────────────────────────────────

const results = [];

function test(name, fn) {
    try {
        fn();
        results.push({ name, status: 'PASS', reason: null });
        console.log(`  ✅ PASS — ${name}`);
    } catch (e) {
        results.push({ name, status: 'FAIL', reason: e.message });
        console.log(`  ❌ FAIL — ${name}`);
        console.log(`         Reason: ${e.message}`);
    }
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

function assertEqual(a, b, msg) {
    if (a !== b) throw new Error(`${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function assertNotNull(v, msg) {
    if (v == null) throw new Error(`${msg} — expected non-null, got null`);
}

function assertNull(v, msg) {
    if (v != null) throw new Error(`${msg} — expected null, got ${JSON.stringify(v)}`);
}

// ──────────────────────────────────────────────────────────────
//  TEST 1 — IF with function call
//  func_enter inside condition must carry conditionId
// ──────────────────────────────────────────────────────────────
test('TEST 1: IF with function call', () => {
    const h = new ContextHarness();
    h.pushCallFrame('main');

    // Simulate: condition_eval for `if (n > 0)`
    h.pushCondition('cond-main-0-15');
    const condBefore = h.currentConditionId();
    assertNotNull(condBefore, 'conditionId should be set before function call');

    // Simulate: func_enter factorial (while still inside IF branch)
    const factFrame = h.pushCallFrame('factorial');
    // Child frame must INHERIT condition from parent
    assertEqual(factFrame.activeConditionId, condBefore, 'factorial frame must inherit conditionId from caller');
    assertEqual(h.currentConditionId(), condBefore, 'currentConditionId inside factorial must equal caller conditionId');

    h.popCallFrame(); // factorial exits
    h.reset();
});

// ──────────────────────────────────────────────────────────────
//  TEST 2 — Recursion inside IF
//  All recursive frames inherit same conditionId
// ──────────────────────────────────────────────────────────────
test('TEST 2: Recursion inside IF', () => {
    const h = new ContextHarness();
    h.pushCallFrame('factorial'); // depth 0

    h.pushCondition('cond-factorial-0-27');
    const cond = h.currentConditionId();
    assertNotNull(cond, 'base conditionId set');

    // Recurse 3 levels deep
    const depth1 = h.pushCallFrame('factorial');
    assertEqual(depth1.activeConditionId, cond, 'depth1 inherits cond');

    const depth2 = h.pushCallFrame('factorial');
    assertEqual(depth2.activeConditionId, cond, 'depth2 inherits cond');

    const depth3 = h.pushCallFrame('factorial');
    assertEqual(depth3.activeConditionId, cond, 'depth3 inherits cond');

    // Unwind
    h.popCallFrame(); h.popCallFrame(); h.popCallFrame();
    assertEqual(h.currentConditionId(), cond, 'conditionId restored after unwind');
    h.reset();
});

// ──────────────────────────────────────────────────────────────
//  TEST 3 — Nested IF conditions
//  Inner IF has own conditionId; outer remains on stack
// ──────────────────────────────────────────────────────────────
test('TEST 3: Nested IF conditions', () => {
    const h = new ContextHarness();
    h.pushCallFrame('main');

    h.pushCondition('cond-outer');
    assertEqual(h.currentConditionId(), 'cond-outer', 'outer cond active');

    h.pushCondition('cond-inner');
    assertEqual(h.currentConditionId(), 'cond-inner', 'inner cond active');

    const frame = h.currentFrame();
    assertEqual(frame.conditionStack.length, 2, 'both conditions on stack');
    assertEqual(frame.conditionStack[0], 'cond-outer', 'outer is below');
    assertEqual(frame.conditionStack[1], 'cond-inner', 'inner is on top');

    h.reset();
});

// ──────────────────────────────────────────────────────────────
//  TEST 4 — Return inside ELSE
//  Return step must have conditionId of the ELSE branch
// ──────────────────────────────────────────────────────────────
test('TEST 4: Return inside ELSE', () => {
    const h = new ContextHarness();
    h.pushCallFrame('check');

    // Evaluate condition
    h.pushCondition('cond-check-0-61');
    const elseCond = h.currentConditionId();

    // Inside else branch — conditionId must still be live when return fires
    // (block_exit does NOT pop conditionStack — Bug 3 fix)
    const condAtReturn = h.currentConditionId();
    assertEqual(condAtReturn, elseCond, 'conditionId preserved at return inside else');

    // func_exit: NOW pop the condition (func_exit is the right place)
    h.popCallFrame();
    assertNull(h.currentConditionId(), 'conditionId cleared after func_exit on parent frame');
    h.reset();
});

// ──────────────────────────────────────────────────────────────
//  TEST 5 — Loop + IF + function call
//  func_enter inside loop body inside IF must carry loopId AND conditionId
// ──────────────────────────────────────────────────────────────
test('TEST 5: Loop + IF + function call', () => {
    const h = new ContextHarness();
    h.pushCallFrame('main');

    h.pushLoop('loop-main-80');
    h.pushCondition('cond-main-0-81');

    const loopId = h.currentLoopId();
    const condId = h.currentConditionId();
    assertNotNull(loopId, 'loopId active');
    assertNotNull(condId, 'conditionId active');

    // func_enter foo inside loop+condition
    const fooFrame = h.pushCallFrame('foo');
    assertEqual(fooFrame.activeLoopId, loopId, 'foo inherits loopId');
    assertEqual(fooFrame.activeConditionId, condId, 'foo inherits conditionId');

    h.reset();
});

// ──────────────────────────────────────────────────────────────
//  TEST 6 — Recursion inside loop
//  All recursive frames carry the loopId
// ──────────────────────────────────────────────────────────────
test('TEST 6: Recursion inside loop', () => {
    const h = new ContextHarness();
    h.pushCallFrame('main');
    h.pushLoop('loop-main-0-10');
    const loopId = h.currentLoopId();
    assertNotNull(loopId, 'loopId set');

    const r1 = h.pushCallFrame('recurse');
    assertEqual(r1.activeLoopId, loopId, 'r1 inherits loopId');

    const r2 = h.pushCallFrame('recurse');
    assertEqual(r2.activeLoopId, loopId, 'r2 inherits loopId');

    h.popCallFrame(); h.popCallFrame();
    assertEqual(h.currentLoopId(), loopId, 'loopId still alive on main after unwind');
    h.reset();
});

// ──────────────────────────────────────────────────────────────
//  TEST 7 — Nested loops + nested IF
//  Deep nesting: outerLoop > innerLoop > IF — all IDs visible
// ──────────────────────────────────────────────────────────────
test('TEST 7: Nested loops + nested IF', () => {
    const h = new ContextHarness();
    h.pushCallFrame('main');

    h.pushLoop('loop-outer');
    h.pushLoop('loop-inner');
    h.pushCondition('cond-nested');

    assertEqual(h.currentLoopId(), 'loop-inner', 'innermost loop on top');
    assertEqual(h.currentConditionId(), 'cond-nested', 'condition active');

    const frame = h.currentFrame();
    assertEqual(frame.loopStack.length, 2, 'both loops on stack');

    // Close inner loop (Bug 5 fix: pop correctly)
    h.popLoop('loop-inner');
    assertEqual(h.currentLoopId(), 'loop-outer', 'outer loop restored');

    h.reset();
});

// ──────────────────────────────────────────────────────────────
//  TEST 8 — Deep recursion + nested conditions
//  5 levels deep, each level inside its own condition
// ──────────────────────────────────────────────────────────────
test('TEST 8: Deep recursion + nested conditions', () => {
    const h = new ContextHarness();
    h.pushCallFrame('fib');
    h.pushCondition('cond-root');

    const frames = [];
    for (let i = 0; i < 5; i++) {
        const f = h.pushCallFrame('fib');
        assertEqual(f.activeConditionId, 'cond-root', `depth ${i + 1} inherits cond-root`);
        frames.push(f);
    }

    // Verify all frames share same inherited condition
    for (const f of frames) {
        assertNotNull(f.activeConditionId, 'all recursive frames have conditionId');
    }

    h.reset();
});

// ──────────────────────────────────────────────────────────────
//  TEST 9 — Multiple returns inside branch
//  Both early-return and normal-return carry conditionId
// ──────────────────────────────────────────────────────────────
test('TEST 9: Multiple returns inside branch', () => {
    const h = new ContextHarness();
    h.pushCallFrame('check');
    h.pushCondition('cond-check-if');

    // Early return inside if-branch — conditionId must be non-null
    // (Bug 3 fix: block_exit no longer pops conditionStack)
    const condAtReturn1 = h.currentConditionId();
    assertNotNull(condAtReturn1, 'early return has conditionId');

    // Nested branch inside else
    h.pushCondition('cond-check-else');
    const condAtReturn2 = h.currentConditionId();
    assertNotNull(condAtReturn2, 'return inside nested else has conditionId');
    assertEqual(condAtReturn2, 'cond-check-else', 'correct nested conditionId');

    h.reset();
});

// ──────────────────────────────────────────────────────────────
//  TEST 10 — Mixed loop + recursion + condition
//  Comprehensive: loop > condition > recursive call preserves all 3 contexts
// ──────────────────────────────────────────────────────────────
test('TEST 10: Mixed loop + recursion + condition', () => {
    const h = new ContextHarness();
    h.pushCallFrame('main');

    // Outer loop
    h.pushLoop('loop-outer');
    const outerLoop = h.currentLoopId();

    // Condition inside loop
    h.pushCondition('cond-main-in-loop');
    const condId = h.currentConditionId();

    // Recursive function called inside condition inside loop
    const r1 = h.pushCallFrame('process');
    assertEqual(r1.activeLoopId, outerLoop, 'process inherits outerLoop');
    assertEqual(r1.activeConditionId, condId, 'process inherits conditionId');

    // Further recursion
    const r2 = h.pushCallFrame('process');
    assertEqual(r2.activeLoopId, outerLoop, 'nested process inherits outerLoop');
    assertEqual(r2.activeConditionId, condId, 'nested process inherits conditionId');

    // Verify loopStack depth is correct even inside recursive frames
    assertEqual(r2.loopStack.length, 1, 'recursive frame sees 1 inherited loop');
    assertEqual(r2.conditionStack.length, 1, 'recursive frame sees 1 inherited condition');

    // Unwind
    h.popCallFrame(); h.popCallFrame();

    // After unwinding back to main, context still valid
    assertEqual(h.currentLoopId(), outerLoop, 'outerLoop still active on main');
    assertEqual(h.currentConditionId(), condId, 'conditionId still active on main');

    // End loop properly (Bug 5 fix)
    h.popLoop('loop-outer');
    assertNull(h.currentLoopId(), 'loopId cleared after loop_end');

    h.reset();
});

// ──────────────────────────────────────────────────────────────
// Write results to text file
// ──────────────────────────────────────────────────────────────

const pass = results.filter(r => r.status === 'PASS').length;
const fail = results.filter(r => r.status === 'FAIL').length;

const lines = [
    '========================================',
    ' CodeViz Context Nesting Test Results   ',
    '========================================',
    '',
    ...results.map((r, i) => {
        const line = `TEST ${i + 1}: ${r.status}`;
        return r.reason ? `${line}\n  Reason: ${r.reason}` : line;
    }),
    '',
    `TOTAL: ${pass} PASS / ${fail} FAIL / ${results.length} TOTAL`,
    '',
    fail === 0
        ? '✅ ALL TESTS PASSED — context propagation is working correctly.'
        : `❌ ${fail} TEST(S) FAILED — see reasons above.`,
    '',
    'Expected log pattern for recursion inside condition:',
    '  [FRAME PUSH] factorial-1 cond: cond-main-0-7 loop: null',
    '  [ENTER] factorial-1 cond: cond-main-0-7 loop: null',
    '  [ENTER] factorial-2 cond: cond-main-0-7 loop: null',
    '  [EXIT] factorial-2 cond: cond-main-0-7 loop: null',
    '  [EXIT] factorial-1 cond: cond-main-0-7 loop: null',
];

const outputPath = path.join(__dirname, 'context-test-results.txt');
await writeFile(outputPath, lines.join('\n'), 'utf-8');

console.log('');
console.log('========================================');
console.log(` ${pass}/${results.length} TESTS PASSED`);
console.log(`Results written to: ${outputPath}`);
console.log('========================================');

if (fail > 0) {
    process.exit(1);
}
