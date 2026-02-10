/**
 * RenderRegistry.ts
 * Responsible for converting Execution Trace Data into Visual Element Props.
 * Calculates layout positions for Stack Frames and Variables.
 */

export interface VisualElement {
  id: string;
  type: 'variable' | 'frame' | 'pointer';
  props: any;
}

export class RenderRegistry {
  private static FRAME_PADDING = 20;
  private static VAR_HEIGHT = 70;
  private static START_Y = 50;

  /**
   * Parses the trace up to the current step and returns a list of visual elements.
   * @param canvasWidth The current width of the canvas for responsive layout.
   */
  static getElementsForStep(trace: any[], currentStep: number, canvasWidth: number): VisualElement[] {
    if (!trace || trace.length === 0 || canvasWidth <= 0) return [];

    // --- Constants for responsive layout ---
    const START_X = canvasWidth > 400 ? 50 : 20;
    const VAR_WIDTH = canvasWidth > 400 ? 140 : 120;
    const VAR_GAP = 10;
    const MAX_GLOBALS_PER_ROW = Math.max(1, Math.floor((canvasWidth - START_X) / (VAR_WIDTH + VAR_GAP)));
    const elements: VisualElement[] = [];
    const globals: Record<string, any> = {};
    const stack: { name: string; variables: Record<string, any> }[] = [];

    // 1. Reconstruct Memory State
    for (let i = 0; i <= currentStep && i < trace.length; i++) {
      const step = trace[i];

      // Always apply the full state snapshot if available
      if (step.state) {
        // Clear globals and stack to rebuild from snapshot
        // This is important for ensuring the state at 'currentStep' is accurately reflected,
        // rather than cumulatively adding from previous steps which might be incorrect
        // if variables go out of scope or are re-declared.
        Object.keys(globals).forEach(key => delete globals[key]); // Clear globals
        stack.length = 0; // Clear stack

        // Handle globals - can be Record<string, Variable> or array
        if (step.state.globals) {
          if (Array.isArray(step.state.globals)) {
            // Old format: array
            step.state.globals.forEach((globalVar: any) => {
              globals[globalVar.name] = { 
                type: globalVar.type, 
                value: globalVar.value, 
                address: globalVar.address 
              };
            });
          } else {
            // New format: Record<string, Variable>
            Object.entries(step.state.globals).forEach(([name, globalVar]: [string, any]) => {
              globals[name] = { 
                type: globalVar.type || globalVar.primitive, 
                value: globalVar.value, 
                address: globalVar.address 
              };
            });
          }
        }

        // Handle stack frames - prefer callStack, fallback to stack
        const frames = step.state.callStack || step.state.stack || [];
        frames.forEach((frame: any) => {
          const frameVariables: Record<string, any> = {};
          
          // Handle locals - can be Record<string, Variable> or array
          if (frame.locals) {
            if (Array.isArray(frame.locals)) {
              frame.locals.forEach((localVar: any) => {
                frameVariables[localVar.name] = { 
                  type: localVar.type || localVar.primitive, 
                  value: localVar.value, 
                  address: localVar.address 
                };
              });
            } else {
              Object.entries(frame.locals).forEach(([name, localVar]: [string, any]) => {
                frameVariables[name] = { 
                  type: localVar.type || localVar.primitive, 
                  value: localVar.value, 
                  address: localVar.address 
                };
              });
            }
          }
          
          // Handle params if they exist
          if (frame.params) {
            if (Array.isArray(frame.params)) {
              frame.params.forEach((paramVar: any) => {
                frameVariables[paramVar.name] = { 
                  type: paramVar.type || paramVar.primitive, 
                  value: paramVar.value, 
                  address: paramVar.address 
                };
              });
            } else {
              Object.entries(frame.params).forEach(([name, paramVar]: [string, any]) => {
                frameVariables[name] = { 
                  type: paramVar.type || paramVar.primitive, 
                  value: paramVar.value, 
                  address: paramVar.address 
                };
              });
            }
          }
          
          stack.push({ 
            name: frame.function || frame.name || 'unknown', 
            variables: frameVariables 
          });
        });
      }
    }

    // 2. Calculate Layout & Generate Elements
    let currentY = this.START_Y;

    // -- Render Globals --
    if (Object.keys(globals).length > 0) {
      Object.entries(globals).forEach(([name, data]: [string, any], index) => {
        const row = Math.floor(index / MAX_GLOBALS_PER_ROW);
        const col = index % MAX_GLOBALS_PER_ROW;
        const globalX = START_X + col * (VAR_WIDTH + VAR_GAP);
        const globalY = currentY + row * (this.VAR_HEIGHT + VAR_GAP);
        elements.push({
          id: `global-${name}`,
          type: 'variable',
          props: {
            id: `global-${name}`,
            x: globalX,
            y: globalY,
            name: name,
            value: data.value,
            type: data.type,
            width: VAR_WIDTH,
            color: '#0f172a', // Darker for globals
          },
        });
      });
      const globalRows = Math.ceil(Object.keys(globals).length / MAX_GLOBALS_PER_ROW);
      currentY += (globalRows * (this.VAR_HEIGHT + VAR_GAP)) + 40; // Spacing after globals
    }

    // -- Render Stack Frames --
    const MAX_VARS_PER_ROW = Math.max(1, Math.floor((canvasWidth - START_X * 2 - 40) / (VAR_WIDTH + VAR_GAP)));
    stack.forEach((frame, index) => {
      const frameVars = Object.entries(frame.variables);
      const frameRows = Math.ceil(frameVars.length / MAX_VARS_PER_ROW);
      const frameHeight = Math.max(100, frameRows * (this.VAR_HEIGHT + VAR_GAP) + 40);
      const frameWidth = Math.min(canvasWidth - START_X * 2, (MAX_VARS_PER_ROW * (VAR_WIDTH + VAR_GAP)) + 20);

      // Frame Container
      elements.push({
        id: `frame-${index}`,
        type: 'frame',
        props: {
          id: `frame-${index}`,
          x: START_X,
          y: currentY,
          width: frameWidth,
          height: frameHeight,
          name: frame.name,
        },
      });

      // Frame Variables
      frameVars.forEach(([name, data]: [string, any], vIndex) => {
        const col = vIndex % MAX_VARS_PER_ROW;
        const row = Math.floor(vIndex / MAX_VARS_PER_ROW);
        
        elements.push({
          id: `var-${index}-${name}`,
          type: 'variable',
          props: {
            id: `var-${index}-${name}`,
            x: START_X + 20 + (col * (VAR_WIDTH + VAR_GAP)),
            y: currentY + 20 + (row * (this.VAR_HEIGHT + VAR_GAP)),
            name: name,
            value: data.value,
            type: data.type,
            width: VAR_WIDTH,
          },
        });
      });

      currentY += frameHeight + 20;
    });

    return elements;
  }
}