import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export interface MultiInputRequest {
    line: number;
    code: string;
    requests: {
      variable: string;
      type: 'int' | 'float' | 'char' | 'string';
    }[];
  }
  
  export interface InputState {
    inputRequest: MultiInputRequest | null;
    isSubmitting: boolean;
    setInputRequest: (request: MultiInputRequest) => void;
    clearInputRequest: () => void;
    setIsSubmitting: (isSubmitting: boolean) => void;
  }
  
  export const useInputStore = create<InputState>()(
    immer((set) => ({
      // Initial state
      inputRequest: null,
      isSubmitting: false,
  
      // Actions
      setInputRequest: (request) =>
        set((state) => {
          state.inputRequest = request;
          state.isSubmitting = false;
        }),
  
      clearInputRequest: () =>
        set((state) => {
          state.inputRequest = null;
          state.isSubmitting = false;
        }),
    
      setIsSubmitting: (isSubmitting) =>
        set((state) => {
            state.isSubmitting = isSubmitting;
        }),
    }))
  );
