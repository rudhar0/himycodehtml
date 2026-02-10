/**
 * Array Utility Functions
 * Helper functions for array detection, parsing, and manipulation
 */

import { ExecutionStep, Variable } from '@types/index';

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface ArrayInfo {
  id: string;
  name: string;
  baseType: string;
  dimensions: number[];
  values: any[];
  address: string;
  owner: string;
  birthStep: number;
  updatedIndices?: number[][];
}

// ============================================
// ARRAY DETECTION
// ============================================

/**
 * Check if a variable is an array
 */
export const isArray = (variable: Variable): boolean => {
  if (!variable) return false;
  
  // Check if type contains brackets
  if (variable.type?.includes('[') || variable.primitive?.includes('[')) {
    return true;
  }
  
  // Check if value is an array
  if (Array.isArray(variable.value)) {
    return true;
  }
  
  // Check primitive type
  if (variable.primitive === 'array') {
    return true;
  }
  
  return false;
};

/**
 * Extract array dimensions from type string
 * Examples:
 *   "int[5]" -> [5]
 *   "int[3][4]" -> [3, 4]
 *   "int[2][3][4]" -> [2, 3, 4]
 */
export const extractDimensions = (type: string): number[] => {
  const matches = type.match(/\[(\d+)\]/g);
  if (!matches) return [];
  
  return matches.map(m => {
    const num = m.match(/\d+/);
    return num ? parseInt(num[0], 10) : 0;
  });
};

/**
 * Extract base type from array type string
 * Examples:
 *   "int[5]" -> "int"
 *   "double[3][4]" -> "double"
 */
export const extractBaseType = (type: string): string => {
  const match = type.match(/^(\w+)/);
  return match ? match[1] : 'int';
};

// ============================================
// ARRAY CREATION
// ============================================

/**
 * Create ArrayInfo from Variable
 */
export const createArrayInfo = (
  variable: Variable,
  owner: string,
  birthStep: number
): ArrayInfo | null => {
  if (!isArray(variable)) return null;
  
  const type = variable.type || variable.primitive || 'int[]';
  const dimensions = extractDimensions(type);
  const baseType = extractBaseType(type);
  
  // Handle case where dimensions aren't in type but value is array
  let finalDimensions = dimensions;
  let values: any[] = [];
  
  if (Array.isArray(variable.value)) {
    values = flattenArray(variable.value);
    if (finalDimensions.length === 0) {
      finalDimensions = inferDimensions(variable.value);
    }
  } else if (dimensions.length > 0) {
    // Initialize with zeros if no values provided
    const totalSize = dimensions.reduce((acc, dim) => acc * dim, 1);
    values = new Array(totalSize).fill(0);
  }
  
  return {
    id: `array-${variable.address || variable.name}`,
    name: variable.name,
    baseType,
    dimensions: finalDimensions,
    values,
    address: variable.address || '0x0',
    owner,
    birthStep,
    updatedIndices: []
  };
};

// ============================================
// ARRAY VALUE MANIPULATION
// ============================================

/**
 * Flatten multi-dimensional array to 1D
 */
export const flattenArray = (arr: any[]): any[] => {
  const result: any[] = [];
  
  const flatten = (a: any) => {
    if (Array.isArray(a)) {
      a.forEach(flatten);
    } else {
      result.push(a);
    }
  };
  
  flatten(arr);
  return result;
};

/**
 * Infer dimensions from nested array structure
 */
export const inferDimensions = (arr: any[]): number[] => {
  if (!Array.isArray(arr)) return [];
  
  const dims: number[] = [arr.length];
  
  if (arr.length > 0 && Array.isArray(arr[0])) {
    dims.push(...inferDimensions(arr[0]));
  }
  
  return dims;
};

/**
 * Convert flat index to multi-dimensional indices
 * Example: flatIndex=5, dimensions=[3,4] -> [1,1]
 */
export const flatIndexToMulti = (flatIndex: number, dimensions: number[]): number[] => {
  if (dimensions.length === 1) {
    return [flatIndex];
  }
  
  if (dimensions.length === 2) {
    const cols = dimensions[1];
    const i = Math.floor(flatIndex / cols);
    const j = flatIndex % cols;
    return [i, j];
  }
  
  if (dimensions.length === 3) {
    const [d0, d1, d2] = dimensions;
    const planeSize = d1 * d2;
    const i = Math.floor(flatIndex / planeSize);
    const remainder = flatIndex % planeSize;
    const j = Math.floor(remainder / d2);
    const k = remainder % d2;
    return [i, j, k];
  }
  
  return [flatIndex];
};

/**
 * Convert multi-dimensional indices to flat index
 */
export const multiIndexToFlat = (indices: number[], dimensions: number[]): number => {
  if (indices.length === 1) {
    return indices[0];
  }
  
  if (indices.length === 2) {
    const [i, j] = indices;
    return i * dimensions[1] + j;
  }
  
  if (indices.length === 3) {
    const [i, j, k] = indices;
    return i * dimensions[1] * dimensions[2] + j * dimensions[2] + k;
  }
  
  return indices[0];
};

// ============================================
// ARRAY UPDATE DETECTION
// ============================================

/**
 * Compare two arrays and return which indices changed
 */
export const detectUpdatedIndices = (
  oldValues: any[],
  newValues: any[],
  dimensions: number[]
): number[][] => {
  const updated: number[][] = [];
  
  for (let i = 0; i < Math.min(oldValues.length, newValues.length); i++) {
    if (oldValues[i] !== newValues[i]) {
      const multiIndex = flatIndexToMulti(i, dimensions);
      updated.push(multiIndex);
    }
  }
  
  return updated;
};

// ============================================
// ARRAY REFERENCE DETECTION
// ============================================

/**
 * Check if a variable is a pointer/reference to an array
 */
export const isArrayReference = (variable: Variable): boolean => {
  if (!variable) return false;
  
  // Check if it's a pointer type
  const isPointer = variable.type?.includes('*') || variable.primitive?.includes('*');
  
  // Check if the value looks like an address pointing to array memory
  const hasArrayAddress = variable.value && typeof variable.value === 'string' && 
                          variable.value.startsWith('0x');
  
  return isPointer && hasArrayAddress;
};

/**
 * Extract referenced array name from pointer variable
 */
export const getReferencedArrayName = (variable: Variable, allArrays: ArrayInfo[]): string | null => {
  if (!isArrayReference(variable)) return null;
  
  // Try to match address
  const address = variable.value?.toString();
  const matchedArray = allArrays.find(arr => arr.address === address);
  
  return matchedArray?.name || null;
};

// ============================================
// EXPORT ALL
// ============================================

export default {
  isArray,
  extractDimensions,
  extractBaseType,
  createArrayInfo,
  flattenArray,
  inferDimensions,
  flatIndexToMulti,
  multiIndexToFlat,
  detectUpdatedIndices,
  isArrayReference,
  getReferencedArrayName
};