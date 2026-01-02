import type {
  KittyGraphicsCompression,
  KittyGraphicsFormat,
  KittyGraphicsImageInfo,
  KittyGraphicsPlacement,
  KittyGraphicsPlacementTag,
} from '../emulator-interface';
import type { GhosttyVtTerminal } from './terminal';

export function mapKittyImageInfo(
  terminal: GhosttyVtTerminal,
  imageId: number
): KittyGraphicsImageInfo | null {
  const info = terminal.getKittyImageInfo(imageId);
  if (!info) return null;

  return {
    id: info.id,
    number: info.number,
    width: info.width,
    height: info.height,
    dataLength: info.data_len,
    format: info.format as unknown as KittyGraphicsFormat,
    compression: info.compression as unknown as KittyGraphicsCompression,
    implicitId: info.implicit_id !== 0,
    transmitTime: info.transmit_time,
  };
}

export function mapKittyPlacements(terminal: GhosttyVtTerminal): KittyGraphicsPlacement[] {
  const placements = terminal.getKittyPlacements();
  return placements.map((placement) => ({
    imageId: placement.image_id,
    placementId: placement.placement_id,
    placementTag: placement.placement_tag as unknown as KittyGraphicsPlacementTag,
    screenX: placement.screen_x,
    screenY: placement.screen_y,
    xOffset: placement.x_offset,
    yOffset: placement.y_offset,
    sourceX: placement.source_x,
    sourceY: placement.source_y,
    sourceWidth: placement.source_width,
    sourceHeight: placement.source_height,
    columns: placement.columns,
    rows: placement.rows,
    z: placement.z,
  }));
}
