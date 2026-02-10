/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Custom color palette for visualization
        global: {
          DEFAULT: '#2DD4BF', // Teal
          light: '#5EEAD4',
          dark: '#14B8A6',
        },
        stack: {
          DEFAULT: '#3B82F6', // Blue
          light: '#60A5FA',
          dark: '#2563EB',
        },
        heap: {
          DEFAULT: '#10B981', // Green
          light: '#34D399',
          dark: '#059669',
        },
        pointer: {
          DEFAULT: '#EF4444', // Red
          light: '#F87171',
          dark: '#DC2626',
        },
        control: {
          DEFAULT: '#A855F7', // Purple
          light: '#C084FC',
          dark: '#9333EA',
        },
        optimized: {
          DEFAULT: '#F59E0B', // Amber/Gold
          light: '#FBBF24',
          dark: '#D97706',
        },
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slide-in': 'slideIn 0.5s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { transform: 'translateY(-20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};