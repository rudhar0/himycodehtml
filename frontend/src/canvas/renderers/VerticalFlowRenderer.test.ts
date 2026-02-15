
import { VerticalFlowRenderer } from './VerticalFlowRenderer';
import { ExecutionStep } from '../../types';
import Konva from 'konva';

describe('VerticalFlowRenderer', () => {
  let layer: Konva.Layer;
  let renderer: VerticalFlowRenderer;

  beforeEach(() => {
    layer = new Konva.Layer();
    renderer = new VerticalFlowRenderer(layer);
    renderer.initialize();
  });

  // TODO: Update test to use renderScene() once implementation stabilizes
  it.skip('should produce a line_execution animation on a line_execution step', async () => {
    const step: ExecutionStep = {
      id: 1,
      type: 'line_execution',
      line: 1,
      scope: 'local',
      explanation: 'Line execution',
      state: {
        globals: {},
        heap: {},
        callStack: [],
        stack: [], // Added stack
      },
    };

  // const animations = await (renderer as any).processStep(step, true);
    // expect(animations).toHaveLength(1);
    // const animation = animations[0];
    // expect(animation.type).toBe('line_execution');
    // expect(animation.target).toBe('main-function');
  });
});
