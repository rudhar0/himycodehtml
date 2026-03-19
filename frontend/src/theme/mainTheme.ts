// frontend/src/theme/mainTheme.ts

export const MAIN_THEME = {
  header: {
    gradStart: '#5B21B6',
    gradMid: '#7C3AED',
    gradEnd: '#6D28D9',
    gridColor: 'rgba(255, 255, 255, 0.04)',
    shimmerColor: 'rgba(255, 255, 255, 0.08)',
  },
  body: {
    dark: '#121028',
    light: '#F6F3FF',
  },
  border: {
    dark: 'rgba(124, 58, 237, 0.55)',
    light: 'rgba(124, 58, 237, 0.35)',
  },
  glow: {
    a: 'rgba(124, 58, 237, 0.28)',
    b: 'rgba(124, 58, 237, 0.07)',
  },
  badges: {
    running: {
      bg: 'rgba(34, 197, 94, 0.22)',
      text: '#6EE7B7',
      border: 'rgba(34, 197, 94, 0.4)',
    },
    default: {
      bg: 'rgba(255, 255, 255, 0.1)',
      text: 'rgba(255, 255, 255, 0.75)',
      border: 'rgba(255, 255, 255, 0.15)',
    }
  },
  meta: {
    pillBg: 'rgba(0, 0, 0, 0.2)',
    text: 'rgba(255, 255, 255, 0.5)',
    accent: 'rgba(255, 255, 255, 0.75)',
  },
  footer: {
    bg: 'rgba(0, 0, 0, 0.25)',
    sep: 'rgba(124, 58, 237, 0.4)',
    okBg: 'rgba(34, 197, 94, 0.1)',
    okText: '#22C55E',
    steps: '#7C3AED',
    vars: '#60A5FA',
    ret: '#F87171',
  },
  types: {
    int: { clr: '#F59E0B', bg: 'rgba(245, 158, 11, 0.12)', bd: 'rgba(245, 158, 11, 0.3)' },
    string: { clr: '#22C55E', bg: 'rgba(34, 197, 94, 0.12)', bd: 'rgba(34, 197, 94, 0.3)' },
    float: { clr: '#38BDF8', bg: 'rgba(56, 189, 248, 0.12)', bd: 'rgba(56, 189, 248, 0.3)' },
    bool: { clr: '#A78BFA', bg: 'rgba(167, 139, 250, 0.12)', bd: 'rgba(167, 139, 250, 0.3)' },
    char: { clr: '#FB923C', bg: 'rgba(251, 146, 60, 0.12)', bd: 'rgba(251, 146, 60, 0.3)' },
    ptr: { clr: '#F472B6', bg: 'rgba(244, 114, 182, 0.12)', bd: 'rgba(244, 114, 182, 0.3)' },
  }
};
