export default class AnimationEngine {
  private isPlaying: boolean = false;
  private animationId: number | null = null;

  constructor() {
    // Initialize the AnimationEngine
  }

  // Starts the animation loop
  public play(onFrame?: () => void) {
    if (this.isPlaying) return;
    this.isPlaying = true;
    console.log('AnimationEngine: play');

    const loop = () => {
      if (!this.isPlaying) return;
      if (onFrame) onFrame();
      this.animationId = requestAnimationFrame(loop);
    };
    this.animationId = requestAnimationFrame(loop);
  }

  public pause() {
    this.isPlaying = false;
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    console.log('AnimationEngine: pause');
  }
}