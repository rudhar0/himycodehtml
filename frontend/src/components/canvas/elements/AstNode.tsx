
import React, { useEffect, useRef } from 'react';
import { Group, Rect, Text } from 'react-konva';
import { SyntaxNode } from 'web-tree-sitter';
import type { ExecutionStep } from '@types/index';
import gsap from 'gsap'; // Import gsap

interface AstNodeProps {
  node: SyntaxNode;
  x: number;
  y: number;
  activeNode?: SyntaxNode | null;
  currentStep?: ExecutionStep | null; // New prop
}

const PADDING_X = 10;
const PADDING_Y = 10;
const VERTICAL_SPACING = 20;
const CHILD_INDENT = 30;

// Helper function to determine node text and style
const getNodeTextAndStyle = (node: SyntaxNode) => {
  let text = node.type;
  let color = '#9CA3AF';
  let isBold = false;
  let width = 200;
  let height = 40;

  switch (node.type) {
    case 'translation_unit':
      text = 'Program';
      color = '#F1F5F9';
      isBold = true;
      width = 350;
      height = 60;
      break;
    case 'function_definition':
      const functionName = node.childForFieldName('declarator')?.lastChild?.text || 'anonymous';
      text = `Function: ${functionName}`;
      color = '#2DD4BF';
      isBold = true;
      width = 300;
      height = 60;
      break;
    case 'parameter_declaration':
      text = `Param: ${node.text}`;
      color = '#A78BFA';
      break;
    case 'compound_statement':
      text = '{ ... }'; // Represent block of code
      color = '#6B7280';
      width = 200;
      height = 30;
      break;
    case 'if_statement':
      const ifCondition = node.childForFieldName('condition')?.text || 'unknown condition';
      text = `If (${ifCondition})`;
      color = '#FBBF24';
      isBold = true;
      width = 250;
      height = 50;
      break;
    case 'else_clause':
      text = `Else`;
      color = '#FBBF24';
      isBold = true;
      width = 150;
      height = 40;
      break;
    case 'for_statement':
      const forCondition = node.childForFieldName('condition')?.text || '';
      const forInit = node.childForFieldName('initializer')?.text || '';
      const forUpdate = node.childForFieldName('update')?.text || '';
      text = `For (${forInit}; ${forCondition}; ${forUpdate})`;
      color = '#FBBF24';
      isBold = true;
      width = 350;
      height = 50;
      break;
    case 'while_statement':
      const whileCondition = node.childForFieldName('condition')?.text || 'unknown condition';
      text = `While (${whileCondition})`;
      color = '#FBBF24';
      isBold = true;
      width = 250;
      height = 50;
      break;
    case 'do_statement':
      text = `Do-While`;
      color = '#FBBF24';
      isBold = true;
      width = 200;
      height = 50;
      break;
    case 'declaration':
      text = `Declare: ${node.text.split('\n')[0]}`;
      color = '#93C5FD';
      width = 220;
      break;
    case 'expression_statement':
      text = `Expr: ${node.text.split('\n')[0]}`;
      color = '#E2E8F0';
      break;
    case 'return_statement':
      text = `Return ${node.child(1)?.text || ''}`;
      color = '#EF4444';
      isBold = true;
      width = 180;
      break;
    case 'call_expression':
      const funcCallName = node.child(0)?.text || 'call';
      text = `Call: ${funcCallName}`;
      color = '#FBBF24';
      isBold = true;
      width = 200;
      break;
    // Generic handlers for other node types
    default:
      if (node.text.length > 30 && node.type !== 'comment') { // Truncate long texts
        text = `${node.type}: ${node.text.substring(0, 27)}...`;
      } else {
        text = `${node.type}: ${node.text}`;
      }
      color = '#9CA3AF';
      break;
  }
  return { text, color, isBold, width, height };
};


