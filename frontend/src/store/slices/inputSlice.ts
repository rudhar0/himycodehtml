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
    isWaitingForInput?: boolean;
    prompt?: string;
    setInputRequest: (request: MultiInputRequest) => void;
    clearInputRequest: () => void;
    clearInputRequired?: () => void;
    setIsSubmitting: (isSubmitting: boolean) => void;
  }
  
  export const useInputStore = create<InputState>()(
    immer((set) => ({
      // Initial state
      inputRequest: null,
      isSubmitting: false,
      isWaitingForInput: false,
      prompt: '',
  
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
      
      clearInputRequired: () =>
        set((state) => {
          state.isWaitingForInput = false;
          state.prompt = '';
        }),
    
      setIsSubmitting: (isSubmitting) =>
        set((state) => {
            state.isSubmitting = isSubmitting;
        }),
    }))
  );
