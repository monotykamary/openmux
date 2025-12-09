/**
 * CopyNotification - displays a toast when text is copied to clipboard
 * Positioned at the top-right of the pane where copy occurred
 */

import { memo } from 'react';
import { RGBA } from '@opentui/core';

interface PaneRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CopyNotificationProps {
  visible: boolean;
  charCount: number;
  /** Rectangle of the pane where copy occurred */
  paneRect: PaneRectangle | null;
}

const TOAST_WIDTH = 25;
const TOAST_HEIGHT = 3;

// Use the same blue as the focused pane border
const BORDER_COLOR = '#7aa2f7';
const TEXT_COLOR = '#a9b1d6';

// Dark gray background with 80% opacity
const BG_COLOR = RGBA.fromInts(34, 36, 46, 204);

/**
 * A toast notification that appears at the top-right of the pane
 * Styled with left/right partial borders matching the pane focus color
 * Uses semi-transparent dark background
 */
export const CopyNotification = memo(function CopyNotification({
  visible,
  charCount,
  paneRect,
}: CopyNotificationProps) {
  if (!visible || !paneRect) return null;

  // Position at top-right of pane, with some padding from edges
  const leftPosition = Math.max(0, paneRect.x + paneRect.width - TOAST_WIDTH - 2);
  const topPosition = paneRect.y + 1;

  return (
    <box
      style={{
        position: 'absolute',
        left: leftPosition,
        top: topPosition,
        width: TOAST_WIDTH,
        height: TOAST_HEIGHT,
        backgroundColor: BG_COLOR,
        zIndex: 1000,
        border: ['left', 'right'],
        borderStyle: 'single',
        borderColor: BORDER_COLOR,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <text
        style={{
          fg: TEXT_COLOR,
        }}
        content="Copied to clipboard"
      />
    </box>
  );
});

export default CopyNotification;
