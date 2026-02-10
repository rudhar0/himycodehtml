import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { Stage, Layer, Group, Rect, Line, Text, Arrow } from "react-konva";
import Konva from "konva";
import { ZoomIn, ZoomOut, Maximize2, Move, Hand } from "lucide-react";
import { useExecutionStore } from "@store/slices/executionSlice";
import { useCanvasStore } from "@store/slices/canvasSlice";
import { useThemeStore } from "@store/slices/themeSlice";
import { VariableBox } from "./elements/VariableBox";
import { ArrayPanel } from "./elements/ArrayPanel";
import { ArrayReference } from "./elements/ArrayReference";
import { StackFrame } from "./elements/StackFrame";
import { StructView } from "./elements/StructView";
import { ClassView } from "./elements/ClassView";
import { OutputElement } from "./elements/OutputElement";
import { InputElement } from "./elements/InputElement";
import { HeapPointerElement } from "./elements/HeapPointerElement";
import { FunctionElement } from "./elements/FunctionElement";
import { CallElement } from "./elements/CallElement";
import { FunctionCallArrow } from "./elements/FunctionCallArrow";
import { ReturnElement } from "./elements/ReturnElement";
import { LayoutEngine, LayoutElement, BASE_FUNCTION_Z, STACK_Z_STEP } from "./layout/LayoutEngine";
import { InputDialog } from "./InputDialog";
import { socketService } from "../../api/socket.service";
import { getFocusPosition } from "../../utils/camera";
import { SmoothUpdateArrow } from "./elements/SmoothUpdateArrow";
import { LoopElement } from './elements/LoopElement';
import { ConditionElement } from './elements/ConditionElement';
import { SwitchElement, CaseElement } from './elements/SwitchElement';
import { IterationElement } from './elements/IterationElement';

const DARK_COLORS = {
  bg: "#0F172A",
  grid: "#1E293B",
  mainBorder: "#A855F7",
  globalBorder: "#2DD4BF",
  functionBorder: "#8B5CF6",
  overlayBg: "#1E293B",
  overlayBorder: "#334155",
  buttonBg: "#334155",
  buttonText: "#F1F5F9",
  textPrimary: "#F1F5F9",
  textSecondary: "#94A3B8",
  textMuted: "#64748B",
};

const LIGHT_COLORS = {
  bg: "#e8ecef",
  grid: "#d0d8e0",
  mainBorder: "#A855F7",
  globalBorder: "#2DD4BF",
  functionBorder: "#8B5CF6",
  overlayBg: "#f5f7f9",
  overlayBorder: "#c8d0d8",
  buttonBg: "#dde3e8",
  buttonText: "#1a2332",
  textPrimary: "#1a2332",
  textSecondary: "#5a6a7a",
  textMuted: "#8a9aaa",
};

const SPACING = {
  VERTICAL: 16,
  HORIZONTAL: 20,
  CONTAINER_PADDING: 20,
  HEADER_HEIGHT: 40,
};

