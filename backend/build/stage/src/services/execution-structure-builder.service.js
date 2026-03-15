// backend/src/services/execution-structure-builder.service.js
// ============================================================
// ExecutionStructureBuilder — Deterministic Execution Tree
//
// Transforms flat trace steps into a structured graph of nodes
// with explicit parent-child relationships.
//
// ISOLATED: Does NOT modify any existing pipeline.
// Called AFTER generateTrace completes.
// ============================================================

const ESB_DEBUG = process.env.ESB_DEBUG === 'true';

// ---------------------------------------------------------------------------
// Node Types
// ---------------------------------------------------------------------------
const NodeType = {
    PROGRAM: 'program',
    FUNCTION: 'function',
    CONDITION: 'condition',
    BRANCH: 'branch',
    LOOP: 'loop',
    STATEMENT: 'statement',
    CALL: 'call',
    RETURN: 'return',
    VARIABLE: 'variable',
    ARRAY: 'array',
    POINTER: 'pointer',
    OUTPUT: 'output',
    INPUT: 'input',
    LOOP_BODY: 'loop_body',
};

// ---------------------------------------------------------------------------
// Path Utilities
// ---------------------------------------------------------------------------
let _pathCounter = 0;
function makePathId(parentPath, segment) {
    if (!parentPath) return 'main';
    return `${parentPath}.${segment}`;
}

// ---------------------------------------------------------------------------
// Node Factory
// ---------------------------------------------------------------------------
let _nodeCounter = 0;
function createNode({
    type,
    label,
    frameId,
    conditionId = null,
    parentId = null,
    depth = 0,
    pathId = 'main',
    stepStart,
    stepEnd = null,
    meta = {},
}) {
    const nodeId = `esb-${type}-${_nodeCounter++}`;
    return {
        nodeId,
        type,
        label,
        frameId,
        conditionId,
        parentId,
        children: [],
        depth,
        pathId,
        stepStart,
        stepEnd,
        meta,   // Extra data (loopId, expression, branchType, etc.)
    };
}

// ---------------------------------------------------------------------------
// Step → Node Type mapper
// ---------------------------------------------------------------------------
function resolveNodeTypeForStep(eventType) {
    switch (eventType) {
        case 'func_enter': return NodeType.FUNCTION;
        case 'condition_eval':
        case 'conditional_start': return NodeType.CONDITION;
        case 'branch_taken':
        case 'conditional_branch': return NodeType.BRANCH;
        case 'loop_start': return NodeType.LOOP;
        case 'loop_body_start': return NodeType.LOOP_BODY;
        case 'return': return NodeType.RETURN;
        case 'var':
        case 'var_declare':
        case 'assignment':
        case 'arg_bind': return NodeType.VARIABLE;
        case 'array_declaration':
        case 'array_initialization':
        case 'array_assignment': return NodeType.ARRAY;
        case 'heap_alloc':
        case 'heap_write':
        case 'pointer_alias':
        case 'pointer_write':
        case 'pointer_deref':
        case 'pointer_deref_write': return NodeType.POINTER;
        case 'output': return NodeType.OUTPUT;
        case 'input': return NodeType.INPUT;
        case 'func_exit': return null; // Handled structurally
        case 'call_site':
        case 'function_call': return NodeType.CALL;
        default: return NodeType.STATEMENT;
    }
}

