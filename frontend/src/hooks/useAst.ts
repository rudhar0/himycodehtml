
import { useEffect, useState } from 'react';
import { astService } from '@services/ast.service';
import { useEditorStore } from '@store/slices/editorSlice';
import Parser from 'web-tree-sitter';

export const useAst = () => {
  const { code } = useEditorStore();
  const [ast, setAst] = useState<Parser.Tree | null>(null);

  useEffect(() => {
    if (astService.isInitialized()) {
      const tree = astService.parse(code);
      setAst(tree);
    }
  }, [code]);

  return ast;
};