const VAR_COLORS: Record<string, string> = {
  int: "#3B82F6",
  float: "#14B8A6",
  double: "#0891B2",
  string: "#8B5CF6",
  char: "#D946EF",
  boolean: "#F59E0B",
  long: "#6366F1",
  short: "#0EA5E9",
  byte: "#0284C7",
  default: "#64748B",
};
const getVarColor = (type: string) => {
  const normalized = type?.toLowerCase() || "default";
  if (normalized.includes("[]") || normalized.includes("array"))
    return "#10B981";
  if (normalized.includes("*") || normalized.includes("ptr")) return "#F59E0B";
  return VAR_COLORS[normalized] || VAR_COLORS.default;
};
export default function VisualizationCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const layerRef = useRef<Konva.Layer>(null);
  const executionTrace = useExecutionStore((state) => state.executionTrace);
  const currentStep = useExecutionStore((state) => state.currentStep);
  const getCurrentStep = useExecutionStore((state) => state.getCurrentStep);
  const isAnalyzing = useExecutionStore((state) => state.isAnalyzing);
  const { theme } = useThemeStore();
  const COLORS = theme === 'dark' ? DARK_COLORS : LIGHT_COLORS;
  const { setCanvasSize, zoom, setZoom, position, setPosition } =
    useCanvasStore();
  const [dimensions, setDimensions] = useState({ width: 1200, height: 800 });
  const [dragMode, setDragMode] = useState(false);
  const [inputDialogOpen, setInputDialogOpen] = useState(false);
  const [inputDialogProps, setInputDialogProps] = useState<any>(null);
  const [activeArrows, setActiveArrows] = useState<Map<string, any>>(new Map());
  const prevStepRef = useRef<number>(-1);
  const prevElementsRef = useRef<Map<string, any>>(new Map());
  const currentStepData = getCurrentStep();
  const state = currentStepData?.state;
  const fullLayout = useMemo(() => {
    if (!state || !executionTrace || executionTrace.steps.length === 0)
      return null;
    const layout = LayoutEngine.calculateLayout(
      executionTrace,
      currentStep,
      dimensions.width,
      dimensions.height,
    );

    return layout;
  }, [state, currentStep, executionTrace, dimensions.width, dimensions.height]);
  const visibleLayout = useMemo(() => {
    if (!fullLayout) return null;
    const filterChildren = (
      children: LayoutElement[] | undefined,
    ): LayoutElement[] => {
      if (!children) return [];
      return children
        .filter((child) => {
          const stepId = child.data?.birthStep ?? child.stepId;
          return stepId !== undefined && stepId <= currentStep;
        })
        .map((child) => ({
          ...child,
          children: filterChildren(child.children),
        }));
    };

    const filteredMainChildren = filterChildren(
      fullLayout.mainFunction.children,
    );
    const filteredGlobalChildren = filterChildren(
      fullLayout.globalPanel.children,
    );
    const filteredElements = fullLayout.elements.filter((el) => {
      const stepId = el.data?.birthStep ?? el.stepId;
      if (stepId === undefined || stepId > currentStep) return false;
      if (el.type === "array_panel") return false;
      return true;
    });

    const filteredFunctionArrows = (fullLayout.functionArrows || []).filter(
      (arrow) => arrow.stepId !== undefined && arrow.stepId <= currentStep,
    );

    const filtered = {
      ...fullLayout,
      mainFunction: {
        ...fullLayout.mainFunction,
        children: filteredMainChildren,
      },
      globalPanel: {
        ...fullLayout.globalPanel,
        children: filteredGlobalChildren,
      },
      elements: filteredElements,
      functionArrows: filteredFunctionArrows,
    };

    return filtered;
  }, [fullLayout, currentStep]);
  const elementAnimationStates = useMemo(() => {
    if (!visibleLayout) return new Map();
    const states = new Map<string, { isNew: boolean; isUpdated: boolean }>();
    const prevStep = prevStepRef.current;
    const prevElements = prevElementsRef.current;

    visibleLayout.elements.forEach((element) => {
      const didExistBefore = prevElements.has(element.id);
      const isNew =
        element.stepId === currentStep &&
        prevStep < currentStep &&
        !didExistBefore;

      const prev = prevElements.get(element.id);
      const dataChanged = prev
        ? JSON.stringify(prev.data) !== JSON.stringify(element.data)
        : false;
      const isUpdated = !isNew && !!prev && dataChanged;

      states.set(element.id, { isNew, isUpdated });
    });

    return states;
  }, [visibleLayout, currentStep]);
  const enterDelayMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!visibleLayout) return map;
    const visitedIds = new Set<string>();
    const allVisibleElements: LayoutElement[] = [];
    const traverse = (el: LayoutElement) => {
      if (visitedIds.has(el.id)) return;
      visitedIds.add(el.id);
      allVisibleElements.push(el);
      if (el.children) el.children.forEach(traverse);
    };

    if (visibleLayout.mainFunction) traverse(visibleLayout.mainFunction);
    if (visibleLayout.globalPanel) traverse(visibleLayout.globalPanel);
    visibleLayout.elements.forEach(traverse);

    const newElements = allVisibleElements.filter(
      (el) => elementAnimationStates.get(el.id)?.isNew,
    );
    newElements.sort((a, b) => (a.y || 0) - (b.y || 0));

    newElements.forEach((el, idx) => {
      map.set(el.id, idx * 300);
    });

    return map;
  }, [visibleLayout, elementAnimationStates]);
  useEffect(() => {
    if (!visibleLayout) return;
    const map = new Map<string, any>();
    visibleLayout.elements.forEach((el) => {
      map.set(el.id, {
        id: el.id,
        data: el.data ? JSON.parse(JSON.stringify(el.data)) : undefined,
      });
    });
    prevElementsRef.current = map;
  }, [visibleLayout]);
  useEffect(() => {
    prevStepRef.current = currentStep;
  }, [currentStep]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !visibleLayout) return;

    visibleLayout.elements.forEach((el) => {
        if (el.type === 'function_call' && el.metadata?.stackIndex !== undefined) {
            const node = layer.findOne(`#${el.id}`);
            if (node) {
                const zIndex = BASE_FUNCTION_Z + (el.metadata.stackIndex * STACK_Z_STEP);
                node.zIndex(zIndex);
            }
        }
    });
    layer.batchDraw();
  }, [visibleLayout, currentStep]);
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        setDimensions({ width, height });
        setCanvasSize(width, height);
      }
    };
    updateSize();
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updateSize)
        : null;
    if (ro && containerRef.current) ro.observe(containerRef.current);
    window.addEventListener("resize", updateSize);
    return () => {
      window.removeEventListener("resize", updateSize);
      if (ro) ro.disconnect();
    };
  }, [setCanvasSize]);
  useEffect(() => {
    if (!visibleLayout || !stageRef.current) return;
    const movingForward = prevStepRef.current < currentStep;

    const isFinalStep = executionTrace && 
                        executionTrace.steps.length > 0 && 
                        currentStep === executionTrace.steps.length - 1;
    
    if (isFinalStep) {
        const stage = stageRef.current;
        const mainFrame = visibleLayout.mainFunction;
        if (mainFrame) {
             const targetPos = getFocusPosition(mainFrame, dimensions, zoom);
             new Konva.Tween({
                node: stage,
                x: targetPos.x,
                y: targetPos.y,
                duration: 0.8,
                easing: Konva.Easings.StrongEaseOut,
                onFinish: () => setPosition({ x: stage.x(), y: stage.y() }),
             }).play();
        }
        return;
    }

    const focusCandidates = visibleLayout.elements.filter((el) => {
      const animState = elementAnimationStates.get(el.id);
      return (animState?.isNew && movingForward) || animState?.isUpdated;
    });

    if (visibleLayout.arrayPanel && movingForward) {
      const arrayPanelStepId =
        visibleLayout.arrayPanel.stepId ||
        visibleLayout.arrayPanel.data?.stepId ||
        0;
      if (arrayPanelStepId === currentStep) {
        const targetPos = getFocusPosition(
          visibleLayout.arrayPanel,
          dimensions,
          zoom,
        );
        const stage = stageRef.current;

        new Konva.Tween({
          node: stage,
          x: targetPos.x,
          y: targetPos.y,
          duration: 0.4,
          easing: Konva.Easings.EaseInOut,
          onFinish: () => {
            setPosition({ x: stage.x(), y: stage.y() });
          },
        }).play();
        return;
      }
    }

    if (focusCandidates.length === 0) return;

    const focusTarget = focusCandidates.reduce(
      (prev, curr) => {
        if (!prev) return curr;
        return (prev.y ?? 0) > (curr.y ?? 0) ? prev : curr;
      },
      undefined as LayoutElement | undefined,
    );

    if (!focusTarget) return;

    const targetPos = getFocusPosition(focusTarget, dimensions, zoom);
    const stage = stageRef.current;

    new Konva.Tween({
      node: stage,
      x: targetPos.x,
      y: targetPos.y,
      duration: 0.4,
      easing: Konva.Easings.EaseInOut,
      onFinish: () => {
        setPosition({ x: stage.x(), y: stage.y() });
      },
    }).play();
  }, [
    currentStep,
    elementAnimationStates,
    dimensions,
    zoom,
    setPosition,
    visibleLayout,
  ]);
  useEffect(() => {
    if (!visibleLayout || !visibleLayout.updateArrows) return;
    const newArrows = new Map<string, any>();
    visibleLayout.updateArrows.forEach((arrow) => {
      if (arrow.stepId === currentStep) {
        newArrows.set(arrow.id, arrow.data);
      }
    });

    setActiveArrows(newArrows);

    const timeout = setTimeout(() => {
      setActiveArrows(new Map());
    }, 1800);

    return () => clearTimeout(timeout);
  }, [currentStep, visibleLayout]);
  const handleZoomIn = useCallback(() => {
    setZoom(Math.min(zoom + 0.1, 3));
  }, [zoom, setZoom]);
  const handleZoomOut = useCallback(() => {
    setZoom(Math.max(zoom - 0.1, 0.3));
  }, [zoom, setZoom]);
  const handleFitToScreen = useCallback(() => {
    setZoom(1);
    setPosition({ x: 0, y: 0 });
  }, [setZoom, setPosition]);
  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      const oldScale = stage.scaleX();
      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const mousePointTo = {
        x: (pointer.x - stage.x()) / oldScale,
        y: (pointer.y - stage.y()) / oldScale,
      };

      const newScale = e.evt.deltaY > 0 ? oldScale * 0.9 : oldScale * 1.1;
      const clampedScale = Math.max(0.1, Math.min(newScale, 5));

      setZoom(clampedScale);
      setPosition({
        x: pointer.x - mousePointTo.x * clampedScale,
        y: pointer.y - mousePointTo.y * clampedScale,
      });
    },
    [setZoom, setPosition],
  );
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === " ") {
        e.preventDefault();
        setDragMode(!dragMode);
      } else if (e.key === "+" || e.key === "=") {
        handleZoomIn();
      } else if (e.key === "-" || e.key === "_") {
        handleZoomOut();
      } else if (e.key === "0") {
        handleFitToScreen();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dragMode, handleZoomIn, handleZoomOut, handleFitToScreen]);
  useEffect(() => {
    const handleInputRequired = (data: any) => {
      console.log(
        "[VisualizationCanvas] Input required during analysis:",
        data,
      );
      useExecutionStore.getState().pause();
      setInputDialogProps({
        prompt: data.prompt || `Enter value for ${data.varName || "variable"}:`,
        format: data.format || "%d",
        expectedType: data.type || "int",
        varName: data.varName,
        line: data.line,
        isAnalysis: isAnalyzing,
      });
      setInputDialogOpen(true);
    };

    socketService.on("execution:input_required", handleInputRequired);
    return () => {
      socketService.off("execution:input_required", handleInputRequired);
    };
  }, [isAnalyzing]);
  const handleInputSubmit = (value: string | number) => {
    console.log("[VisualizationCanvas] Submitting input:", value);
    socketService.provideInput(value);
    if (visibleLayout) {
      const inputElements = visibleLayout.elements.filter(
        (el) => el.type === "input" && el.data?.isWaiting,
      );
      inputElements.forEach((inputEl) => {
        inputEl.data = {
          ...inputEl.data,
          value: value,
          isWaiting: false,
        };
      });

      if (visibleLayout.mainFunction?.children) {
        visibleLayout.mainFunction.children.forEach((child) => {
          if (child.type === "input" && child.data?.isWaiting) {
            child.data = {
              ...child.data,
              value: value,
              isWaiting: false,
            };
          }
        });
      }
    }

    setInputDialogOpen(false);
    setInputDialogProps(null);
  };
  const filterChildren = (children: LayoutElement[] | undefined) => {
    if (!children) return [];
    const idsToExclude = new Set<string>();
    const varGroups = new Map<string, LayoutElement[]>();

    children.forEach((child) => {
      if (child.type === "variable" && child.data?.name) {
        const name = child.data.name;
        if (!varGroups.has(name)) varGroups.set(name, []);
        varGroups.get(name)!.push(child);
      }
    });

    varGroups.forEach((vars) => {
      if (vars.length > 1) {
        vars.sort((a, b) => (a.stepId || 0) - (b.stepId || 0));

        for (let i = 0; i < vars.length; i++) {
          const current = vars[i];
          const next = vars[i + 1];

          if (
            next &&
            current.stepId === next.stepId &&
            current.data?.value === undefined &&
            next.data?.value !== undefined
          ) {
            idsToExclude.add(current.id);
          }
        }
      }
    });

    return children.filter((c) => !idsToExclude.has(c.id));
  };
  const renderElement = (
    element: LayoutElement,
    parentX: number = 0,
    parentY: number = 0,
  ) => {
    const { type, data, id, x, y, width, height, children, stepId } = element;
    const animState = elementAnimationStates.get(id) || {
      isNew: false,
      isUpdated: false,
    };
    const { isNew, isUpdated } = animState;
    switch (type) {
      case "main":
        return (
          <StackFrame
            key={id}
            id={id}
            functionName="main()"
            x={x}
            y={y}
            width={width}
            height={height}
            isNew={false}
          >
            {filterChildren(children).map((child, idx) => {
              const relativeX = child.x - x;
              const relativeY = child.y - y - SPACING.HEADER_HEIGHT;

              return (
                <Group key={child.id} x={relativeX} y={relativeY}>
                  {renderElement(
                    { ...child, x: 0, y: 0 },
                    x,
                    y,
                  )}
                </Group>
              );
            })}
          </StackFrame>
        );

      case "call_site":
        return (
          <CallElement
            key={id}
            id={id}
            functionName={data?.functionName || "call"}
            args={data?.args || "()"}
            x={x}
            y={y}
            width={width}
            height={height}
            isNew={isNew}
            stepNumber={
              element.stepId !== undefined ? element.stepId + 1 : undefined
            }
          />
        );

      case "function_call": {
        return (
          <FunctionElement
            key={`${id}-${stepId}`}
            id={id}
            functionName={data?.functionName || "function"}
            returnType={data?.returnType || "void"}
            x={x}
            y={y}
            isRecursive={data?.isRecursive || false}
            depth={data?.depth || 0}
            calledFrom={data?.calledFrom}
            parameters={data?.parameters || []}
            localVarCount={data?.localVarCount || 0}
            isNew={isNew}
            isActive={data?.isActive || false}
            isReturning={data?.isReturning || false}
            stepNumber={stepId}
            enterDelay={enterDelayMap.get(id) || 0}
          >
            {filterChildren(children).map((child) => {
              const relativeX = child.x - x;
              const relativeY = child.y - y - 55;
              return (
                <Group key={child.id} x={relativeX} y={relativeY}>
                  {renderElement(
                    { ...child, x: 0, y: 0 },
                    x,
                    y,
                  )}
                </Group>
              );
            })}
          </FunctionElement>
        );
      }

      case "function_return": {
        return (
          <ReturnElement
            key={`${id}-${stepId}`}
            id={id}
            x={x}
            y={y}
            returnValue={data?.returnValue}
            functionName={data?.functionName || "function"}
            frameId={data?.frameId || ""}
            isNew={isNew}
            stepNumber={stepId}
            enterDelay={enterDelayMap.get(id) || 0}
          />
        );
      }

      case "heap_pointer": {
        return (
          <HeapPointerElement
            key={`${id}-${stepId}`}
            id={id}
            name={data?.name || "ptr"}
            type={data?.type || "void*"}
            value={data?.value}
            address={data?.address}
            x={x}
            y={y}
            isNew={isNew}
            isUpdated={isUpdated}
            stepNumber={stepId}
            enterDelay={enterDelayMap.get(id) || 0}
            pointsTo={data?.pointsTo}
            isHeapBacked={data?.memoryRegion === "heap"}
            memoryRegion={data?.memoryRegion || "stack"}
            decayedFromArray={data?.decayedFromArray}
            aliasOf={data?.aliasOf}
            explanation={data?.explanation}
          />
        );
      }

      case "variable": {
        let varState: "declared" | "initialized" | "multiple-init" | "updated" =
          "initialized";
        if (data?.state === "declared") {
          varState = "declared";
        } else if (data?.state === "multiple-init") {
          varState = "multiple-init";
        } else if (data?.state === "updated") {
          varState = "updated";
        } else if (element.subtype === "variable_declaration_only") {
          varState = "declared";
        } else if (element.subtype === "variable_multiple_declaration") {
          varState = "multiple-init";
        } else if (element.subtype === "variable_value_change" || isUpdated) {
          varState = "updated";
        }

        const effectiveIsNew = isNew || isUpdated;

        const normalizedType = (data?.type || data?.primitive || "")
          .toString()
          .toLowerCase();
        const isArrayVar =
          normalizedType.includes("[]") ||
          normalizedType.includes("array") ||
          data?.dimensions?.length > 0;

        if (isArrayVar) {
          let dimensionText = "";
          if (data?.dimensions && data.dimensions.length > 0) {
            dimensionText = ` [${data.dimensions.join("][")}]`;
          } else if (normalizedType.includes("[")) {
            const match = normalizedType.match(/\[(\d+)\]/);
            dimensionText = match ? ` [${match[1]}]` : "";
          }

          return (
            <VariableBox
              key={`${id}-${stepId}`}
              id={id}
              name={data?.name || ""}
              type={data?.type || data?.primitive || "int"}
              value={`→ array${dimensionText}`}
              address={data?.address || ""}
              x={x}
              y={y}
              width={width}
              height={height}
              section="stack"
              isNew={effectiveIsNew}
              isUpdated={isUpdated}
              state="initialized"
              stepNumber={stepId}
              enterDelay={enterDelayMap.get(id) || 0}
              color="#60A5FA"
              explanation={data?.explanation}
            />
          );
        }

        return (
          <VariableBox
            key={`${id}-${stepId}`}
            id={id}
            name={data?.name || ""}
            type={data?.type || data?.primitive || "int"}
            value={data?.value}
            address={data?.address || ""}
            x={x}
            y={y}
            width={width}
            height={height}
            section="stack"
            isNew={effectiveIsNew}
            isUpdated={isUpdated}
            state={varState}
            stepNumber={stepId}
            enterDelay={enterDelayMap.get(id) || 0}
            color={getVarColor(data?.type || data?.primitive)}
            explanation={data?.explanation}
          />
        );
      }

      case "array_panel":
        return null;

      case "output":
        return (
          <OutputElement
            key={id}
            id={id}
            value={data?.text || ""}
            x={x}
            y={y}
            width={width}
            height={height}
            isNew={isNew}
            subtype={element.subtype as any}
            explanation={data?.explanation}
          />
        );

      case "input":
        return (
          <InputElement
            key={id}
            id={id}
            value={data?.value}
            prompt={data?.prompt}
            format={data?.format}
            varName={data?.varName || data?.variables?.[0]}
            x={x}
            y={y}
            width={width}
            height={height}
            isNew={isNew}
            isWaiting={!data?.value}
          />
        );

      case "global":
        let globalState:
          | "declared"
          | "initialized"
          | "multiple-init"
          | "updated" = "initialized";
        if (data?.state === "declared") globalState = "declared";
        else if (data?.state === "updated") globalState = "updated";
        else if (isUpdated) globalState = "updated";

        const effectiveGlobalIsNew = isNew || isUpdated;

        return (
          <VariableBox
            key={`${id}-${stepId}`}
            id={id}
            name={data?.name || ""}
            type={data?.type || data?.primitive || "int"}
            value={data?.value}
            address={data?.address || ""}
            x={x}
            y={y}
            width={width}
            height={height}
            section="global"
            isNew={effectiveGlobalIsNew}
            isUpdated={isUpdated}
            state={globalState}
            stepNumber={stepId}
            color={getVarColor(data?.type || data?.primitive)}
            explanation={data?.explanation}
          />
        );

      case "function":
        return (
          <StackFrame
            key={id}
            id={id}
            functionName={data?.function || "function()"}
            x={x}
            y={y}
            width={width}
            height={height}
            isNew={isNew}
          >
            {filterChildren(children).map((child) => {
              const relativeX = child.x - x;
              const relativeY = child.y - y - SPACING.HEADER_HEIGHT;
              return (
                <Group key={child.id} x={relativeX} y={relativeY}>
                  {renderElement(
                    { ...child, x: 0, y: 0 },
                    x,
                    y,
                  )}
                </Group>
              );
            })}
          </StackFrame>
        );

      case "struct":
        return (
          <StructView
            key={id}
            id={id}
            typeName={data?.type || "struct"}
            x={x}
            y={y}
            width={width}
            height={height}
            isNew={isNew}
          >
            {filterChildren(children).map((child) => {
              const relativeX = child.x - x;
              const relativeY = child.y - y - SPACING.HEADER_HEIGHT;
              return (
                <Group key={child.id} x={relativeX} y={relativeY}>
                  {renderElement(
                    { ...child, x: 0, y: 0 },
                    x,
                    y,
                  )}
                </Group>
              );
            })}
          </StructView>
        );

      case "class":
        return (
          <ClassView
            key={id}
            id={id}
            typeName={data?.type || "class"}
            objectName={data?.name || ""}
            x={x}
            y={y}
            width={width}
            height={height}
            isNew={isNew}
          >
            {filterChildren(children).map((child) => {
              const relativeX = child.x - x;
              const relativeY = child.y - y - SPACING.HEADER_HEIGHT;
              return (
                <Group key={child.id} x={relativeX} y={relativeY}>
                  {renderElement(
                    { ...child, x: 0, y: 0 },
                    x,
                    y,
                  )}
                </Group>
              );
            })}
          </ClassView>
        );

      case "loop": {
        if (element.subtype === 'iteration') {
            return (
              <IterationElement
                key={id}
                id={id}
                iteration={data?.iteration ?? 0}
                x={x}
                y={y}
                width={width}
                height={height}
              >
                {filterChildren(children).map((child) => {
                  const relativeX = child.x - x;
                  const relativeY = child.y - y - 25; // Adjusted offset for Iteration
                  return (
                    <Group key={child.id} x={relativeX} y={relativeY}>
                      {renderElement(
                        { ...child, x: 0, y: 0 },
                        x,
                        y,
                      )}
                    </Group>
                  );
                })}
              </IterationElement>
            );
        }

        return (
          <LoopElement
            key={`${id}-${stepId}`}
            id={id}
            loopType={data?.loopType || 'for'}
            loopId={data?.loopId || 0}
            currentIteration={data?.currentIteration}
            totalIterations={data?.totalIterations}
            isActive={data?.isActive || false}
            isComplete={data?.isComplete || false}
            initialization={data?.initialization}
            condition={data?.condition}
            update={data?.update}
            conditionResult={data?.conditionResult}
            x={x}
            y={y}
            width={width}
            height={height}
            isNew={isNew}
            stepNumber={stepId}
            enterDelay={enterDelayMap.get(id) || 0}
            onSkip={() => {
              if (data?.endStep) {
                 useExecutionStore.getState().jumpToStep(data.endStep);
              }
            }}
          >
            {filterChildren(children).map((child) => {
              const relativeX = child.x - x;
              const relativeY = child.y - y - SPACING.HEADER_HEIGHT;
              return (
                <Group key={child.id} x={relativeX} y={relativeY}>
                  {renderElement(
                    { ...child, x: 0, y: 0 },
                    x,
                    y,
                  )}
                </Group>
              );
            })}
          </LoopElement>
        );
      }

      case "condition":
        if (element.subtype === 'switch') {
             return (
                 <SwitchElement
                    key={id}
                    id={id}
                    x={x}
                    y={y}
                    width={width}
                    height={height}
                    expression={data?.expression || '...'}
                 >
                    {filterChildren(children).map((child) => {
                      const relativeX = child.x - x;
                      const relativeY = child.y - y - 35; // Header height
                      return (
                        <Group key={child.id} x={relativeX} y={relativeY}>
                          {renderElement(
                            { ...child, x: 0, y: 0 },
                            x,
                            y,
                          )}
                        </Group>
                      );
                    })}
                 </SwitchElement>
             );
        }
        if (element.subtype === 'case') {
             return (
                 <CaseElement
                    key={id}
                    id={id} // Add ID
                    x={x} // Add X
                    y={y} // Add Y
                    width={width}
                    height={height}
                    label={data?.label || 'default'}
                    isMatched={data?.isMatched || false}
                 >
                    {filterChildren(children).map((child) => {
                      const relativeX = child.x - x;
                      const relativeY = child.y - y - 28; // Header height
                      return (
                        <Group key={child.id} x={relativeX} y={relativeY}>
                          {renderElement(
                            { ...child, x: 0, y: 0 },
                            x,
                            y,
                          )}
                        </Group>
                      );
                    })}
                 </CaseElement>
             );
        }

        return (
          <ConditionElement
            key={`${id}-${stepId}`}
            id={id}
            conditionType={data?.conditionType || 'if'}
            condition={data?.condition || ''}
            conditionResult={data?.conditionResult}
            branchTaken={data?.branchTaken}
            caseValue={data?.caseValue}
            isActive={data?.isActive || false}
            x={x}
            y={y}
            width={width}
            height={height}
            isNew={isNew}
            stepNumber={stepId}
            enterDelay={enterDelayMap.get(id) || 0}
            switchExpression={data?.switchExpression}
            totalCases={data?.totalCases}
          >
            {filterChildren(children).map((child) => {
              const relativeX = child.x - x;
              const relativeY = child.y - y - SPACING.HEADER_HEIGHT;
              return (
                <Group key={child.id} x={relativeX} y={relativeY}>
                  {renderElement(
                    { ...child, x: 0, y: 0 },
                    x,
                    y,
                  )}
                </Group>
              );
            })}
          </ConditionElement>
        );

      default:
        return null;
    }
  };
  if (!state || !visibleLayout) {
    return (
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: COLORS.bg,
          color: COLORS.textSecondary,
          fontFamily: "system-ui",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "64px", marginBottom: "20px", opacity: 0.5 }}>
            🎨
          </div>
          <div
            style={{
              fontSize: "20px",
              fontWeight: 600,
              marginBottom: "12px",
              color: COLORS.textPrimary,
            }}
          >
            Responsive Canvas Ready
          </div>
          <div style={{ fontSize: "14px", color: COLORS.textMuted }}>
            Run your code to see animated visualization
          </div>
        </div>
      </div>
    );
  }
  return (
    <>
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          backgroundColor: COLORS.bg,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            zIndex: 100,
            display: "flex",
            gap: "8px",
            backgroundColor: COLORS.overlayBg,
            padding: "10px",
            borderRadius: "10px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
            border: `1px solid ${COLORS.overlayBorder}`,
          }}
        >
          <button
            onClick={() => setDragMode(!dragMode)}
            style={{
              padding: "8px 12px",
              backgroundColor: dragMode ? "#3B82F6" : COLORS.buttonBg,
              border: "none",
              borderRadius: "6px",
              color: dragMode ? "#FFFFFF" : COLORS.buttonText,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "12px",
              fontWeight: 600,
              transition: "all 0.2s",
            }}
            title="Pan Mode (Space)"
          >
            {dragMode ? <Hand size={16} /> : <Move size={16} />}
            {dragMode ? "Pan" : "Select"}
          </button>
          <button
            onClick={handleZoomIn}
            title="Zoom In (+)"
            style={{
              padding: "8px",
              backgroundColor: COLORS.buttonBg,
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
            }}
          >
            <ZoomIn size={20} color={COLORS.buttonText} />
          </button>
          <button
            onClick={handleZoomOut}
            title="Zoom Out (-)"
            style={{
              padding: "8px",
              backgroundColor: COLORS.buttonBg,
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
            }}
          >
            <ZoomOut size={20} color={COLORS.buttonText} />
          </button>
          <button
            onClick={handleFitToScreen}
            title="Fit to Screen (0)"
            style={{
              padding: "8px",
              backgroundColor: COLORS.buttonBg,
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
            }}
          >
            <Maximize2 size={20} color={COLORS.buttonText} />
          </button>
        </div>
        <div
          style={{
            position: "absolute",
            top: 16,
            left: 16,
            zIndex: 100,
            backgroundColor: COLORS.overlayBg,
            padding: "10px 16px",
            borderRadius: "10px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
            border: `1px solid ${COLORS.overlayBorder}`,
            color: COLORS.textPrimary,
            fontSize: "14px",
            fontWeight: 600,
          }}
        >
          Step {currentStep + 1} / {executionTrace?.totalSteps ?? 0}
        </div>

        {dimensions.width > 0 && dimensions.height > 0 && (
          <Stage
            ref={stageRef}
            width={dimensions.width}
            height={dimensions.height}
            onWheel={handleWheel}
            scaleX={zoom}
            scaleY={zoom}
            x={position.x}
            y={position.y}
            draggable={dragMode}
            onDragMove={(e) => {
              setPosition({
                x: e.target.x(),
                y: e.target.y(),
              });
            }}
            onDragEnd={(e) => {
              setPosition({
                x: e.target.x(),
                y: e.target.y(),
              });
            }}
          >
            <Layer ref={layerRef}>
              <Group>
                {Array.from({ length: Math.floor(dimensions.width / 20) }).map(
                  (_, i) => (
                    <Line
                      key={`v-grid-${i}`}
                      points={[i * 20, 0, i * 20, dimensions.height]}
                      stroke={COLORS.grid}
                      strokeWidth={0.5}
                    />
                  ),
                )}
                {Array.from({ length: Math.floor(dimensions.height / 20) }).map(
                  (_, i) => (
                    <Line
                      key={`h-grid-${i}`}
                      points={[0, i * 20, dimensions.width, i * 20]}
                      stroke={COLORS.grid}
                      strokeWidth={0.5}
                    />
                  ),
                )}
              </Group>

              {visibleLayout.mainFunction && (
                <Group x={0} y={0}>
                  {renderElement(visibleLayout.mainFunction)}
                </Group>
              )}

              {visibleLayout.elements
                .filter(
                  (el) =>
                    el.type === "function_call",
                )
                .map((el) => (
                  <Group key={el.id} x={0} y={0}>
                    {renderElement(el)}
                  </Group>
                ))}

              {visibleLayout.functionArrows &&
                visibleLayout.functionArrows.length > 0 && (
                  <Group>
                    {visibleLayout.functionArrows.map((arrow) => (
                      <FunctionCallArrow
                        key={arrow.id}
                        id={arrow.id}
                        fromX={arrow.data.fromX}
                        fromY={arrow.data.fromY}
                        toX={arrow.data.toX}
                        toY={arrow.data.toY}
                        label={arrow.data.label}
                        isActive={arrow.stepId === currentStep}
                        isRecursive={arrow.data.isRecursive || false}
                        isNew={arrow.stepId === currentStep}
                      />
                    ))}
                  </Group>
                )}

              {visibleLayout.arrayPanel &&
                visibleLayout.arrayPanel.data?.arrays &&
                visibleLayout.arrayPanel.data.arrays.length > 0 && (
                  <Group x={0} y={0}>
                    <ArrayPanel
                      id={visibleLayout.arrayPanel.id}
                      x={visibleLayout.arrayPanel.x}
                      y={visibleLayout.arrayPanel.y}
                      arrays={visibleLayout.arrayPanel.data.arrays}
                      currentStep={currentStep}
                      isNew={false}
                    />
                  </Group>
                )}

              {visibleLayout.globalPanel &&
                visibleLayout.globalPanel.children &&
                visibleLayout.globalPanel.children.length > 0 && (
                  <Group x={0} y={0}>
                    <Arrow
                      points={[
                        visibleLayout.mainFunction.x +
                          visibleLayout.mainFunction.width,
                        visibleLayout.mainFunction.y +
                          visibleLayout.mainFunction.height / 2,
                        visibleLayout.globalPanel.x - 20,
                        visibleLayout.globalPanel.y + 60,
                      ]}
                      stroke={COLORS.globalBorder}
                      strokeWidth={2}
                      fill={COLORS.globalBorder}
                      pointerLength={10}
                      pointerWidth={10}
                      dash={[10, 5]}
                      opacity={0.6}
                    />

                    <Rect
                      x={visibleLayout.globalPanel.x}
                      y={visibleLayout.globalPanel.y}
                      width={visibleLayout.globalPanel.width}
                      height={SPACING.HEADER_HEIGHT}
                      fill={COLORS.globalBorder}
                      fillOpacity={0.2}
                      stroke={COLORS.globalBorder}
                      strokeWidth={2}
                      cornerRadius={[8, 8, 0, 0]}
                    />
                    <Text
                      text="Globals"
                      x={visibleLayout.globalPanel.x + 12}
                      y={visibleLayout.globalPanel.y + 12}
                      fontSize={16}
                      fontStyle="bold"
                      fill="#F1F5F9"
                      fontFamily="monospace"
                    />
                    {filterChildren(visibleLayout.globalPanel.children).map(
                      (child) => {
                        return (
                          <Group key={child.id} x={child.x} y={child.y}>
                            {renderElement(child)}
                          </Group>
                        );
                      },
                    )}
                  </Group>
                )}

              {activeArrows.size > 0 && (
                <Group>
                  {Array.from(activeArrows.entries()).map(
                    ([arrowId, arrowData]) => (
                      <SmoothUpdateArrow
                        key={arrowId}
                        id={arrowId}
                        fromX={arrowData.fromX}
                        fromY={arrowData.fromY}
                        toX={arrowData.toX}
                        toY={arrowData.toY}
                        color="#F59E0B"
                        label={`${arrowData.arrayName}[${arrowData.indices?.join(",")}]`}
                        duration={0.6}
                        onComplete={() => {
                          setActiveArrows((prev) => {
                            const next = new Map(prev);
                            next.delete(arrowId);
                            return next;
                          });
                        }}
                      />
                    ),
                  )}
                </Group>
              )}

              {visibleLayout.arrayReferences &&
                visibleLayout.arrayReferences.length > 0 && (
                  <Group>
                    {visibleLayout.arrayReferences.map((ref) => {
                      return (
                        <ArrayReference
                          key={ref.id}
                          id={ref.id}
                          fromX={ref.data.fromX}
                          fromY={ref.data.fromY}
                          toX={ref.data.toX}
                          toY={ref.data.toY}
                          variableName={ref.data.variableName}
                          arrayName={ref.data.arrayName}
                          isNew={ref.stepId === currentStep}
                        />
                      );
                    })}
                  </Group>
                )}
            </Layer>
          </Stage>
        )}
      </div>

      {inputDialogOpen && inputDialogProps && (
        <InputDialog
          isOpen={inputDialogOpen}
          prompt={inputDialogProps.prompt}
          format={inputDialogProps.format}
          expectedType={inputDialogProps.expectedType}
          onClose={() => {
            setInputDialogOpen(false);
            setInputDialogProps(null);
          }}
          onSubmit={handleInputSubmit}
        />
      )}
    </>
  );
}