// ---------------------------------------------------------------------------
// Core Builder
// ---------------------------------------------------------------------------
class ExecutionStructureBuilderService {
    /**
     * Build a deterministic ExecutionGraph from a flat array of trace steps.
     * @param {Array} steps - Normalized steps from generateTrace.
     * @returns {ExecutionGraph}
     */
    buildGraph(steps) {
        // Reset counters on each build to keep IDs deterministic
        _nodeCounter = 0;
        _pathCounter = 0;

        const nodes = [];
        const nodeMap = {};         // nodeId → node
        const stepToNode = {};      // stepIndex → nodeId
        const paths = [];
        const pathSet = new Set();

        // -----------------------------------------------------------------------
        // Root program node — owns all top-level content
        // -----------------------------------------------------------------------
        const programNode = createNode({
            type: NodeType.PROGRAM,
            label: 'program',
            frameId: null,
            depth: 0,
            pathId: 'main',
            stepStart: 0,
        });
        nodes.push(programNode);
        nodeMap[programNode.nodeId] = programNode;
        this._trackPath('main', paths, pathSet);

        // -----------------------------------------------------------------------
        // Processing stack: each entry = { node, frameId, conditionId?, loopId? }
        // -----------------------------------------------------------------------
        // The top of the stack is the current active container.
        const stack = [{ node: programNode, frameId: null }];

        // Per-frame trackers
        // frameId → function node
        const frameToNode = {};
        // conditionId → condition node
        const condToNode = {};
        // loopId → loop node
        const loopToNode = {};
        // Track virtual bodies created for branchless single-line ifs
        // conditionId → virtual branch node
        const virtualBodyByCondId = {};

        const peek = () => stack[stack.length - 1];

        // Helper: attach node to its parent on the stack top
        const attach = (childNode) => {
            const parent = peek().node;
            childNode.parentId = parent.nodeId;
            childNode.depth = parent.depth + 1;
            if (!parent.children.includes(childNode.nodeId)) {
                parent.children.push(childNode.nodeId);
            }
            nodes.push(childNode);
            nodeMap[childNode.nodeId] = childNode;
            this._trackPath(childNode.pathId, paths, pathSet);
            if (ESB_DEBUG) {
                console.log(`[ESB NODE ATTACH] ${childNode.nodeId} (${childNode.type}:"${childNode.label}") → parent: ${parent.nodeId}`);
            }
        };

        // -----------------------------------------------------------------------
        // Main processing loop — O(N)
        // -----------------------------------------------------------------------
        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            const evType = String(step.eventType || step.type || '').toLowerCase();
            const frameId = step.frameId || 'main-0';
            const stepIndex = step.stepIndex ?? i;

            // ------------------------------------------------------------------
            // func_enter: Push new function node
            // ------------------------------------------------------------------
            if (evType === 'func_enter' && step.isFunctionEntry) {
                const parentPoint = peek();
                const depth = parentPoint.node.depth + 1;
                const pathId = makePathId(parentPoint.node.pathId, `fn_${frameId}`);

                const fnNode = createNode({
                    type: NodeType.FUNCTION,
                    label: step.function || 'unknown',
                    frameId,
                    depth,
                    pathId,
                    stepStart: stepIndex,
                    meta: {
                        callDepth: step.callDepth || 0,
                        parentFrameId: step.parentFrameId || null,
                    },
                });

                attach(fnNode);
                frameToNode[frameId] = fnNode;
                stack.push({ node: fnNode, frameId });

                stepToNode[stepIndex] = fnNode.nodeId;
                if (ESB_DEBUG) console.log(`[ESB NODE CREATE] FUNCTION ${fnNode.nodeId} frameId=${frameId}`);
                continue;
            }

            // ------------------------------------------------------------------
            // func_exit: Pop function node
            // ------------------------------------------------------------------
            if (evType === 'func_exit' && step.isFunctionExit) {
                // Pop until we find the matching function frame
                while (stack.length > 1) {
                    const top = peek();
                    if (top.frameId === frameId) {
                        top.node.stepEnd = stepIndex;
                        stack.pop();
                        if (ESB_DEBUG) console.log(`[ESB NODE CLOSE] FUNCTION frameId=${frameId} at step=${stepIndex}`);
                        break;
                    }
                    // Pop intermediate nodes (branches, loops) that belong to this frame
                    if (top.frameId === frameId || !top.node.frameId || top.node.frameId === frameId) {
                        stack.pop();
                    } else {
                        break;
                    }
                }
                stepToNode[stepIndex] = peek().node.nodeId;
                continue;
            }

            // ------------------------------------------------------------------
            // condition_eval / conditional_start: Push condition node
            // ------------------------------------------------------------------
            if (evType === 'condition_eval' || evType === 'conditional_start') {
                const conditionId = step.conditionId || `auto-cond-${i}`;
                const parentPoint = peek();
                const depth = parentPoint.node.depth + 1;
                const pathId = makePathId(parentPoint.node.pathId, `cond_${conditionId}`);
                const isSwitch = evType === 'conditional_start' && step.conditionType === 'switch';

                const condNode = createNode({
                    type: NodeType.CONDITION,
                    label: isSwitch ? `switch (${step.expression || ''})` : `if (${step.expression || ''})`,
                    frameId,
                    conditionId,
                    depth,
                    pathId,
                    stepStart: stepIndex,
                    meta: {
                        conditionType: isSwitch ? 'switch' : 'if',
                        expression: step.expression || '',
                        result: step.result,
                    },
                });

                attach(condNode);
                condToNode[conditionId] = condNode;
                stack.push({ node: condNode, frameId, conditionId });

                stepToNode[stepIndex] = condNode.nodeId;
                if (ESB_DEBUG) console.log(`[ESB NODE CREATE] CONDITION ${condNode.nodeId} condId=${conditionId}`);
                continue;
            }

            // ------------------------------------------------------------------
            // branch_taken / conditional_branch: Push branch body node
            // ------------------------------------------------------------------
            if (evType === 'branch_taken' || evType === 'conditional_branch') {
                const conditionId = step.conditionId;
                const branchType = step.branchType || step.label || 'if';
                const branchLabel = String(branchType).toLowerCase();

                // Close previous branch body(ies) at this same condition level
                while (stack.length > 1 && peek().conditionId === conditionId && peek().node.type === NodeType.BRANCH) {
                    peek().node.stepEnd = stepIndex - 1;
                    stack.pop();
                    if (ESB_DEBUG) console.log(`[ESB NODE CLOSE] BRANCH at step=${stepIndex - 1}`);
                }

                // Resolve parent — should be the condition node
                const condNode = condToNode[conditionId];
                const parentNode = condNode || peek().node;
                const depth = parentNode.depth + 1;

                // Path key: true/false/else/case_X
                const branchKey = branchLabel === 'true' || branchLabel === 'if' ? 'true'
                    : branchLabel === 'false' || branchLabel === 'else' ? 'false'
                        : `case_${branchLabel}`;
                const pathId = makePathId(parentNode.pathId, branchKey);
                if (ESB_DEBUG) console.log(`[ESB PATH CREATE] ${pathId}`);

                const branchNode = createNode({
                    type: NodeType.BRANCH,
                    label: branchLabel,
                    frameId,
                    conditionId,
                    depth,
                    pathId,
                    stepStart: stepIndex,
                    meta: {
                        branchType: branchLabel,
                        isMatched: step.isMatched,
                        fallsThrough: step.fallsThrough,
                    },
                });

                // Attach to the condition node directly if possible
                if (condNode) {
                    branchNode.parentId = condNode.nodeId;
                    if (!condNode.children.includes(branchNode.nodeId)) {
                        condNode.children.push(branchNode.nodeId);
                    }
                    nodes.push(branchNode);
                    nodeMap[branchNode.nodeId] = branchNode;
                    this._trackPath(branchNode.pathId, paths, pathSet);
                } else {
                    attach(branchNode);
                }

                stack.push({ node: branchNode, frameId, conditionId });
                stepToNode[stepIndex] = branchNode.nodeId;
                if (ESB_DEBUG) console.log(`[ESB NODE CREATE] BRANCH ${branchNode.nodeId} type=${branchLabel}`);
                continue;
            }

            // ------------------------------------------------------------------
            // loop_start: Push loop node
            // ------------------------------------------------------------------
            if (evType === 'loop_start') {
                const loopId = step.loopId || `auto-loop-${i}`;
                const parentPoint = peek();
                const depth = parentPoint.node.depth + 1;
                const pathId = makePathId(parentPoint.node.pathId, `loop_${loopId}`);

                const loopNode = createNode({
                    type: NodeType.LOOP,
                    label: `${step.loopType || 'loop'} (${loopId})`,
                    frameId,
                    depth,
                    pathId,
                    stepStart: stepIndex,
                    meta: {
                        loopId,
                        loopType: step.loopType || 'for',
                    },
                });

                attach(loopNode);
                loopToNode[loopId] = loopNode;
                stack.push({ node: loopNode, frameId, loopId });

                stepToNode[stepIndex] = loopNode.nodeId;
                if (ESB_DEBUG) console.log(`[ESB NODE CREATE] LOOP ${loopNode.nodeId} loopId=${loopId}`);
                continue;
            }

            // ------------------------------------------------------------------
            // loop_body_start: Push an iteration body node
            // ------------------------------------------------------------------
            if (evType === 'loop_body_start') {
                const loopId = step.loopId;
                const loopNode = loopToNode[loopId];
                const parentNode = loopNode || peek().node;
                const iterCount = (parentNode.meta._iterCount = (parentNode.meta._iterCount || 0) + 1);
                const pathId = makePathId(parentNode.pathId, `iter${iterCount}`);

                // Close previous iteration body if open
                while (stack.length > 1 && peek().loopId === loopId && peek().node.type === NodeType.LOOP_BODY) {
                    peek().node.stepEnd = stepIndex - 1;
                    stack.pop();
                }

                const iterNode = createNode({
                    type: NodeType.LOOP_BODY,
                    label: `iteration ${iterCount}`,
                    frameId,
                    depth: parentNode.depth + 1,
                    pathId,
                    stepStart: stepIndex,
                    meta: { loopId, iteration: iterCount },
                });

                iterNode.parentId = parentNode.nodeId;
                if (!parentNode.children.includes(iterNode.nodeId)) {
                    parentNode.children.push(iterNode.nodeId);
                }
                nodes.push(iterNode);
                nodeMap[iterNode.nodeId] = iterNode;
                this._trackPath(iterNode.pathId, paths, pathSet);

                stack.push({ node: iterNode, frameId, loopId });
                stepToNode[stepIndex] = iterNode.nodeId;
                if (ESB_DEBUG) console.log(`[ESB NODE CREATE] LOOP_BODY ${iterNode.nodeId} iter=${iterCount}`);
                continue;
            }

            // ------------------------------------------------------------------
            // loop_end: Close loop node + any iteration bodies
            // ------------------------------------------------------------------
            if (evType === 'loop_end') {
                const loopId = step.loopId;
                while (stack.length > 1) {
                    const top = peek();
                    const done = (top.loopId === loopId && top.node.type === NodeType.LOOP) ||
                        (top.loopId === loopId && top.node.type === NodeType.LOOP_BODY);
                    if (!done && !top.loopId) break;
                    top.node.stepEnd = stepIndex;
                    stack.pop();
                    if (top.node.type === NodeType.LOOP) {
                        if (ESB_DEBUG) console.log(`[ESB NODE CLOSE] LOOP loopId=${loopId}`);
                        break;
                    }
                }
                stepToNode[stepIndex] = peek().node.nodeId;
                continue;
            }

            // ------------------------------------------------------------------
            // return: Attach as return node, then start closing branch/cond nodes
            // ------------------------------------------------------------------
            if (evType === 'return') {
                const returnNode = createNode({
                    type: NodeType.RETURN,
                    label: `return ${step.returnValue ?? ''}`,
                    frameId,
                    depth: peek().node.depth + 1,
                    pathId: peek().node.pathId,
                    stepStart: stepIndex,
                    stepEnd: stepIndex,
                    meta: {
                        returnValue: step.returnValue,
                        returnType: step.returnType,
                        destinationSymbol: step.destinationSymbol,
                    },
                });
                attach(returnNode);
                stepToNode[stepIndex] = returnNode.nodeId;

                // Close active branch nodes for this frame (early return)
                while (stack.length > 1) {
                    const top = peek();
                    if (top.frameId !== frameId) break;
                    if (top.node.type === NodeType.BRANCH || top.node.type === NodeType.LOOP_BODY) {
                        top.node.stepEnd = stepIndex;
                        stack.pop();
                    } else {
                        break;
                    }
                }
                if (ESB_DEBUG) console.log(`[ESB NODE CREATE] RETURN ${returnNode.nodeId} step=${stepIndex}`);
                continue;
            }

            // ------------------------------------------------------------------
            // scope_exit: Clean up open condition/branch/loop nodes for the frame
            // ------------------------------------------------------------------
            if (evType === 'scope_exit') {
                const currentScopeDepth = step.scopeDepth ?? 0;
                // Pop nodes whose depth is deeper than current
                while (stack.length > 1) {
                    const top = peek();
                    if (top.frameId !== frameId) break;
                    if (top.node.depth > currentScopeDepth + 1) {
                        top.node.stepEnd = stepIndex;
                        stack.pop();
                    } else {
                        break;
                    }
                }
                stepToNode[stepIndex] = peek().node.nodeId;
                continue;
            }

            // ------------------------------------------------------------------
            // block_exit: Similar to scope_exit — close nodes at that depth
            // ------------------------------------------------------------------
            if (evType === 'block_exit') {
                const exitDepth = step.scopeDepth ?? step.blockDepth ?? 0;
                while (stack.length > 1) {
                    const top = peek();
                    if (top.frameId !== frameId) break;
                    if (
                        top.node.type === NodeType.BRANCH ||
                        top.node.type === NodeType.LOOP_BODY ||
                        top.node.type === NodeType.CONDITION
                    ) {
                        if (top.node.depth >= exitDepth + 1) {
                            top.node.stepEnd = stepIndex;
                            stack.pop();
                        } else {
                            break;
                        }
                    } else {
                        break;
                    }
                }
                stepToNode[stepIndex] = peek().node.nodeId;
                continue;
            }

            // ------------------------------------------------------------------
            // All other steps: attach to current top node
            // ------------------------------------------------------------------
            const currentNode = peek().node;

            // Guard: if this step belongs to a different frame than the top of
            // the stack and we have a frame node for it, prefer that.
            let targetNode = currentNode;
            if (frameId && currentNode.frameId && currentNode.frameId !== frameId) {
                const fnNode = frameToNode[frameId];
                if (fnNode) targetNode = fnNode;
            }

            stepToNode[stepIndex] = targetNode.nodeId;

            // For visual types, also create a leaf node (not pushed onto stack)
            const nodeType = resolveNodeTypeForStep(evType);
            if (nodeType && nodeType !== NodeType.STATEMENT) {
                const leafNode = createNode({
                    type: nodeType,
                    label: this._stepLabel(step, evType),
                    frameId,
                    conditionId: step.conditionId || null,
                    depth: targetNode.depth + 1,
                    pathId: targetNode.pathId,
                    stepStart: stepIndex,
                    stepEnd: stepIndex,
                    meta: this._stepMeta(step, evType),
                });
                leafNode.parentId = targetNode.nodeId;
                if (!targetNode.children.includes(leafNode.nodeId)) {
                    targetNode.children.push(leafNode.nodeId);
                }
                nodes.push(leafNode);
                nodeMap[leafNode.nodeId] = leafNode;
                // Refine step → node to the leaf for precise lookups
                stepToNode[stepIndex] = leafNode.nodeId;
                if (ESB_DEBUG) console.log(`[ESB NODE ATTACH] leaf ${leafNode.nodeId} (${nodeType}) → step=${stepIndex}`);
            }
        }

