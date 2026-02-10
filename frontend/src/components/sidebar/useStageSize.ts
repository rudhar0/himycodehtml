import { useState, useEffect, RefObject } from 'react';

export const useStageSize = (containerRef: RefObject<HTMLDivElement>) => {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!containerRef.current) return;

    const updateSize = () => {
      if (containerRef.current) {
        setSize({
          width: containerRef.current.clientWidth, // Use clientWidth to exclude borders/scrollbars
          height: containerRef.current.clientHeight,
        });
      }
    };

    // Initial size
    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, [containerRef]);

  return size;
};