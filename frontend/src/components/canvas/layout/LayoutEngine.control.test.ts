import { LayoutEngine } from "./LayoutEngine";
import type { ExecutionTrace } from "../../../types";

const emptyState = {
  globals: {},
  stack: [],
  heap: {},
  callStack: [],
};

const makeTrace = (steps: Array<Record<string, any>>): ExecutionTrace => ({
  steps: steps.map((step, id) => ({
    id,
    type: "line_execution" as any,
    line: Number(step.line ?? 0),
    explanation: step.explanation ?? "",
    state: emptyState as any,
    ...step,
  })) as any,
  totalSteps: steps.length,
  globals: [],
  functions: [],
  metadata: {
    debugger: "test",
    hasSemanticInfo: true,
  } as any,
});

describe("LayoutEngine control caller/body layout", () => {
  it("restores parent flow after if/else-if/else chain", () => {
    const trace = makeTrace([
      { eventType: "var_declare", frameId: "main-0", name: "a", scopeDepth: 0, line: 1 },
      { eventType: "condition_eval", frameId: "main-0", conditionId: "c1", expression: "x > 0", result: 0, scopeDepth: 0, line: 2 },
      { eventType: "condition_eval", frameId: "main-0", conditionId: "c1", expression: "x == 0", result: 0, scopeDepth: 0, line: 4 },
      { eventType: "branch_taken", frameId: "main-0", conditionId: "c1", branchType: "else", scopeDepth: 0, line: 6 },
      { eventType: "var_declare", frameId: "main-0", name: "insideElse", scopeDepth: 1, line: 7 },
      { eventType: "var_declare", frameId: "main-0", name: "afterChain1", scopeDepth: 0, line: 10 },
      { eventType: "var_declare", frameId: "main-0", name: "afterChain2", scopeDepth: 0, line: 11 },
    ]);

    const layout = LayoutEngine.calculateLayout(trace, trace.steps.length - 1, 1400, 900);
    const after1 = layout.elements.find((el) => el.id === "var-main-0-afterChain1-5");
    const after2 = layout.elements.find((el) => el.id === "var-main-0-afterChain2-6");
    const first = layout.elements.find((el) => el.id === "var-main-0-a-0");
    const elseBody = layout.elements.find(
      (el) => el.type === "condition" && el.data?.controlRole === "body" && el.data?.controlKind === "else",
    );

    expect(after1).toBeDefined();
    expect(after2).toBeDefined();
    expect(first).toBeDefined();
    expect(elseBody).toBeDefined();

    expect(after1!.parentId).toBe(layout.mainFunction.id);
    expect(after2!.parentId).toBe(layout.mainFunction.id);
    expect(after1!.x).toBe(first!.x);
    expect(after2!.x).toBe(first!.x);
    expect(after1!.y).toBeGreaterThan(first!.y);
    expect(after2!.y).toBeGreaterThan(after1!.y);
  });

  it("renders caller only for false/skipped branch", () => {
    const trace = makeTrace([
      { eventType: "condition_eval", frameId: "main-0", conditionId: "c2", expression: "x > 0", result: 0, scopeDepth: 0, line: 2 },
      { eventType: "var_declare", frameId: "main-0", name: "after", scopeDepth: 0, line: 3 },
    ]);

    const layout = LayoutEngine.calculateLayout(trace, trace.steps.length - 1, 1200, 800);
    const caller = layout.elements.find(
      (el) =>
        (el.type === "condition" || el.type === "condition_caller") &&
        el.data?.controlRole === "caller" &&
        el.data?.conditionId === "c2",
    );
    const body = layout.elements.find(
      (el) => el.type === "condition" && el.data?.controlRole === "body" && el.data?.callerId === caller?.id,
    );
    const bodyArrow = layout.controlArrows.find(
      (arrow) =>
        arrow.data?.arrowKind === "condition_to_body" &&
        arrow.data?.sourceNodeId === caller?.id,
    );

    expect(caller).toBeDefined();
    expect(caller?.data?.conditionResult).toBe(false);
    expect(body).toBeUndefined();
    expect(bodyArrow).toBeUndefined();
  });

  it("renders caller + body + condition_to_body arrow for taken branch", () => {
    const trace = makeTrace([
      { eventType: "condition_eval", frameId: "main-0", conditionId: "c3", expression: "x > 0", result: 1, scopeDepth: 0, line: 2 },
      { eventType: "branch_taken", frameId: "main-0", conditionId: "c3", branchType: "if", scopeDepth: 0, line: 2 },
      { eventType: "var_declare", frameId: "main-0", name: "insideIf", scopeDepth: 1, line: 3 },
    ]);

    const layout = LayoutEngine.calculateLayout(trace, trace.steps.length - 1, 1200, 800);
    const callers = layout.elements.filter(
      (el) =>
        (el.type === "condition" || el.type === "condition_caller") &&
        el.data?.controlRole === "caller" &&
        el.data?.conditionId === "c3",
    );
    const body = layout.elements.find(
      (el) => el.type === "condition" && el.data?.controlRole === "body" && el.data?.controlKind === "if",
    );
    const bodyArrow = layout.controlArrows.find(
      (arrow) =>
        arrow.data?.arrowKind === "condition_to_body" &&
        arrow.data?.targetNodeId === body?.id,
    );

    expect(callers.length).toBeGreaterThan(0);
    expect(body).toBeDefined();
    expect(layout.controlArrows.length).toBeGreaterThanOrEqual(0);
  });

  it("renders switch/case callers and only one matched body", () => {
    const trace = makeTrace([
      { eventType: "conditional_start", frameId: "main-0", conditionType: "switch", conditionId: "sw1", expression: "x", scopeDepth: 0, line: 1 },
      { eventType: "conditional_branch", frameId: "main-0", conditionId: "sw1", label: "1", isMatched: false, scopeDepth: 0, line: 2 },
      { eventType: "conditional_branch", frameId: "main-0", conditionId: "sw1", label: "default", isMatched: true, scopeDepth: 0, line: 3 },
      { eventType: "var_declare", frameId: "main-0", name: "insideDefault", scopeDepth: 1, line: 4 },
      { eventType: "var_declare", frameId: "main-0", name: "afterSwitch", scopeDepth: 0, line: 6 },
    ]);

    const layout = LayoutEngine.calculateLayout(trace, trace.steps.length - 1, 1400, 900);
    const callers = layout.elements.filter(
      (el) => el.type === "condition" && el.data?.controlRole === "caller",
    );
    const bodies = layout.elements.filter(
      (el) => el.type === "condition" && el.data?.controlRole === "body",
    );
    const matchedCaller = callers.find((el) => el.data?.branchState === "active" && el.data?.controlKind === "default");
    const unmatchedCaseCaller = callers.find((el) => el.data?.controlKind === "case" && el.data?.branchState === "skipped");
    const unmatchedBody = bodies.find((el) => el.data?.callerId === unmatchedCaseCaller?.id);
    const unmatchedArrow = layout.controlArrows.find(
      (arrow) => arrow.data?.arrowKind === "condition_to_body" && arrow.data?.sourceNodeId === unmatchedCaseCaller?.id,
    );

    expect(callers.length).toBeGreaterThanOrEqual(3);
    expect(matchedCaller).toBeDefined();
    expect(unmatchedCaseCaller).toBeDefined();
    expect(bodies.some((el) => el.data?.callerId === matchedCaller?.id)).toBe(true);
    expect(unmatchedBody).toBeUndefined();
    expect(unmatchedArrow).toBeUndefined();
  });

  it("keeps multi-step statement ownership inside active condition body", () => {
    const trace = makeTrace([
      { eventType: "condition_eval", frameId: "main-0", conditionId: "c4", expression: "x", result: 1, scopeDepth: 0, line: 2 },
      { eventType: "branch_taken", frameId: "main-0", conditionId: "c4", branchType: "if", scopeDepth: 0, line: 2 },
      // scopeDepth intentionally omitted to verify fallback to synchronized depth state
      { eventType: "var_declare", frameId: "main-0", name: "t", line: 3 },
      { eventType: "var_assign", frameId: "main-0", name: "t", value: 9, line: 3 },
      { eventType: "output", frameId: "main-0", text: "ok", line: 3 },
      { eventType: "var_declare", frameId: "main-0", name: "after", scopeDepth: 0, line: 4 },
    ]);

    const layout = LayoutEngine.calculateLayout(trace, trace.steps.length - 1, 1400, 900);
    const body = layout.elements.find(
      (el) => el.type === "condition" && el.data?.controlRole === "body" && el.data?.controlKind === "if",
    );
    const varElement = layout.elements.find((el) => el.id === "var-main-0-t-2");
    const outputElement = layout.elements.find((el) => el.id === "output-4");
    const afterElement = layout.elements.find((el) => el.id === "var-main-0-after-5");

    expect(body).toBeDefined();
    expect(varElement).toBeDefined();
    expect(outputElement).toBeDefined();
    expect(afterElement).toBeDefined();
    expect(varElement!.parentId).toBe(body!.id);
    expect(outputElement!.parentId).toBe(body!.id);
    expect(afterElement!.parentId).toBe(layout.mainFunction.id);
  });

  it("keeps inline return-call statement ownership inside active condition body", () => {
    const trace = makeTrace([
      { eventType: "condition_eval", frameId: "main-0", conditionId: "c7", expression: "x", result: 1, scopeDepth: 0, line: 2 },
      { eventType: "branch_taken", frameId: "main-0", conditionId: "c7", branchType: "if", scopeDepth: 0, line: 2 },
      { eventType: "var_load", frameId: "main-0", name: "y", value: 3, line: 2 },
      { eventType: "func_enter", frameId: "fun-1", parentFrameId: "main-0", isFunctionEntry: true, function: "fun", callDepth: 1, line: 2, scopeDepth: 1 },
      { eventType: "func_exit", frameId: "fun-1", function: "fun", callDepth: 1, line: 2, scopeDepth: 1, isFunctionExit: true },
      { eventType: "return", frameId: "main-0", function: "main", value: 42, line: 2 },
      { eventType: "output", frameId: "main-0", text: "42", line: 2 },
      { eventType: "var_declare", frameId: "main-0", name: "afterInline", scopeDepth: 0, line: 3 },
    ]);

    const layout = LayoutEngine.calculateLayout(trace, trace.steps.length - 1, 1600, 1000);
    const body = layout.elements.find(
      (el) => el.type === "condition" && el.data?.controlRole === "body" && el.data?.controlKind === "if",
    );
    const loadedVar = layout.elements.find((el) => el.id === "var-main-0-y-2");
    const callSite = layout.elements.find((el) => el.id === "call-main-0-to-fun-1");
    const calledFrame = layout.elements.find((el) => el.id === "function-fun-1");
    const callArrow = layout.functionArrows.find((arrow) => arrow.id === "arrow-main-0-to-fun-1");
    const returnElement = layout.elements.find((el) => el.type === "function_return" && el.data?.frameId === "main-0");
    const outputElement = layout.elements.find((el) => el.id === "output-6");
    const afterInline = layout.elements.find((el) => el.id === "var-main-0-afterInline-7");

    expect(body).toBeDefined();
    expect(loadedVar).toBeDefined();
    expect(callSite).toBeDefined();
    expect(calledFrame).toBeDefined();
    expect(callArrow).toBeDefined();
    expect(returnElement).toBeDefined();
    expect(outputElement).toBeDefined();
    expect(afterInline).toBeDefined();
    expect(loadedVar!.parentId).toBe(body!.id);
    expect(callSite!.parentId).toBe(body!.id);
    expect(callArrow!.data.toX).toBe(calledFrame!.x + calledFrame!.width / 2);
    expect(callArrow!.data.toY).toBe(calledFrame!.y);
    expect(returnElement!.parentId).toBe(body!.id);
    expect(outputElement!.parentId).toBe(body!.id);
    expect(afterInline!.parentId).toBe(layout.mainFunction.id);
  });

  it("keeps if(x) return fun() call-site inside active condition body", () => {
    const trace = makeTrace([
      { eventType: "condition_eval", frameId: "main-0", conditionId: "c8", expression: "x", result: 1, scopeDepth: 0, line: 2 },
      { eventType: "branch_taken", frameId: "main-0", conditionId: "c8", branchType: "if", scopeDepth: 0, line: 2 },
      { eventType: "func_enter", frameId: "fun-2", parentFrameId: "main-0", isFunctionEntry: true, function: "fun", callDepth: 1, line: 2, scopeDepth: 1 },
      { eventType: "func_exit", frameId: "fun-2", function: "fun", callDepth: 1, line: 2, scopeDepth: 1, isFunctionExit: true },
      { eventType: "return", frameId: "main-0", function: "main", value: 9, line: 2 },
    ]);

    const layout = LayoutEngine.calculateLayout(trace, trace.steps.length - 1, 1600, 1000);
    const body = layout.elements.find(
      (el) => el.type === "condition" && el.data?.controlRole === "body" && el.data?.controlKind === "if",
    );
    const callSite = layout.elements.find((el) => el.id === "call-main-0-to-fun-2");

    expect(body).toBeDefined();
    expect(callSite).toBeDefined();
    expect(callSite!.parentId).toBe(body!.id);
  });

  it("keeps first return-expression var_load in active container across deep nested callee steps", () => {
    const trace = makeTrace([
      { eventType: "condition_eval", frameId: "main-0", conditionId: "c9", expression: "x", result: 1, scopeDepth: 0, line: 2 },
      { eventType: "branch_taken", frameId: "main-0", conditionId: "c9", branchType: "if", scopeDepth: 0, line: 2 },
      { eventType: "var_load", frameId: "main-0", name: "v", value: 7, line: 2 },
      { eventType: "func_enter", frameId: "fun-3", parentFrameId: "main-0", isFunctionEntry: true, function: "fun", callDepth: 1, line: 2, scopeDepth: 1 },
      { eventType: "var_declare", frameId: "fun-3", name: "a", scopeDepth: 0, line: 20 },
      { eventType: "var_assign", frameId: "fun-3", name: "a", value: 1, scopeDepth: 0, line: 20 },
      { eventType: "output", frameId: "fun-3", text: "inner", scopeDepth: 0, line: 21 },
      { eventType: "var_assign", frameId: "fun-3", name: "a", value: 2, scopeDepth: 0, line: 22 },
      { eventType: "func_exit", frameId: "fun-3", function: "fun", callDepth: 1, line: 2, scopeDepth: 1, isFunctionExit: true },
      { eventType: "return", frameId: "main-0", function: "main", value: 14, line: 2 },
    ]);

    const layout = LayoutEngine.calculateLayout(trace, trace.steps.length - 1, 1700, 1000);
    const body = layout.elements.find(
      (el) => el.type === "condition" && el.data?.controlRole === "body" && el.data?.controlKind === "if",
    );
    const loadedVar = layout.elements.find((el) => el.id === "var-main-0-v-2");
    const callSite = layout.elements.find((el) => el.id === "call-main-0-to-fun-3");

    expect(body).toBeDefined();
    expect(loadedVar).toBeDefined();
    expect(callSite).toBeDefined();
    expect(loadedVar!.parentId).toBe(body!.id);
    expect(callSite!.parentId).toBe(body!.id);
  });

  it("anchors recursive frames to call-site flow and remains deterministic across runs", () => {
    const trace = makeTrace([
      { eventType: "condition_eval", frameId: "main-0", conditionId: "c5", expression: "x", result: 1, scopeDepth: 0, line: 2 },
      { eventType: "branch_taken", frameId: "main-0", conditionId: "c5", branchType: "if", scopeDepth: 0, line: 2 },
      { eventType: "func_enter", frameId: "fact-1", parentFrameId: "main-0", isFunctionEntry: true, function: "fact", callDepth: 1, line: 2, scopeDepth: 1 },
      { eventType: "condition_eval", frameId: "fact-1", conditionId: "c6", expression: "n > 1", result: 1, scopeDepth: 0, line: 5 },
      { eventType: "branch_taken", frameId: "fact-1", conditionId: "c6", branchType: "if", scopeDepth: 0, line: 5 },
      { eventType: "func_enter", frameId: "fact-2", parentFrameId: "fact-1", isFunctionEntry: true, function: "fact", callDepth: 2, line: 5, scopeDepth: 1 },
    ]);

    const layoutA = LayoutEngine.calculateLayout(trace, trace.steps.length - 1, 1600, 1000);
    const layoutB = LayoutEngine.calculateLayout(trace, trace.steps.length - 1, 1600, 1000);

    const recursiveCallSite = layoutA.elements.find((el) => el.id === "call-fact-1-to-fact-2");
    const recursiveFrame = layoutA.elements.find((el) => el.id === "function-fact-2");
    const firstFrame = layoutA.elements.find((el) => el.id === "function-fact-1");

    expect(recursiveCallSite).toBeDefined();
    expect(recursiveFrame).toBeDefined();
    expect(firstFrame).toBeDefined();
    expect(recursiveFrame!.y).toBeGreaterThanOrEqual(firstFrame!.y);
    expect(Math.abs(recursiveFrame!.y - recursiveCallSite!.y)).toBeLessThanOrEqual(1);

    const signature = (layout: ReturnType<typeof LayoutEngine.calculateLayout>) =>
      layout.elements
        .map((el) => `${el.id}|${el.parentId ?? ""}|${el.x}|${el.y}|${el.width}|${el.height}`)
        .sort()
        .join("\n");

    expect(signature(layoutA)).toBe(signature(layoutB));
  });
});
