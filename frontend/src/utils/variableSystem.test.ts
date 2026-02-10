// ============================================
// Variable Visualization System Test
// Tests all the new variable visualization features
// ============================================

import { VariableProcessor } from './variableProcessor';

describe('Variable Visualization System', () => {
  
  test('Multiple variable declarations', () => {
    const result = VariableProcessor.processMultipleDeclaration(
      'a = 2, b = 3, v = 9',
      'int',
      'local',
      1,
      '0x7fff0000'
    );

    expect(result).toHaveLength(3);
    expect(result[0].name).toBe('a');
    expect(result[0].value).toBe(2);
    expect(result[0].declarationType).toBe('multiple');
    expect(result[0].isInitialized).toBe(true);
    
    expect(result[1].name).toBe('b');
    expect(result[1].value).toBe(3);
    
    expect(result[2].name).toBe('v');
    expect(result[2].value).toBe(9);
  });

  test('Variable without initialization', () => {
    const result = VariableProcessor.processMultipleDeclaration(
      'x',
      'int',
      'local',
      2,
      '0x7fff0008'
    );

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('x');
    expect(result[0].value).toBe(null);
    expect(result[0].declarationType).toBe('without_value');
    expect(result[0].isInitialized).toBe(false);
  });

  test('Variable with initialization', () => {
    const result = VariableProcessor.processMultipleDeclaration(
      'y = 10',
      'int',
      'local',
      3,
      '0x7fff0010'
    );

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('y');
    expect(result[0].value).toBe(10);
    expect(result[0].declarationType).toBe('with_value');
    expect(result[0].isInitialized).toBe(true);
  });

  test('Variable filtering by execution step', () => {
    const variables = [
      {
        name: 'a',
        type: 'int',
        value: 5,
        address: '0x1000',
        scope: 'local' as const,
        primitive: 'int' as const,
        isInitialized: true,
        isAlive: true,
        birthStep: 1,
        deathStep: undefined,
        declarationType: 'with_value' as const,
        isAccessed: false,
        accessType: 'read' as const
      },
      {
        name: 'b',
        type: 'int',
        value: 10,
        address: '0x1008',
        scope: 'local' as const,
        primitive: 'int' as const,
        isInitialized: true,
        isAlive: true,
        birthStep: 3,
        deathStep: undefined,
        declarationType: 'with_value' as const,
        isAccessed: false,
        accessType: 'read' as const
      },
      {
        name: 'c',
        type: 'int',
        value: 15,
        address: '0x1010',
        scope: 'local' as const,
        primitive: 'int' as const,
        isInitialized: true,
        isAlive: false, // Dead
        birthStep: 2,
        deathStep: 4,
        declarationType: 'with_value' as const,
        isAccessed: false,
        accessType: 'read' as const
      }
    ];

    // At step 2, only 'a' should be visible
    const step2 = VariableProcessor.filterVariablesByStep(variables, 2);
    expect(step2).toHaveLength(1);
    expect(step2[0].name).toBe('a');

    // At step 3, 'a' and 'b' should be visible
    const step3 = VariableProcessor.filterVariablesByStep(variables, 3);
    expect(step3).toHaveLength(2);
    expect(step3.map(v => v.name)).toEqual(['a', 'b']);

    // At step 5, 'c' is dead, only 'a' and 'b' should be visible
    const step5 = VariableProcessor.filterVariablesByStep(variables, 5);
    expect(step5).toHaveLength(2);
    expect(step5.map(v => v.name)).toEqual(['a', 'b']);
  });

  test('Variable access detection', () => {
    const variables = [
      {
        name: 'x',
        type: 'int',
        value: 5,
        address: '0x1000',
        scope: 'local' as const,
        primitive: 'int' as const,
        isInitialized: true,
        isAlive: true,
        birthStep: 1,
        deathStep: undefined,
        declarationType: 'with_value' as const,
        isAccessed: false,
        accessType: 'read' as const
      }
    ];

    const step = {
      id: 2,
      type: 'assignment' as const,
      line: 5,
      explanation: 'x = x + 5',
      state: {} as any,
      animation: {} as any
    };

    const result = VariableProcessor.updateVariableAccess(variables, step);
    expect(result[0].isAccessed).toBe(true);
    expect(result[0].accessType).toBe('write'); // x = ... is write access
  });

  test('Scope end handling', () => {
    const variables = [
      {
        name: 'local_var',
        type: 'int',
        value: 5,
        address: '0x7fff0000',
        scope: 'local' as const,
        primitive: 'int' as const,
        isInitialized: true,
        isAlive: true,
        birthStep: 1,
        deathStep: undefined,
        declarationType: 'with_value' as const,
        isAccessed: false,
        accessType: 'read' as const
      },
      {
        name: 'global_var',
        type: 'int',
        value: 10,
        address: '0x1000',
        scope: 'global' as const,
        primitive: 'int' as const,
        isInitialized: true,
        isAlive: true,
        birthStep: 0,
        deathStep: undefined,
        declarationType: 'with_value' as const,
        isAccessed: false,
        accessType: 'read' as const
      }
    ];

    const result = VariableProcessor.markScopeEnd(variables, 'local', 5);
    
    // Local variable should be marked as dead
    expect(result[0].isAlive).toBe(false);
    expect(result[0].deathStep).toBe(5);
    
    // Global variable should remain alive
    expect(result[1].isAlive).toBe(true);
    expect(result[1].deathStep).toBeUndefined();
  });
});

