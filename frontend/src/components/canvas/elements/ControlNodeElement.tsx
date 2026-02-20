import React, { memo, useEffect, useRef, useState } from "react";
import { Circle, Group, Line, Rect, Text } from "react-konva";
import Konva from "konva";
import { resizeContainer } from "../utils/resizeContainer";

export interface ControlNodeElementProps {
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  controlKind: "if" | "else_if" | "else" | "switch" | "case" | "default" | "group";
  condition?: string;
  conditionResult?: boolean;
  branchTaken?: string;
  branchLabel?: string;
  branchState?: "active" | "skipped" | "pending";
  headerOnly?: boolean;
  isActive?: boolean;
  isNew?: boolean;
  stepNumber?: number;
  enterDelay?: number;
  onHoverChange?: (nodeId: string | null) => void;
  callerMode?: boolean;
  children?: React.ReactNode;
}

const HEADER_HEIGHT = 58;
const MIN_WIDTH = 320;
const MIN_HEADER_ONLY_HEIGHT = HEADER_HEIGHT + 10;
const MIN_BODY_HEIGHT = 90;
const BODY_PADDING = 12;

const kindLabel: Record<string, string> = {
  if: "IF",
  else_if: "ELSE IF",
  else: "ELSE",
  switch: "SWITCH",
  case: "CASE",
  default: "DEFAULT",
  group: "CONTROL",
};

