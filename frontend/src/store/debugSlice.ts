import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { ProgramState, Progress } from '../types';

interface DebugState {
  programState: ProgramState | null;
  chunks: Map<number, any[]>;
  progress: Progress | null;
  isComplete: boolean;
}

const initialState: DebugState = {
  programState: null,
  chunks: new Map(),
  progress: null,
  isComplete: false,
};

const debugSlice = createSlice({
  name: 'debug',
  initialState,
  reducers: {
    setProgramState(state, action: PayloadAction<ProgramState>) {
      state.programState = action.payload;
    },
    addChunk(state, action: PayloadAction<{ chunkId: number, steps: any[] }>) {
      state.chunks.set(action.payload.chunkId, action.payload.steps);
    },
    setProgress(state, action: PayloadAction<Progress>) {
      state.progress = action.payload;
    },
    setComplete(state, action: PayloadAction<boolean>) {
      state.isComplete = action.payload;
    },
  },
});

export const { setProgramState, addChunk, setProgress, setComplete } = debugSlice.actions;
export default debugSlice.reducer;
