export interface MemoryRegionData {
  id: string;
  name: string;
  startAddress: number;
  size: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export interface MemoryCellData {
  address: number;
  value: any;
  size: number; // in bytes
  isAllocated: boolean;
}
