// Where the conversation's context menu opens: at the pointer, moved left or up when it would leave the viewport, and
// with its submenu on the side that has room.

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

const EDGE_MARGIN = 8;

export interface MenuPlacement {
  left: number;
  top: number;
  /** Where the submenu opens: to the right of the menu, or to its left when the menu sits on the right of the pointer. */
  submenuSide: 'right' | 'left';
}

export function placeContextMenu(pointer: Point, menu: Size, viewport: Size): MenuPlacement {
  let left = pointer.x;
  let top = pointer.y;
  if (left + menu.width > viewport.width) {
    left = pointer.x - menu.width;
    if (left < 0) left = Math.max(EDGE_MARGIN, pointer.x - menu.width);
  }
  if (top + menu.height > viewport.height) {
    top = Math.max(EDGE_MARGIN, pointer.y - menu.height);
  }
  if (left < 0) left = EDGE_MARGIN;
  if (top < 0) top = EDGE_MARGIN;
  return { left, top, submenuSide: left < pointer.x ? 'left' : 'right' };
}

export interface AttackChainEntry {
  enabled: boolean;
  /** The reason shown when the entry is not available. */
  title: string;
}

/**
 * The attack-chain entry of the menu: available for an idle conversation, not while it runs, and not without one.
 */
export function attackChainEntry(conversationId: string, running: boolean, texts: {
  running: string;
  view: string;
  selectFirst: string;
}): AttackChainEntry {
  if (!conversationId) return { enabled: false, title: texts.selectFirst };
  if (running) return { enabled: false, title: texts.running };
  return { enabled: true, title: texts.view };
}