        // -----------------------------------------------------------------------
        // Close any nodes that weren't explicitly closed
        // -----------------------------------------------------------------------
        const lastStepIndex = steps.length > 0 ? (steps[steps.length - 1].stepIndex ?? steps.length - 1) : 0;
        for (let j = stack.length - 1; j >= 0; j--) {
            if (stack[j].node.stepEnd === null || stack[j].node.stepEnd === undefined) {
                stack[j].node.stepEnd = lastStepIndex;
            }
        }
        programNode.stepEnd = lastStepIndex;

        // -----------------------------------------------------------------------
        // Build metadata
        // -----------------------------------------------------------------------
        const metadata = {
            totalNodes: nodes.length,
            totalPaths: paths.length,
            totalSteps: steps.length,
            builtAt: Date.now(),
        };

        console.log(`[ESB] Graph built: ${nodes.length} nodes, ${paths.length} paths, ${steps.length} steps`);

        return {
            nodes,
            nodeMap,
            stepToNode,
            paths,
            metadata,
        };
    }

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    _trackPath(pathId, paths, pathSet) {
        if (pathId && !pathSet.has(pathId)) {
            pathSet.add(pathId);
            paths.push({ pathId, segments: pathId.split('.') });
            if (ESB_DEBUG) console.log(`[ESB PATH CREATE] ${pathId}`);
        }
    }

    _stepLabel(step, evType) {
        switch (evType) {
            case 'var':
            case 'var_declare': return `${step.name || step.symbol || 'var'} = ${step.value ?? ''}`;
            case 'assignment': return `${step.name || step.symbol || 'var'} = ${step.value ?? ''}`;
            case 'output': return `output: "${step.text || step.value || ''}"`;
            case 'input': return `input → ${step.variable || step.name || '?'}`;
            case 'array_declaration': return `${step.name || 'array'}[${(step.dimensions || []).join('][')}]`;
            case 'array_assignment': return `${step.name || 'array'}[${(step.indices || []).join('][')}] = ${step.value ?? ''}`;
            case 'heap_alloc': return `alloc ${step.address || '?'} (${step.size || '?'} bytes)`;
            case 'pointer_alias': return `${step.name || 'ptr'} → ${step.targetName || step.address || '?'}`;
            case 'arg_bind': return `param ${step.symbol || step.name} = ${step.value ?? ''}`;
            case 'return': return `return ${step.returnValue ?? ''}`;
            default: return evType;
        }
    }

    _stepMeta(step, evType) {
        const base = {
            line: step.line,
            file: step.file,
            scopeDepth: step.scopeDepth,
        };
        switch (evType) {
            case 'var':
            case 'var_declare':
            case 'assignment':
                return { ...base, name: step.name || step.symbol, value: step.value, varType: step.varType };
            case 'array_declaration':
            case 'array_initialization':
            case 'array_assignment':
                return { ...base, name: step.name, dimensions: step.dimensions, indices: step.indices, value: step.value };
            case 'heap_alloc':
            case 'heap_write':
                return { ...base, address: step.address, size: step.size };
            case 'pointer_alias':
            case 'pointer_write':
            case 'pointer_deref':
            case 'pointer_deref_write':
                return { ...base, name: step.name, address: step.address, targetName: step.targetName };
            case 'output':
                return { ...base, text: step.text, rawText: step.rawText };
            case 'input':
                return { ...base, variable: step.variable, value: step.value, inputRequest: step.inputRequest };
            default:
                return base;
        }
    }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------
const executionStructureBuilder = new ExecutionStructureBuilderService();
export default executionStructureBuilder;
export { ExecutionStructureBuilderService };
