// ============================================
// Variable Processing Utilities
// Handles multiple declarations, initialization states, and execution flow
// ============================================

import { Variable, ExecutionStep } from '../types/index';

export interface ProcessedVariable extends Variable {
  declarationType: 'with_value' | 'without_value' | 'multiple';
  isAccessed: boolean;
  accessType: 'read' | 'write';
}

export class VariableProcessor {
  /**
   * Process multiple variable declarations in a single statement
   * Example: int a = 2, b = 3, v = 9;
   */
  static processMultipleDeclaration(
    declaration: string,
    type: string,
    scope: 'global' | 'local' | 'parameter',
    currentStep: number,
    address: string
  ): ProcessedVariable[] {
    const variables: ProcessedVariable[] = [];
    
    // Remove type and split by comma
    const varDeclarations = declaration.replace(/^\s*(?:int|float|char|double|bool)\s+/, '').split(',');
    
    varDeclarations.forEach((varDecl, index) => {
      const trimmed = varDecl.trim();
      const [name, ...valueParts] = trimmed.split('=');
      const value = valueParts.length > 0 ? valueParts.join('=') : null;
      
      const isInitialized = value !== null;
      const declarationType = varDeclarations.length > 1 ? 'multiple' : 
                             (isInitialized ? 'with_value' : 'without_value');
      
      variables.push({
        name: name.trim(),
        type,
        value: isInitialized ? this.parseValue(value, type) : null,
        address: `${address}+${index * 8}`,
        scope,
        primitive: this.getPrimitiveType(type),
        isInitialized,
        isAlive: true,
        birthStep: currentStep,
        declarationType,
        isAccessed: false,
        accessType: 'read'
      });
    });
    
    return variables;
  }

  /**
   * Parse string value to appropriate type
   */
  private static parseValue(value: string, type: string): any {
    if (!value) return null;
    
    const trimmed = value.trim();
    
    switch (type.toLowerCase()) {
      case 'int':
      case 'long':
      case 'short':
        return parseInt(trimmed, 10);
      case 'float':
      case 'double':
        return parseFloat(trimmed);
      case 'char':
        return trimmed.startsWith("'") ? trimmed.charAt(1) : trimmed.charAt(0);
      case 'bool':
        return trimmed.toLowerCase() === 'true' || trimmed === '1';
      default:
        return trimmed;
    }
  }

  /**
   * Get primitive type from C/C++ type string
   */
  private static getPrimitiveType(type: string): 'int' | 'float' | 'char' | 'double' | 'bool' | 'pointer' | 'array' | 'struct' {
    const lowerType = type.toLowerCase();
    
    if (lowerType.includes('*')) return 'pointer';
    if (lowerType.includes('[')) return 'array';
    if (lowerType.includes('struct')) return 'struct';
    if (lowerType.includes('int') || lowerType.includes('long') || lowerType.includes('short')) return 'int';
    if (lowerType.includes('float')) return 'float';
    if (lowerType.includes('double')) return 'double';
    if (lowerType.includes('char')) return 'char';
    if (lowerType.includes('bool')) return 'bool';
    
    return 'int'; // Default fallback
  }

  /**
   * Update variable access state based on current execution step
   */
  static updateVariableAccess(
    variables: ProcessedVariable[],
    step: ExecutionStep
  ): ProcessedVariable[] {
    return variables.map(variable => {
      // Check if variable is accessed in current step
      const isAccessed = this.isVariableInStep(variable, step);
      const accessType = this.getAccessType(variable, step);
      
      return {
        ...variable,
        isAccessed,
        accessType: isAccessed ? accessType : variable.accessType
      };
    });
  }

  /**
   * Check if variable is accessed in current step
   */
  private static isVariableInStep(variable: ProcessedVariable, step: ExecutionStep): boolean {
    const explanation = step.explanation.toLowerCase();
    const varName = variable.name.toLowerCase();
    
    return explanation.includes(varName) || 
           step.type === 'assignment' && explanation.includes(varName);
  }

  /**
   * Determine access type (read vs write)
   */
  private static getAccessType(variable: ProcessedVariable, step: ExecutionStep): 'read' | 'write' {
    const explanation = step.explanation.toLowerCase();
    const varName = variable.name.toLowerCase();
    
    // Assignment to variable is write
    if (explanation.includes(`${varName} =`) || explanation.includes(`${varName}=`)) {
      return 'write';
    }
    
    // Variable on right side of assignment or in condition is read
    if (explanation.includes(`= ${varName}`) || 
        explanation.includes(`=${varName}`) ||
        step.type === 'conditional_branch') {
      return 'read';
    }
    
    return 'read'; // Default to read
  }

  /**
   * Filter variables based on execution step (birth/death)
   */
  static filterVariablesByStep(
    variables: ProcessedVariable[],
    currentStep: number
  ): ProcessedVariable[] {
    return variables.filter(variable => 
      variable.isAlive &&
      variable.birthStep !== undefined &&
      variable.birthStep <= currentStep &&
      (variable.deathStep === undefined || variable.deathStep > currentStep)
    );
  }

  /**
   * Mark variables as dead when scope ends
   */
  static markScopeEnd(
    variables: ProcessedVariable[],
    scope: 'global' | 'local' | 'parameter',
    deathStep: number
  ): ProcessedVariable[] {
    return variables.map(variable => {
      if (variable.scope === scope && variable.isAlive && variable.deathStep === undefined) {
        return {
          ...variable,
          isAlive: false,
          deathStep
        };
      }
      return variable;
    });
  }
}
