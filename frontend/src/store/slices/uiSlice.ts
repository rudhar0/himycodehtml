import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist } from 'zustand/middleware';

export interface UIState {
  // Panels
  isSidebarOpen: boolean;
  sidebarWidth: number;
  editorWidth: number;
  
  // Active tab in sidebar
  activeSidebarTab: string;
  
  // Modals
  isModalOpen: boolean;
  modalType: string | null;
  modalData: any;
  
  // Theme
  theme: 'dark' | 'light';
  
  // Actions
  toggleSidebar: () => void;
  setSidebarOpen: (isOpen: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setEditorWidth: (width: number) => void;
  setActiveSidebarTab: (tab: string) => void;
  
  // Modal actions
  openModal: (type: string, data?: any) => void;
  closeModal: () => void;
  
  // Theme actions
  setTheme: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    immer((set) => ({
      // Initial state
      isSidebarOpen: true,
      sidebarWidth: 250,
      editorWidth: 400,
      activeSidebarTab: 'symbols',
      isModalOpen: false,
      modalType: null,
      modalData: null,
      theme: 'dark',

      // Actions
      toggleSidebar: () =>
        set((state) => {
          state.isSidebarOpen = !state.isSidebarOpen;
        }),

      setSidebarOpen: (isOpen: boolean) =>
        set((state) => {
          state.isSidebarOpen = isOpen;
        }),

      setSidebarWidth: (width: number) =>
        set((state) => {
          state.sidebarWidth = Math.max(200, Math.min(400, width));
        }),

      setEditorWidth: (width: number) =>
        set((state) => {
          state.editorWidth = Math.max(300, Math.min(800, width));
        }),

      setActiveSidebarTab: (tab: string) =>
        set((state) => {
          state.activeSidebarTab = tab;
        }),

      // Modal actions
      openModal: (type: string, data?: any) =>
        set((state) => {
          state.isModalOpen = true;
          state.modalType = type;
          state.modalData = data || null;
        }),

      closeModal: () =>
        set((state) => {
          state.isModalOpen = false;
          state.modalType = null;
          state.modalData = null;
        }),

      // Theme actions
      setTheme: (theme: 'dark' | 'light') =>
        set((state) => {
          state.theme = theme;
          
          // Update document class for theme
          if (typeof document !== 'undefined') {
            document.documentElement.classList.remove('dark', 'light');
            document.documentElement.classList.add(theme);
          }
        }),

      toggleTheme: () =>
        set((state) => {
          const newTheme = state.theme === 'dark' ? 'light' : 'dark';
          state.theme = newTheme;
          
          // Update document class for theme
          if (typeof document !== 'undefined') {
            document.documentElement.classList.remove('dark', 'light');
            document.documentElement.classList.add(newTheme);
          }
        }),
    })),
    {
      name: 'ui-storage', // localStorage key
      partialize: (state) => ({
        // Only persist these fields
        isSidebarOpen: state.isSidebarOpen,
        sidebarWidth: state.sidebarWidth,
        editorWidth: state.editorWidth,
        activeSidebarTab: state.activeSidebarTab,
        theme: state.theme,
      }),
    }
  )
);