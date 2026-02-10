// ============================================
// COLORS
// ============================================

export const COLORS = {
  // Element colors
  GLOBAL: '#2DD4BF',
  STACK: '#3B82F6',
  HEAP: '#10B981',
  POINTER: '#EF4444',
  CONTROL: '#A855F7',
  OPTIMIZED: '#F59E0B',
  ARRAY: '#F59E0B',
  
  // State colors
  ACTIVE: '#3B82F6',
  INACTIVE: '#64748B',
  HIGHLIGHT: '#FBBF24',
  DEAD: '#EF4444',
  
  // UI colors
  BACKGROUND: '#0F172A',
  SURFACE: '#1E293B',
  BORDER: '#334155',
  TEXT_PRIMARY: '#F1F5F9',
  TEXT_SECONDARY: '#94A3AF',
} as const;

// ============================================
// DURATIONS (milliseconds)
// ============================================

export const DURATIONS = {
  FAST: 200,
  NORMAL: 500,
  SLOW: 800,
  VERY_SLOW: 1200,
} as const;

// ============================================
// SIZES
// ============================================

export const SIZES = {
  // Canvas elements
  VARIABLE_BOX: {
    WIDTH: 120,
    HEIGHT: 60,
    PADDING: 10,
  },
  STACK_FRAME: {
    WIDTH: 400,
    HEIGHT: 120,
    MARGIN: 20,
  },
  HEAP_BLOCK: {
    MIN_WIDTH: 100,
    HEIGHT: 80,
    CELL_WIDTH: 40,
  },
  ARRAY_CELL: {
    WIDTH: 45,
    HEIGHT: 45,
    SPACING: 5,
  },
  POINTER_ARROW: {
    STROKE_WIDTH: 3,
    POINTER_LENGTH: 10,
    POINTER_WIDTH: 10,
  },
  
  // Layout
  GLOBAL_SPACING: 20,
  STACK_SPACING: 30,
  HEAP_SPACING: 20,
} as const;

// ============================================
// Z-INDEX LAYERS
// ============================================

export const Z_INDEX = {
  CANVAS_BASE: 1,
  CANVAS_ELEMENTS: 10,
  CANVAS_ARROWS: 20,
  CANVAS_OVERLAY: 30,
  UI_CONTROLS: 100,
  MODAL: 1000,
  TOAST: 2000,
} as const;

// ============================================
// SOCKET EVENTS (Updated for Clang + LibTooling)
// ============================================

export const SOCKET_EVENTS = {
  // Client → Server
  COMPILER_STATUS_REQUEST: 'compiler:status:request',
  CODE_ANALYZE_SYNTAX: 'code:analyze:syntax',
  CODE_ANALYZE_CHUNK: 'code:analyze:chunk',
  CODE_TRACE_GENERATE: 'code:trace:generate',
  EXECUTION_INPUT_PROVIDE: 'execution:input:provide',
  EXECUTION_PAUSE: 'execution:pause',
  EXECUTION_RESUME: 'execution:resume',
  
  // Server → Client
  COMPILER_STATUS: 'compiler:status',
  CODE_SYNTAX_RESULT: 'code:syntax:result',
  CODE_SYNTAX_ERROR: 'code:syntax:error',
  CODE_TRACE_PROGRESS: 'code:trace:progress',
  CODE_TRACE_CHUNK: 'code:trace:chunk',
  CODE_TRACE_COMPLETE: 'code:trace:complete',
  CODE_TRACE_ERROR: 'code:trace:error',
  EXECUTION_INPUT_RECEIVED: 'execution:input:received',
  EXECUTION_PAUSED: 'execution:paused',
  EXECUTION_RESUMED: 'execution:resumed',
} as const;

// ============================================
// LIMITS
// ============================================

export const LIMITS = {
  CODE_SIZE: 1000000, // 1MB max code size
  CHUNK_SIZE: 5000, // 5KB per chunk
  MAX_LOOP_ITERATIONS_SHOWN: 10, // Show first/last iterations only
  MAX_ARRAY_SIZE_SHOWN: 100, // Max array elements to visualize
  MAX_STACK_DEPTH: 100, // Max call stack depth
} as const;

// ============================================
// PLAYBACK SPEEDS
// ============================================

export const PLAYBACK_SPEEDS = [
  { label: '0.25x', value: 0.25 },
  { label: '0.5x', value: 0.5 },
  { label: '1x', value: 1 },
  { label: '2x', value: 2 },
  { label: '5x', value: 5 },
  { label: '10x', value: 10 },
] as const;

// ============================================
// DEFAULT VALUES
// ============================================

export const DEFAULTS = {
  PLAYBACK_SPEED: 0.5,
  CANVAS_ZOOM: 1,
  CANVAS_POSITION: { x: 0, y: 0 },
  CODE: '',
  LANGUAGE: 'c' as const,
} as const;