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
  it("uses fixed sub-card sizing for variable/output/return", () => {
    const trace = makeTrace([
      { eventType: "var_declare", frameId: "main-0", name: "x", varType: "int", scopeDepth: 0, line: 1 },
      { eventType: "var_assign", frameId: "main-0", name: "x", value: 42, expression: "x = 42", address: "0x1000", scopeDepth: 0, line: 2 },
      { eventType: "output", frameId: "main-0", text: "\"Hello\"", scopeDepth: 0, line: 3 },
      { eventType: "func_exit", frameId: "main-0", function: "main", returnValue: 0, scopeDepth: 0, line: 4 },
    ]);

    const layout = LayoutEngine.calculateLayout(trace, trace.steps.length - 1, 1400, 900);
    const varEl = layout.elements.find((el) => el.type === "variable");
    const outEl = layout.elements.find((el) => el.type === "output");
    const retEl = layout.elements.find((el) => el.type === "function_return");

    expect(varEl).toBeDefined();
    expect(outEl).toBeDefined();
    expect(retEl).toBeDefined();

    expect(varEl!.width).toBe(378);
    expect(varEl!.height).toBe(114);
    expect(outEl!.width).toBe(378);
    expect(outEl!.height).toBe(114);
    expect(retEl!.width).toBe(378);
    expect(retEl!.height).toBe(114);
  });

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
    expect(after1!.y).toBeGreaterThan((elseBody!.y + elseBody!.height));
  });

  it("renders caller only for false/skipped branch", () => {
    const trace = makeTrace([
      { eventType: "condition_eval", frameId: "main-0", conditionId: "c2", expression: "x > 0", result: 0, scopeDepth: 0, line: 2 },
      { eventType: "var_declare", frameId: "main-0", name: "after", scopeDepth: 0, line: 3 },
    ]);

    const layout = LayoutEngine.calculateLayout(trace, trace.steps.length - 1, 1200, 800);
    const caller = layout.elements.find(
      (el) =>
        el.type === "condition" &&
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
    expect(caller?.data?.branchState).toBe("skipped");
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
    const caller = layout.elements.find(
      (el) =>
        el.type === "condition" &&
        el.data?.controlRole === "caller" &&
        el.data?.conditionId === "c3",
    );
    const body = layout.elements.find(
      (el) => el.type === "condition" && el.data?.controlRole === "body" && el.data?.callerId === caller?.id,
    );
    const bodyArrow = layout.controlArrows.find(
      (arrow) =>
        arrow.data?.arrowKind === "condition_to_body" &&
        arrow.data?.sourceNodeId === caller?.id &&
        arrow.data?.targetNodeId === body?.id,
    );

    expect(caller).toBeDefined();
    expect(body).toBeDefined();
    expect(bodyArrow).toBeDefined();
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
});
