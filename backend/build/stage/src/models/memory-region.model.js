// backend/src/models/memory-region.model.js

// Define types for memory regions and their contents

/**
 * Represents a single variable or data item within a memory region.
 */
// export interface MemoryItem {
//   address: string;  // Hex address, e.g., "0x7fff5fbff8c8"
//   name?: string;    // Name of the variable, if applicable
//   type?: string;    // C/C++ type, e.g., "int", "char*", "MyStruct"
//   value?: any;      // Current value
//   size?: number;    // Size in bytes
//   isPointer?: boolean; // True if this item is a pointer
//   pointsTo?: string; // Address this pointer points to, if known
//   rawBytes?: string; // Raw hexadecimal byte representation
// }

/**
 * Represents a block of allocated memory within the heap.
 */
// export interface HeapBlock {
//   address: string;  // Starting hex address of the block
//   size: number;     // Total size of the block in bytes
//   items: MemoryItem[]; // Variables or data within this block
// }

/**
 * Represents a single stack frame in the call stack.
 */
// export interface StackFrameMemory {
//   functionName: string;
//   address: string; // Base pointer address (e.g., $rbp)
//   size: number;    // Size of this stack frame
//   items: MemoryItem[]; // Local variables, parameters, etc.
// }

/**
 * Represents a memory region (e.g., Text, Data, Heap, Stack).
 */
// export interface MemoryRegion {
//   name: 'text' | 'data' | 'heap' | 'stack';
//   startAddress: string; // Starting hex address of the region
//   endAddress: string;   // Ending hex address of the region
//   size: number;         // Total size of the region in bytes
//   items?: MemoryItem[]; // For data segment (globals)
//   blocks?: HeapBlock[]; // For heap segment
//   frames?: StackFrameMemory[]; // For stack segment
// }

/**
 * The complete memory layout.
 */
// export interface MemoryLayout {
//   regions: {
//     text: MemoryRegion;
//     data: MemoryRegion;
//     heap: MemoryRegion;
//     stack: MemoryRegion;
//   };
//   // Add other relevant info like global variables not tied to data segment if needed
// }

export const MemoryRegionModel = {};