const AstNode: React.FC<AstNodeProps> = ({ node, x, y, activeNode, currentStep }) => {
  const isCurrentActive = activeNode === node; // Compare directly
  const { text, color, isBold, width, height } = getNodeTextAndStyle(node);
  const rectRef = useRef<Konva.Rect>(null); // Add rectRef

  useEffect(() => {
    if (rectRef.current) {
      gsap.to(rectRef.current, {
        fill: isCurrentActive ? '#3B82F6' : '#111827',
        stroke: isCurrentActive ? '#2563EB' : '#4B5563',
        duration: 0.2,
      });
    }
  }, [isCurrentActive]);


  // --- Variable Value Display Logic ---
  let variableValueText = '';
  if (currentStep?.state) {
    let variableName = '';
    // Attempt to extract variable name from AST node
    if (node.type === 'identifier' || node.type === 'field_expression') {
      variableName = node.text;
    } else if (node.type === 'declaration' && node.firstNamedChild?.type === 'identifier') {
      variableName = node.firstNamedChild.text;
    }

    if (variableName) {
      // Check locals
      const activeCallFrame = currentStep.state.callStack.find(frame => frame.isActive);
      if (activeCallFrame && activeCallFrame.locals[variableName]) {
        variableValueText = ` = ${activeCallFrame.locals[variableName].value}`;
      }
      // Check globals if not found in locals or if it's a global context
      else if (currentStep.state.globals[variableName]) {
        variableValueText = ` = ${currentStep.state.globals[variableName].value}`;
      }
    }
  }
  // --- End Variable Value Display Logic ---

  const renderNodeContent = (currentX: number, currentY: number) => {
    return (
      <Group x={currentX} y={currentY}>
        <Rect
          ref={rectRef} // Add ref here
          width={width}
          height={height}
          fill={isCurrentActive ? '#3B82F6' : '#111827'} // Use isCurrentActive
          stroke={isCurrentActive ? '#2563EB' : '#4B5563'}
          strokeWidth={2}
          cornerRadius={4}
        />
        <Text
          text={text}
          x={PADDING_X}
          y={PADDING_Y}
          fontSize={12}
          fill={color}
          fontStyle={isBold ? 'bold' : 'normal'}
          width={width - 2 * PADDING_X}
          height={height - 2 * PADDING_Y}
          align="center"
          verticalAlign="middle"
        />
        {variableValueText && (
          <Text
            text={variableValueText}
            x={width - PADDING_X - 50} // Position to the right of the node
            y={PADDING_Y}
            fontSize={12}
            fill="#FFF"
            fontStyle="bold"
            width={50}
            align="right"
            verticalAlign="middle"
          />
        )}
      </Group>
    );
  };

  let currentYOffset = y;
  let childrenNodes: React.ReactNode[] = [];

  // Render the current node
  childrenNodes.push(
    <Group key={`node-${node.id}`}>
      {renderNodeContent(x, currentYOffset)}
    </Group>
  );
  
  currentYOffset += height + VERTICAL_SPACING;

  // Render children recursively
  node.children.forEach((childNode) => {
    // Basic filtering for tokens that don't need explicit visualization (e.g., punctuation, type definitions inside function signature)
    if (
        childNode.type.length === 1 ||
        childNode.isMissing() ||
        childNode.isExtra() ||
        childNode.type === 'type_identifier' ||
        childNode.type === 'field_identifier' ||
        childNode.type === 'statement_identifier' ||
        childNode.type === 'struct_specifier' ||
        childNode.type === 'union_specifier' ||
        childNode.type === 'enum_specifier'
    ) {
      return; 
    }

    childrenNodes.push(
      <AstNode
        key={childNode.id}
        node={childNode}
        x={x + CHILD_INDENT}
        y={currentYOffset}
        activeNode={activeNode}
        currentStep={currentStep} // Pass currentStep down
      />
    );
    currentYOffset += getNodeTextAndStyle(childNode).height + VERTICAL_SPACING; // Use child's estimated height
  });

  return <Group>{childrenNodes}</Group>;
};

export default AstNode;
