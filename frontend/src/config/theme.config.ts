/**
 * Theme Configuration
 * Complete color system, typography, and design tokens
 */

// ============================================
// COLOR PALETTE
// ============================================

export const COLORS = {
  // Primary Brand Colors
  brand: {
    primary: '#3B82F6',      // Blue
    secondary: '#8B5CF6',    // Purple
    accent: '#10B981',       // Green
  },

  // Memory Region Colors (Educational Coding)
  memory: {
    global: {
      DEFAULT: '#2DD4BF',    // Teal - Globals
      light: '#5EEAD4',
      dark: '#14B8A6',
      rgb: '45, 212, 191'
    },
    stack: {
      DEFAULT: '#3B82F6',    // Blue - Stack
      light: '#60A5FA',
      dark: '#2563EB',
      MEMBER: '#60A5FA',     // Lighter blue for members
      rgb: '59, 130, 246'
    },
    heap: {
      DEFAULT: '#10B981',    // Green - Heap
      light: '#34D399',
      dark: '#059669',
      rgb: '16, 185, 129'
    },
    array: {
      DEFAULT: '#F59E0B',    // Amber - Arrays
      light: '#FBBF24',
      dark: '#D97706',
      rgb: '245, 158, 11'
    },
    class: {
      DEFAULT: '#8B5CF6',    // Purple
      light: '#A78BFA',
      dark: '#7C3AED',
      rgb: '139, 92, 246'
    },
  },

  // Flow & Control Colors
  flow: {
    control: {
      DEFAULT: '#A855F7',    // Purple - Control flow
      light: '#C084FC',
      dark: '#9333EA',
      rgb: '168, 85, 247'
    },
    pointer: {
      DEFAULT: '#EF4444',    // Red - Pointers
      light: '#F87171',
      dark: '#DC2626',
      rgb: '239, 68, 68'
    },
    value: {
      DEFAULT: '#06B6D4',    // Cyan - Value flow
      light: '#22D3EE',
      dark: '#0891B2',
      rgb: '6, 182, 212'
    }
  },

  // State Colors
  state: {
    active: '#10B981',       // Green
    inactive: '#6B7280',     // Gray
    highlight: '#FBBF24',    // Yellow
    error: '#EF4444',        // Red
    warning: '#F59E0B',      // Orange
    success: '#10B981',      // Green
    info: '#3B82F6',         // Blue
  },

  // Variable Lifecycle
  lifecycle: {
    birth: '#10B981',        // Green - Variable created
    alive: '#3B82F6',        // Blue - Variable active
    modified: '#FBBF24',     // Yellow - Value changed
    dead: '#EF4444',         // Red - Variable destroyed
    optimized: '#F59E0B',    // Gold - Optimized away
  },

  // UI Colors (Dark Theme)
  dark: {
    background: {
      primary: '#0F172A',    // Slate 950
      secondary: '#1E293B',  // Slate 900
      tertiary: '#334155',   // Slate 700
    },
    surface: {
      primary: '#1E293B',
      secondary: '#334155',
      elevated: '#475569',
    },
    border: {
      primary: '#334155',
      secondary: '#475569',
      focus: '#3B82F6',
    },
    text: {
      primary: '#F1F5F9',    // Slate 100
      secondary: '#94A3B8',  // Slate 400
      tertiary: '#64748B',   // Slate 500
      inverse: '#0F172A',
    }
  },

  // UI Colors (Light Theme)
  light: {
    background: {
      primary: '#FFFFFF',
      secondary: '#F8FAFC',
      tertiary: '#F1F5F9',
    },
    surface: {
      primary: '#FFFFFF',
      secondary: '#F8FAFC',
      elevated: '#FFFFFF',
    },
    border: {
      primary: '#E2E8F0',
      secondary: '#CBD5E1',
      focus: '#3B82F6',
    },
    text: {
      primary: '#0F172A',
      secondary: '#475569',
      tertiary: '#64748B',
      inverse: '#FFFFFF',
    }
  }
} as const;

// ============================================
// TYPOGRAPHY
// ============================================

export const TYPOGRAPHY = {
  fonts: {
    sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    mono: '"Fira Code", "JetBrains Mono", "Consolas", "Monaco", monospace',
    display: '"Inter", -apple-system, sans-serif'
  },

  sizes: {
    xs: '0.75rem',      // 12px
    sm: '0.875rem',     // 14px
    base: '1rem',       // 16px
    lg: '1.125rem',     // 18px
    xl: '1.25rem',      // 20px
    '2xl': '1.5rem',    // 24px
    '3xl': '1.875rem',  // 30px
    '4xl': '2.25rem',   // 36px
  },

  weights: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },

  lineHeights: {
    tight: 1.25,
    normal: 1.5,
    relaxed: 1.75,
  }
} as const;

// ============================================
// SPACING
// ============================================

