import Konva from "konva";

type ResizeOptions = {
  padding?: number;
  minWidth?: number;
  minHeight?: number;
  /**
   * Optional: measure only this named node inside the group (recommended).
   * Set `name="content-bounds"` on a child Group to exclude connectors/glows.
   */
  contentSelector?: string; // Konva selector, e.g. '.content-bounds'
};

export function resizeContainer(
  group: Konva.Group | null | undefined,
  options: ResizeOptions = {},
): boolean {
  if (!group) return false;
  if (!group.getLayer()) return false;

  // Avoid measuring during active entry animation frames.
  // Measurement is retried after animation completion by component effects.
  if (group.scaleX() < 0.9 || group.scaleY() < 0.9 || group.opacity() < 1) return false;

  const {
    padding = 10,
    minWidth = 0,
    minHeight = 0,
    contentSelector = ".content-bounds",
  } = options;

  const bg = group.findOne<Konva.Rect>(".main-bg");
  if (!bg) return false;

  const contentNode =
    group.findOne<Konva.Node>(contentSelector) ?? (group as Konva.Node);

  const bounds = contentNode.getClientRect({
    relativeTo: group,
    skipTransform: true,
    skipShadow: true,
  });

  const rightEdge = Math.max(0, bounds.x + bounds.width);
  const bottomEdge = Math.max(0, bounds.y + bounds.height);
  const desiredWidth = Math.ceil(rightEdge + padding);
  const desiredHeight = Math.ceil(bottomEdge + padding);

  const finalWidth = Math.max(minWidth, desiredWidth);
  const finalHeight = Math.max(minHeight, desiredHeight);

  let changed = false;

  if (Math.abs(bg.width() - finalWidth) > 1) {
      bg.width(finalWidth);
      changed = true;
  }
  if (Math.abs(bg.height() - finalHeight) > 1) {
      bg.height(finalHeight);
      changed = true;
  }

  // Keep optional companions in sync if present (purely visual).
  const glow = group.findOne<Konva.Rect>(".glow-bg");
  if (glow) {
    const margin = 5; // Fixed margin for glow
    glow.x(-margin);
    glow.y(-margin);
    glow.width(finalWidth + margin * 2);
    glow.height(finalHeight + margin * 2);
  }

  return changed;
}

export function resizeAllContainers(
  layer: Konva.Layer | null | undefined,
  options: ResizeOptions = {},
): number {
  if (!layer) return 0;
  const nodes = layer.find(".auto-resize");
  let resized = 0;
  nodes.forEach((node) => {
    if (node instanceof Konva.Group) {
      if (resizeContainer(node, options)) resized += 1;
    }
  });
  return resized;
}
