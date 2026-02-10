import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { DEFAULTS } from '@constants/index';

export interface CanvasState {
  // Viewport
  zoom: number;
  position: { x: number; y: number };
  
  // Canvas size
  width: number;
  height: number;
  
  // Selection
  selectedElement: string | null;
  hoveredElement: string | null;
  
  // Interaction
  isPanning: boolean;
  isDragging: boolean;
  
  // Actions
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  setPosition: (position: { x: number; y: number }) => void;
  setCanvasSize: (width: number, height: number) => void;
  resetView: () => void;
  
  // Selection
  selectElement: (elementId: string | null) => void;
  setHoveredElement: (elementId: string | null) => void;
  
  // Interaction
  setPanning: (isPanning: boolean) => void;
  setDragging: (isDragging: boolean) => void;
  
  // Computed
  getViewportBounds: () => { x: number; y: number; width: number; height: number };
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.1;

export const useCanvasStore = create<CanvasState>()(
  immer((set, get) => ({
    // Initial state
    zoom: 1,
    position: { x: 0, y: 0 },
    width: 800,
    height: 600,
    selectedElement: null,
    hoveredElement: null,
    isPanning: false,
    isDragging: false,

    // Actions


    
    setZoom: (zoom: number) =>
      set((state) => {
        // Clamp zoom between min and max
        state.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
      }),

    zoomIn: () =>
      set((state) => {
        const newZoom = state.zoom + ZOOM_STEP;
        state.zoom = Math.min(MAX_ZOOM, newZoom);
      }),

    zoomOut: () =>
      set((state) => {
        const newZoom = state.zoom - ZOOM_STEP;
        state.zoom = Math.max(MIN_ZOOM, newZoom);
      }),

    setPosition: (position: { x: number; y: number }) =>
      set((state) => {
        state.position = position;
      }),

    setCanvasSize: (width: number, height: number) =>
      set((state) => {
        state.width = width;
        state.height = height;
      }),

    resetView: () =>
      set((state) => {
        state.zoom = DEFAULTS.CANVAS_ZOOM;
        state.position = DEFAULTS.CANVAS_POSITION;
      }),

    // Selection
    selectElement: (elementId: string | null) =>
      set((state) => {
        state.selectedElement = elementId;
      }),

    setHoveredElement: (elementId: string | null) =>
      set((state) => {
        state.hoveredElement = elementId;
      }),

    // Interaction
    setPanning: (isPanning: boolean) =>
      set((state) => {
        state.isPanning = isPanning;
      }),

    setDragging: (isDragging: boolean) =>
      set((state) => {
        state.isDragging = isDragging;
      }),

    // Computed
    getViewportBounds: () => {
      const state = get();
      return {
        x: -state.position.x / state.zoom,
        y: -state.position.y / state.zoom,
        width: state.width / state.zoom,
        height: state.height / state.zoom,
      };
    },
  }))
);