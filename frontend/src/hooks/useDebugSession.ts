import { useState, useEffect, useCallback } from 'react';
import ProtocolAdapter from '../services/protocol-adapter';
import { ProgramState, VariableChange, Progress } from '../types';

const useDebugSession = (url: string) => {
  const [adapter] = useState(() => new ProtocolAdapter());
  const [isConnected, setIsConnected] = useState(false);
  const [programState, setProgramState] = useState<ProgramState | null>(null);
  const [variableChanges, setVariableChanges] = useState<VariableChange[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);

  useEffect(() => {
    adapter.connect(url)
      .then(() => setIsConnected(true))
      .catch(err => console.error('Failed to connect:', err));

    adapter.onStateUpdate(setProgramState);
    adapter.onVariableChange((change) => {
      setVariableChanges(prev => [...prev, change]);
    });
    adapter.onProgress(setProgress);

    return () => {
      adapter.disconnect();
    };
  }, [adapter, url]);

  const sendCode = useCallback((code: string, language: 'c' | 'cpp') => {
    setProgramState(null);
    setVariableChanges([]);
    setProgress(null);
    if (isConnected) {
      adapter.sendCode(code, language);
    }
  }, [adapter, isConnected]);

  const controls = {
    nextStep: adapter.nextStep,
    stepIn: adapter.stepIn,
    stepOut: adapter.stepOut,
    continue: adapter.continue,
  };

  return { isConnected, programState, variableChanges, progress, sendCode, controls };
};

export default useDebugSession;
