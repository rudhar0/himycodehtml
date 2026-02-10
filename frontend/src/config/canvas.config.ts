
import { COLORS, TYPOGRAPHY, CANVAS_SIZES } from './theme.config';

export const CANVAS_THEME = {
  BACKGROUND: COLORS.dark.background.secondary,

  FONT: {
    FAMILY: TYPOGRAPHY.fonts.mono,
    SIZE_SM: 12,
    SIZE_MD: 14,
    SIZE_LG: 16,
    COLOR: COLORS.dark.text.primary,
  },

  COMPONENTS: {
    STACK: {
      HEADER_HEIGHT: 30,
      FOOTER_HEIGHT: 20,
      VARIABLE_HEIGHT: 50,
      VARIABLE_GAP: 10,
      FILL: COLORS.dark.surface.primary,
      STROKE: COLORS.dark.border.primary,
    },
    VARIABLE: {
      WIDTH: CANVAS_SIZES.variable.width,
      HEIGHT: CANVAS_SIZES.variable.height,
      PADDING: CANVAS_SIZES.variable.padding,
      RADIUS: CANVAS_SIZES.variable.borderRadius,
      FILL: COLORS.dark.surface.secondary,
      STROKE: COLORS.dark.border.secondary,
      TEXT_COLOR: COLORS.dark.text.primary,
      VALUE_COLOR: COLORS.dark.text.secondary,
    },
    POINTER: {
        STROKE: COLORS.flow.pointer.DEFAULT,
        STROKE_WIDTH: CANVAS_SIZES.arrow.strokeWidth,
        ARROW_LENGTH: CANVAS_SIZES.arrow.pointerLength,
        ARROW_WIDTH: CANVAS_SIZES.arrow.pointerWidth,
    },
    OUTPUT: {
        FILL: COLORS.dark.background.primary,
        STROKE: COLORS.dark.border.primary,
        TEXT_COLOR: COLORS.dark.text.secondary,
        HEIGHT: 40,
        PADDING: 10,
    }
  },
};
