
class MemoryLayoutVisualizer {
  constructor(memoryLayout) {
    this.memoryLayout = memoryLayout;
  }

  generate() {
    // For now, just return the JSON representation of the memory layout
    return this.memoryLayout;
  }
}

export default MemoryLayoutVisualizer;
