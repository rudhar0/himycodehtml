import { LayoutEngine } from "./src/components/canvas/layout/LayoutEngine";

const emptyState = {
  globals: {},
  stack: [],
  heap: {},
  callStack: [],
};

const trace = {
  steps: [
    { id: 0, type: "line_execution", line: 1, explanation: "", state: emptyState, eventType: "func_enter", frameId: "main-0", isFunctionEntry: true, function: "main", scopeDepth: 0 },
    { id: 1, type: "line_execution", line: 2, explanation: "", state: emptyState, eventType: "condition_eval", frameId: "main-0", conditionId: "c1", expression: "x > 0", result: 1, scopeDepth: 0 },
    { id: 2, type: "line_execution", line: 2, explanation: "", state: emptyState, eventType: "branch_taken", frameId: "main-0", conditionId: "c1", branchType: "if", scopeDepth: 0 },
    // A single line inside IF. No explicit scopeDepth in trace! 
    // And NO block_enter here (since it's a single line if, maybe the compiler didn't emit block_enter)
    { id: 3, type: "line_execution", line: 3, explanation: "", state: emptyState, eventType: "var_declare", frameId: "main-0", name: "insideIf" }
  ],
  totalSteps: 4,
  globals: [],
  functions: [],
  metadata: { debugger: "test", hasSemanticInfo: true }
};

const layout = LayoutEngine.calculateLayout(trace as any, 3, 1200, 800);
const varElement = layout.elements.find((el) => el.id.startsWith("var-main-0-insideIf"));
const body = layout.elements.find(
  (el) => el.type === "condition" && el.data?.controlRole === "body" && el.data?.controlKind === "if",
);

console.log("Body ID:", body?.id);
console.log("Var Parent ID:", varElement?.parentId);
console.log("Are they same?", varElement?.parentId === body?.id);