export const SPACING = {
  xs: '0.25rem',    // 4px
  sm: '0.5rem',     // 8px
  md: '1rem',       // 16px
  lg: '1.5rem',     // 24px
  xl: '2rem',       // 32px
  '2xl': '3rem',    // 48px
  '3xl': '4rem',    // 64px
} as const;

// ============================================
// ANIMATION DURATIONS
// ============================================

export const DURATIONS = {
  instant: 0,
  fast: 200,
  normal: 500,
  slow: 800,
  verySlow: 1200,
  
  // Specific animations
  valueChange: 500,
  frameTransition: 600,
  arrayAccess: 400,
  pointerFlow: 2000,    // Infinite animation
  loopCycle: 300,
  highlightPulse: 1000,
} as const;

// ============================================
// EASING FUNCTIONS
// ============================================

export const EASINGS = {
  linear: 'linear',
  easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
  easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
  easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  bounce: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
  elastic: 'cubic-bezier(0.68, -0.6, 0.32, 1.6)',
} as const;

// ============================================
// CANVAS SIZES
// ============================================

export const CANVAS_SIZES = {
  // Variable boxes
  variable: {
    width: 120,
    height: 60,
    padding: 10,
    borderRadius: 8,
  },

  // Stack frames
  stackFrame: {
    width: 400,
    height: 120,
    margin: 20,
    padding: 15,
    borderRadius: 8,
  },

  // Heap blocks
  heapBlock: {
    minWidth: 100,
    height: 80,
    cellWidth: 40,
    padding: 10,
    borderRadius: 8,
  },

  // Array cells
  arrayCell: {
    width: 45,
    height: 45,
    spacing: 5,
    borderRadius: 4,
  },

  // Pointer arrows
  arrow: {
    strokeWidth: 3,
    pointerLength: 10,
    pointerWidth: 10,
    dashArray: [10, 5],
  },

  // Spacing
  spacing: {
    global: 20,
    stack: 30,
    heap: 20,
    array: 15,
  }
} as const;

// ============================================
// Z-INDEX LAYERS
// ============================================

export const Z_INDEX = {
  canvasBase: 1,
  canvasElements: 10,
  canvasArrows: 20,
  canvasOverlay: 30,
  canvasTooltip: 40,
  uiControls: 100,
  sidebar: 200,
  modal: 1000,
  toast: 2000,
  contextMenu: 3000,
} as const;

// ============================================
// BREAKPOINTS
// ============================================

export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

// ============================================
// SHADOWS
// ============================================

export const SHADOWS = {
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1)',
  inner: 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)',
} as const;

// ============================================
// ANIMATION PRESETS
// ============================================

export const ANIMATION_PRESETS = {
  // Variable value change
  valueChange: {
    duration: DURATIONS.valueChange,
    easing: EASINGS.easeInOut,
    effects: ['scale', 'pulse', 'colorShift']
  },

  // Stack frame transitions
  stackPush: {
    duration: DURATIONS.frameTransition,
    easing: EASINGS.easeOut,
    direction: 'down'
  },

  stackPop: {
    duration: DURATIONS.frameTransition,
    easing: EASINGS.easeIn,
    direction: 'up'
  },

  // Array operations
  arrayAccess: {
    duration: DURATIONS.arrayAccess,
    easing: EASINGS.bounce,
    effects: ['scale', 'highlight']
  },

  // Pointer animations
  pointerDraw: {
    duration: DURATIONS.slow,
    easing: EASINGS.easeOut,
    style: 'stroke-dashoffset'
  },

  pointerFlow: {
    duration: DURATIONS.pointerFlow,
    easing: EASINGS.linear,
    infinite: true,
    style: 'dash-offset'
  },

  // Loop animations
  loopCycle: {
    duration: DURATIONS.loopCycle,
    easing: EASINGS.linear,
    effects: ['rotate']
  },

  // Highlight pulse
  highlight: {
    duration: DURATIONS.highlightPulse,
    easing: EASINGS.easeInOut,
    infinite: true,
    effects: ['opacity']
  }
} as const;

// ============================================
// HELPER FUNCTIONS
// ============================================

export const getColor = (path: string) => {
  const keys = path.split('.');
  let value: any = COLORS;
  
  for (const key of keys) {
    value = value[key];
    if (value === undefined) return COLORS.dark.text.primary;
  }
  
  return typeof value === 'string' ? value : value.DEFAULT;
};

export const withOpacity = (color: string, opacity: number) => {
  // Extract RGB from color if it has rgb property
  const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (rgbMatch) {
    return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${opacity})`;
  }
  return color;
};

export default {
  COLORS,
  TYPOGRAPHY,
  SPACING,
  DURATIONS,
  EASINGS,
  CANVAS_SIZES,
  Z_INDEX,
  BREAKPOINTS,
  SHADOWS,
  ANIMATION_PRESETS
};