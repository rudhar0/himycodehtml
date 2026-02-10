
import { VerticalFlowRenderer } from '../VerticalFlowRenderer';
import { ExecutionStep } from '@types/index';
import Konva from 'konva';

describe('VerticalFlowRenderer', () => {
  let layer: Konva.Layer;
  let renderer: VerticalFlowRenderer;

  beforeEach(() => {
    layer = new Konva.Layer();
    renderer = new VerticalFlowRenderer(layer);
    renderer.initialize();
  });

  it('should produce a line_execution animation on a line_execution step', async () => {
    const step: ExecutionStep = {
      id: 1,
      type: 'line_execution',
      line: 1,
      scope: 'main',
      timestamp: 0,
    };

    const animations = await renderer.processStep(step, true);

    expect(animations).toHaveLength(1);
    const animation = animations[0];
    expect(animation.type).toBe('line_execution');
    expect(animation.target).toBe('main-function');
  });
});
