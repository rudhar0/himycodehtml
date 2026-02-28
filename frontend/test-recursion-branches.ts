import { LayoutEngine } from "./src/components/canvas/layout/LayoutEngine";

const emptyState = { globals: {}, stack: [], heap: {}, callStack: [] };

const trace = {
  steps: [
    { id: 0, type: "line_execution", line: 1, explanation: "", state: emptyState, eventType: "func_enter", frameId: "main-0", isFunctionEntry: true, function: "main", scopeDepth: 0 },
    { id: 1, type: "line_execution", line: 2, explanation: "", state: emptyState, eventType: "condition_eval", frameId: "main-0", conditionId: "c1", expression: "x > 0", result: 0, scopeDepth: 0 },
    { id: 2, type: "line_execution", line: 2, explanation: "", state: emptyState, eventType: "branch_taken", frameId: "main-0", conditionId: "c1", branchType: "else", scopeDepth: 0 },
    { id: 3, type: "line_execution", line: 3, explanation: "", state: emptyState, eventType: "block_enter", frameId: "main-0", scopeDepth: 1 },
    // Recursive call! this is where the bug manifests. It should attach to the else body!
    { id: 4, type: "line_execution", line: 4, explanation: "", state: emptyState, eventType: "func_enter", frameId: "main-1", parentFrameId: "main-0", isFunctionEntry: true, function: "main", scopeDepth: 1 },
  ],
  totalSteps: 5, globals: [], functions: [], metadata: { debugger: "test", hasSemanticInfo: true }
};

const layout = LayoutEngine.calculateLayout(trace as any, 4, 1200, 800);

const callElement = layout.elements.find(el => el.type === "call_site");
const elseBody = layout.elements.find(el => el.data?.controlKind === "else" && el.data?.controlRole === "body");

console.log("Call Element Parent ID:", callElement?.parentId);
console.log("Else Body ID:", elseBody?.id);
console.log("Are they same?", callElement?.parentId === elseBody?.id);