export const ControlNodeElement: React.FC<ControlNodeElementProps> = memo(
  ({
    id,
    x,
    y,
    width = MIN_WIDTH,
    height = MIN_BODY_HEIGHT,
    controlKind,
    condition = "",
    conditionResult,
    branchTaken,
    branchLabel,
    branchState = "pending",
    headerOnly = false,
    isActive = false,
    isNew = false,
    stepNumber,
    enterDelay = 0,
    onHoverChange,
    callerMode: _callerMode = false,
    children,
  }) => {
    const groupRef = useRef<Konva.Group>(null);
    const [isHovered, setIsHovered] = useState(false);
    const isGroup = controlKind === "group";

    const bodyVisible = !isGroup && !headerOnly;
    const targetWidth = Math.max(MIN_WIDTH, width);
    const targetHeight = bodyVisible
      ? Math.max(height, HEADER_HEIGHT + MIN_BODY_HEIGHT)
      : MIN_HEADER_ONLY_HEIGHT;

    useEffect(() => {
      if (isGroup) return;
      const group = groupRef.current;
      if (!group) return;

      const runResize = () => {
        resizeContainer(group, {
          padding: BODY_PADDING,
          minWidth: targetWidth,
          minHeight: targetHeight,
        });
        group.getLayer()?.batchDraw();
      };

      if (isNew) {
        group.opacity(0);
        group.scaleX(0.92);
        group.scaleY(0.92);
        const baseY = group.y();
        group.y(baseY + 14);

        const play = () => {
          new Konva.Tween({
            node: group,
            opacity: 1,
            scaleX: 1,
            scaleY: 1,
            y: baseY,
            duration: 0.2,
            easing: Konva.Easings.EaseInOut,
            onFinish: runResize,
          }).play();
        };

        if (enterDelay > 0) {
          const timer = setTimeout(play, enterDelay);
          return () => clearTimeout(timer);
        }

        play();
        return;
      }

      const raf = requestAnimationFrame(runResize);
      return () => cancelAnimationFrame(raf);
    }, [isGroup, isNew, enterDelay, targetWidth, targetHeight, children]);

    if (isGroup) {
      return (
        <Group id={id} x={x} y={y}>
          {children}
        </Group>
      );
    }

    const indicatorPoints = [0, -8, 8, 0, 0, 8, -8, 0];
    const isCaseLike = controlKind === "case" || controlKind === "default" || controlKind === "switch";
    const hasMatched = conditionResult === true || branchState === "active";
    const isSkipped = branchState === "skipped";

    let resultLabel = "PENDING";
    if (controlKind === "else") {
      resultLabel = branchState === "active" ? "TRUE" : "SKIPPED";
    } else if (isCaseLike) {
      resultLabel = hasMatched ? "MATCHED" : isSkipped ? "SKIPPED" : "PENDING";
    } else if (conditionResult === true) {
      resultLabel = "TRUE";
    } else if (conditionResult === false) {
      resultLabel = "FALSE";
    } else if (isSkipped) {
      resultLabel = "SKIPPED";
    }

    const resultColor =
      resultLabel === "TRUE" || resultLabel === "MATCHED"
        ? "#FFD166"
        : resultLabel === "FALSE"
          ? "#FF6B6B"
          : resultLabel === "SKIPPED"
            ? "#B08968"
            : "#FFB347";
    const stateOpacity = resultLabel === "SKIPPED" ? 0.6 : 1;

    return (
      <Group
        ref={groupRef}
        id={id}
        x={x}
        y={y}
        name="auto-resize"
        onMouseEnter={() => {
          setIsHovered(true);
          onHoverChange?.(id);
        }}
        onMouseLeave={() => {
          setIsHovered(false);
          onHoverChange?.(null);
        }}
        opacity={stateOpacity}
      >
        <Rect
          name="glow-bg"
          x={-5}
          y={-5}
          width={targetWidth + 10}
          height={targetHeight + 10}
          fill="transparent"
          cornerRadius={12}
          shadowColor="rgba(255,140,0,0.7)"
          shadowBlur={isHovered || isActive ? 24 : 18}
          shadowOpacity={isHovered || isActive ? 0.6 : 0.45}
          opacity={1}
        />

        <Rect
          name="main-bg"
          width={targetWidth}
          height={targetHeight}
          fill="rgba(15,23,42,0.96)"
          stroke="rgba(255,140,0,0.7)"
          strokeWidth={isActive ? 2.8 : 2}
          cornerRadius={10}
          shadowColor="rgba(255,140,0,0.7)"
          shadowBlur={isHovered || isActive ? 20 : 18}
          shadowOpacity={0.35}
        />

        <Group name="content-bounds">
          <Rect
            width={targetWidth}
            height={HEADER_HEIGHT}
            cornerRadius={[10, 10, 0, 0]}
            fillLinearGradientStartPoint={{ x: 0, y: 0 }}
            fillLinearGradientEndPoint={{ x: targetWidth, y: HEADER_HEIGHT }}
            fillLinearGradientColorStops={[
              0,
              "#FF7A18",
              1,
              "#FFB347",
            ]}
            opacity={0.9}
          />

          <Line
            points={[0, HEADER_HEIGHT, targetWidth, HEADER_HEIGHT]}
            stroke="rgba(255,140,0,0.7)"
            strokeWidth={1.4}
          />

          <Group x={-14} y={HEADER_HEIGHT / 2}>
            <Line
              points={indicatorPoints}
              closed
              fill="#FFB347"
              stroke="#FFD08A"
              strokeWidth={1.5}
              shadowColor="rgba(255,154,60,0.7)"
              shadowBlur={10}
              shadowOpacity={0.75}
            />
          </Group>

          {isHovered && condition ? (
            <Group x={16} y={-28}>
              <Rect
                width={Math.min(Math.max(140, condition.length * 6.5), targetWidth - 32)}
                height={20}
                fill="rgba(15,23,42,0.95)"
                stroke="rgba(255,140,0,0.7)"
                strokeWidth={1}
                cornerRadius={6}
              />
              <Text
                text={condition}
                x={8}
                y={5}
                width={Math.min(Math.max(140, condition.length * 6.5), targetWidth - 32) - 16}
                fontSize={10}
                fill="#FFD9A8"
                fontFamily="monospace"
                ellipsis
              />
            </Group>
          ) : null}

          <Group x={14} y={10}>
            <Rect
              width={88}
              height={22}
              fill="rgba(15,23,42,0.34)"
              stroke="rgba(255,220,170,0.7)"
              strokeWidth={1}
              cornerRadius={11}
            />
            <Text
              text={kindLabel[controlKind] || "IF"}
              y={5}
              width={88}
              align="center"
              fontSize={11}
              fontStyle="bold"
              fill="#FFF0D9"
              fontFamily="monospace"
            />
          </Group>

          <Text
            text={condition || "(condition)"}
            x={14}
            y={36}
            width={targetWidth - 210}
            fontSize={11}
            fill="#FFF0D9"
            fontFamily="monospace"
            ellipsis
          />

          <Group x={targetWidth - 124} y={10}>
            <Rect
              width={110}
              height={22}
              fill="rgba(15,23,42,0.4)"
              stroke={resultColor}
              strokeWidth={1.4}
              cornerRadius={11}
              shadowColor={resultColor}
              shadowBlur={10}
              shadowOpacity={0.6}
            />
            <Text
              text={resultLabel}
              y={5}
              width={110}
              align="center"
              fontSize={10}
              fontStyle="bold"
              fill={resultColor}
              fontFamily="monospace"
            />
          </Group>

          {stepNumber !== undefined ? (
            <Text
              text={`#${stepNumber}`}
              x={targetWidth - 44}
              y={38}
              fontSize={9}
              fontStyle="bold"
              fill="#5B3B1B"
              fontFamily="monospace"
            />
          ) : null}

          {bodyVisible ? (
            <>
              <Rect
                x={10}
                y={HEADER_HEIGHT + 6}
                width={targetWidth - 20}
                height={Math.max(MIN_BODY_HEIGHT, targetHeight - HEADER_HEIGHT - 16)}
                fill="rgba(255,140,0,0.08)"
                stroke="rgba(255,140,0,0.32)"
                strokeWidth={1}
                cornerRadius={8}
              />
              <Group y={HEADER_HEIGHT + 10}>{children}</Group>
            </>
          ) : (
            <Text
              text={branchState === "active" ? "ACTIVE" : branchState.toUpperCase()}
              x={14}
              y={HEADER_HEIGHT + 2}
              fontSize={9}
              fontStyle="bold"
              fill={branchState === "active" ? "#FFD166" : branchState === "skipped" ? "#B08968" : "#FFB347"}
              fontFamily="monospace"
            />
          )}

          {branchTaken ? (
            <Text
              text={`branch: ${branchLabel || branchTaken}`}
              x={112}
              y={12}
              width={targetWidth - 248}
              fontSize={10}
              fill="#FFE3BF"
              fontFamily="monospace"
              ellipsis
            />
          ) : null}
        </Group>

        <Circle
          x={targetWidth + 6}
          y={HEADER_HEIGHT / 2}
          radius={4}
          fill="#ff9a3c"
          stroke="#ffffff22"
          strokeWidth={1}
          listening={false}
        />
      </Group>
    );
  },
);

ControlNodeElement.displayName = "ControlNodeElement";

export default ControlNodeElement;
