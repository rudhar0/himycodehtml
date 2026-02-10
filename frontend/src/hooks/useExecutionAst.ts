
import { useEffect, useState } from 'react';
import { useExecutionStore } from '@store/slices/executionSlice';
import { useAst } from './useAst';
import Parser from 'web-tree-sitter';

export const useExecutionAst = () => {
  const ast = useAst();
  const { getCurrentStep } = useExecutionStore();
  const [activeNode, setActiveNode] = useState<Parser.SyntaxNode | null>(null);

  const currentStep = getCurrentStep();

  useEffect(() => {
    if (ast && currentStep) {
      const { line } = currentStep;
      const rootNode = ast.rootNode;
      let smallestNode: Parser.SyntaxNode | null = null;

      const findNode = (node: Parser.SyntaxNode) => {
        const startLine = node.startPosition.row + 1;
        const endLine = node.endPosition.row + 1;

        if (startLine <= line && endLine >= line) {
          if (!smallestNode || (node.endPosition.column - node.startPosition.column < smallestNode.endPosition.column - smallestNode.startPosition.column && node.endPosition.row - node.startPosition.row < smallestNode.endPosition.row - smallestNode.startPosition.row)) {
            smallestNode = node;
          }
          for (const child of node.children) {
            findNode(child);
          }
        }
      };

      findNode(rootNode);
      setActiveNode(smallestNode);
    }
  }, [ast, currentStep]);

  return activeNode;
};
