import { useState, useEffect, useRef, useCallback } from 'react';

interface StepControllerProps {
  totalSteps: number;
  initialSpeed?: number;
}

export const useStepController = ({ totalSteps, initialSpeed = 800 }: StepControllerProps) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(initialSpeed);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const nextStep = useCallback(() => {
    setCurrentStep((prev) => {
      if (prev >= totalSteps - 1) {
        setIsPlaying(false);
        return prev;
      }
      return prev + 1;
    });
  }, [totalSteps]);

  const prevStep = useCallback(() => {
    setCurrentStep((prev) => Math.max(0, prev - 1));
  }, []);

  const togglePlay = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);

  // Animation Loop
  useEffect(() => {
    if (isPlaying) {
      timerRef.current = setInterval(nextStep, speed);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, speed, nextStep]);

  return {
    currentStep,
    isPlaying,
    speed,
    setSpeed,
    togglePlay,
    nextStep,
    prevStep,
    setCurrentStep
  };
};