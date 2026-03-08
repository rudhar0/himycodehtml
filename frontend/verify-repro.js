const { LayoutEngine } = require('./src/components/canvas/layout/LayoutEngine');
const { annotateStepsWithPlacementKeys, buildConditionTree } = require('./src/ExecutionStructureBuilder');

// Stub out canvas things if LayoutEngine imports them
const emptyState = { globals: {}, stack: [], heap: {}, callStack: [] };
const makeTrace = (steps) => ({
    steps: steps.map((step, id) => ({
        id, type: "line_execution", line: Number(step.line ?? 0), explanation: step.explanation ?? "", state: emptyState, ...step
    })),
    totalSteps: steps.length, globals: [], functions: [], metadata: { debugger: "test", hasSemanticInfo: true }
});

const trace = makeTrace([
    { eventType: "condition_eval", frameId: "main-0", conditionId: "c1", expression: "x > 0", result: 1, scopeDepth: 0, line: 2 },
    { eventType: "branch_taken", frameId: "main-0", conditionId: "c1", branchType: "if", scopeDepth: 0, line: 2 },
    { eventType: "var_declare", frameId: "main-0", name: "insideIf", line: 3 },
]);

// Apply Layer 1 + Layer 2 annotations
annotateStepsWithPlacementKeys(trace.steps);
const conditionTree = buildConditionTree(trace.steps);
trace.conditionTree = conditionTree;

try {
    const layout = LayoutEngine.calculateLayout(trace, null, trace.steps.length - 1, 1200);
    const varElement = layout.elements.find((el) => el.id.startsWith("var-main-0-insideIf"));
    const body = layout.elements.find(
        (el) => el.type === "condition" && el.data?.controlRole === "body" && el.data?.controlKind === "if"
    );

    console.log("----------------------------------------");
    console.log("Var Parent ID:", varElement ? varElement.parentId : "NOT FOUND");
    console.log("Body ID:", body ? body.id : "NOT FOUND");
    console.log("MATCH:", (varElement && body && varElement.parentId === body.id) ? "SUCCESS" : "FAIL");
    console.log("----------------------------------------");
} catch (e) {
    console.error(e);
}
