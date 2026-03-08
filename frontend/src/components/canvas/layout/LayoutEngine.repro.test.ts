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

describe("LayoutEngine Reproduction BUG", () => {
  it("fails to attach variable to IF body when scopeDepth is missing from var_declare", () => {
    const trace = makeTrace([
      { eventType: "condition_eval", frameId: "main-0", conditionId: "c1", expression: "x > 0", result: 1, scopeDepth: 0, line: 2 },
      { eventType: "branch_taken", frameId: "main-0", conditionId: "c1", branchType: "if", scopeDepth: 0, line: 2 },
      // Missing scopeDepth on this one!
      { eventType: "var_declare", frameId: "main-0", name: "insideIf", line: 3 }, 
    ]);

    const layout = LayoutEngine.calculateLayout(trace, null, trace.steps.length - 1, 1200);
    const varElement = layout.elements.find((el) => el.id.startsWith("var-main-0-insideIf"));
    const body = layout.elements.find(
      (el) => el.type === "condition" && el.data?.controlRole === "body" && el.data?.controlKind === "if",
    );

    expect(varElement).toBeDefined();
    expect(body).toBeDefined();
    // BUG: varElement.parentId will be "main-function" instead of body.id
    console.log("Var Parent ID:", varElement!.parentId);
    console.log("Body ID:", body!.id);
    
    expect(varElement!.parentId).toBe(body!.id);
  });
});