// Example usage for testing the complete system
export const createTestExecutionTrace = () => {
  return {
    steps: [
      {
        id: 0,
        type: 'program_start' as const,
        line: 1,
        explanation: 'Program starts',
        state: {
          globals: {},
          stack: [],
          heap: {},
          callStack: []
        },
        animation: { type: 'program_complete' as const, target: 'global' as const, duration: 1000 }
      },
      {
        id: 1,
        type: 'variable_declaration' as const,
        line: 2,
        explanation: 'int a = 2, b = 3, v = 9',
        state: {
          globals: {},
          stack: [{
            frameId: 'main',
            function: 'main',
            returnType: 'int',
            locals: {
              'a': {
                name: 'a',
                type: 'int',
                value: 2,
                address: '0x7fff0000',
                scope: 'local' as const,
                primitive: 'int' as const,
                isInitialized: true,
                isAlive: true,
                birthStep: 1,
                declarationType: 'multiple' as const,
                isAccessed: false,
                accessType: 'read' as const
              },
              'b': {
                name: 'b',
                type: 'int',
                value: 3,
                address: '0x7fff0008',
                scope: 'local' as const,
                primitive: 'int' as const,
                isInitialized: true,
                isAlive: true,
                birthStep: 1,
                declarationType: 'multiple' as const,
                isAccessed: false,
                accessType: 'read' as const
              },
              'v': {
                name: 'v',
                type: 'int',
                value: 9,
                address: '0x7fff0010',
                scope: 'local' as const,
                primitive: 'int' as const,
                isInitialized: true,
                isAlive: true,
                birthStep: 1,
                declarationType: 'multiple' as const,
                isAccessed: false,
                accessType: 'read' as const
              }
            }
          }],
          heap: {},
          callStack: [{
            function: 'main',
            returnType: 'int',
            params: {},
            locals: {
              'a': {
                name: 'a',
                type: 'int',
                value: 2,
                address: '0x7fff0000',
                scope: 'local' as const,
                primitive: 'int' as const,
                isInitialized: true,
                isAlive: true,
                birthStep: 1,
                declarationType: 'multiple' as const,
                isAccessed: false,
                accessType: 'read' as const
              }
            },
            frameId: 'main',
            returnAddress: null,
            isActive: true
          }]
        },
        animation: { 
          type: 'appear' as const, 
          target: 'stack' as const, 
          duration: 400,
          element: 'local-0-a'
        }
      },
      {
        id: 2,
        type: 'assignment' as const,
        line: 3,
        explanation: 'a = a + 5',
        state: {
          globals: {},
          stack: [{
            frameId: 'main',
            function: 'main',
            returnType: 'int',
            locals: {
              'a': {
                name: 'a',
                type: 'int',
                value: 7,
                address: '0x7fff0000',
                scope: 'local' as const,
                primitive: 'int' as const,
                isInitialized: true,
                isAlive: true,
                birthStep: 1,
                declarationType: 'multiple' as const,
                isAccessed: true,
                accessType: 'write' as const
              },
              'b': {
                name: 'b',
                type: 'int',
                value: 3,
                address: '0x7fff0008',
                scope: 'local' as const,
                primitive: 'int' as const,
                isInitialized: true,
                isAlive: true,
                birthStep: 1,
                declarationType: 'multiple' as const,
                isAccessed: false,
                accessType: 'read' as const
              },
              'v': {
                name: 'v',
                type: 'int',
                value: 9,
                address: '0x7fff0010',
                scope: 'local' as const,
                primitive: 'int' as const,
                isInitialized: true,
                isAlive: true,
                birthStep: 1,
                declarationType: 'multiple' as const,
                isAccessed: false,
                accessType: 'read' as const
              }
            }
          }],
          heap: {},
          callStack: [{
            function: 'main',
            returnType: 'int',
            params: {},
            locals: {},
            frameId: 'main',
            returnAddress: null,
            isActive: true
          }]
        },
        animation: { 
          type: 'value_change' as const, 
          target: 'stack' as const, 
          duration: 300,
          element: 'local-0-a',
          from: 2,
          to: 7
        }
      }
    ],
    totalSteps: 3,
    globals: [],
    functions: []
  };
};
