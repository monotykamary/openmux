import { getHostCapabilities } from '../capabilities';
import type { ITerminalEmulator, KittyGraphicsImageInfo } from '../emulator-interface';
import { buildDeleteImage, buildDeletePlacement, buildDisplay, buildTransmitImage } from './commands';
import { applyClipRects, computePlacementRender } from './geometry';
import { getKittyTransmitBroker } from './transmit-broker';
import type {
  ClipRect,
  KittyPaneLayer,
  PaneState,
  PlacementRender,
  PtyKittyState,
  RendererLike,
  ImageCache,
  CellMetrics,
} from './types';

let activeKittyRenderer: KittyGraphicsRenderer | null = null;

export function getKittyGraphicsRenderer(): KittyGraphicsRenderer | null {
  return activeKittyRenderer;
}

export function setKittyGraphicsRenderer(renderer: KittyGraphicsRenderer | null): void {
  activeKittyRenderer = renderer;
}

export class KittyGraphicsRenderer {
  private panes = new Map<string, PaneState>();
  private ptyStates = new Map<string, PtyKittyState>();
  private placementsByPane = new Map<string, Map<string, PlacementRender>>();
  private nextHostImageId = 1;
  private nextHostPlacementId = 1;
  private enabled = getHostCapabilities()?.kittyGraphics ?? false;
  private clipRects: ClipRect[] = [];
  private clipRectsKey = '';
  private visibleLayers = new Set<KittyPaneLayer>(['base', 'overlay']);

  updatePane(
    paneKey: string,
    state: Omit<PaneState, 'needsClear' | 'removed' | 'hidden' | 'layer'> & { layer?: KittyPaneLayer }
  ): void {
    const layer = state.layer ?? 'base';
    const emulator = state.emulator && !state.emulator.isDisposed ? state.emulator : null;
    const existing = this.panes.get(paneKey);
    if (existing) {
      if (existing.ptyId !== state.ptyId) {
        existing.needsClear = true;
      }
      if (existing.layer !== layer) {
        existing.needsClear = true;
      }
      if (existing.emulator && !emulator) {
        existing.needsClear = true;
      }
      existing.ptyId = state.ptyId;
      existing.emulator = emulator;
      existing.offsetX = state.offsetX;
      existing.offsetY = state.offsetY;
      existing.width = state.width;
      existing.height = state.height;
      existing.cols = state.cols;
      existing.rows = state.rows;
      existing.viewportOffset = state.viewportOffset;
      existing.scrollbackLength = state.scrollbackLength;
      existing.isAlternateScreen = state.isAlternateScreen;
      existing.layer = layer;
      existing.removed = false;
      return;
    }

    this.panes.set(paneKey, {
      ...state,
      emulator,
      layer,
      hidden: false,
      needsClear: false,
      removed: false,
    });
  }

  removePane(paneKey: string): void {
    const pane = this.panes.get(paneKey);
    if (pane) {
      pane.removed = true;
    }
  }

  setClipRects(rects: ClipRect[]): void {
    const nextRects = rects
      .map((rect) => ({
        x: Math.max(0, Math.floor(rect.x)),
        y: Math.max(0, Math.floor(rect.y)),
        width: Math.max(0, Math.floor(rect.width)),
        height: Math.max(0, Math.floor(rect.height)),
      }))
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const nextKey = nextRects.map((rect) => `${rect.x},${rect.y},${rect.width},${rect.height}`).join('|');
    if (nextKey === this.clipRectsKey) return;
    this.clipRects = nextRects;
    this.clipRectsKey = nextKey;
    for (const pane of this.panes.values()) {
      pane.needsClear = true;
    }
  }

  setVisibleLayers(layers: Iterable<KittyPaneLayer>): void {
    const next = new Set<KittyPaneLayer>(layers);
    if (next.size === this.visibleLayers.size) {
      let same = true;
      for (const layer of next) {
        if (!this.visibleLayers.has(layer)) {
          same = false;
          break;
        }
      }
      if (same) return;
    }
    this.visibleLayers = next;
    for (const pane of this.panes.values()) {
      pane.needsClear = true;
    }
  }

  dispose(): void {
    const broker = getKittyTransmitBroker();
    if (broker) {
      for (const ptyId of this.ptyStates.keys()) {
        broker.clearPty(ptyId);
      }
    }
    this.panes.clear();
    this.ptyStates.clear();
    this.placementsByPane.clear();
    this.clipRects = [];
    this.clipRectsKey = '';
    this.visibleLayers = new Set<KittyPaneLayer>(['base', 'overlay']);
  }

  flush(renderer: RendererLike): void {
    if (!this.enabled) return;

    const writeOut = this.getWriter(renderer);
    if (!writeOut) return;

    const broker = getKittyTransmitBroker();
    const flushedBroker = broker?.flushPending(writeOut) ?? false;

    const metrics = this.getCellMetrics(renderer);
    if (!metrics) {
      if (flushedBroker) return;
      return;
    }

    const output: string[] = [];
    const activePtys = new Set<string>();

    for (const pane of this.panes.values()) {
      if (pane.removed || !pane.ptyId || !pane.emulator) {
        continue;
      }
      if (pane.emulator.isDisposed) {
        pane.emulator = null;
        pane.needsClear = true;
        continue;
      }
      activePtys.add(pane.ptyId);
      const shouldBeVisible = this.visibleLayers.has(pane.layer);
      if (shouldBeVisible && pane.hidden) {
        pane.hidden = false;
        pane.needsClear = true;
      } else if (!shouldBeVisible && !pane.hidden) {
        pane.hidden = true;
        pane.needsClear = true;
      }
    }

    const updatedPtys = new Set<string>();
    for (const pane of this.panes.values()) {
      if (pane.removed || !pane.ptyId || !pane.emulator) continue;
      if (pane.emulator.isDisposed) {
        pane.emulator = null;
        pane.needsClear = true;
        continue;
      }
      if (pane.hidden) continue;
      if (updatedPtys.has(pane.ptyId)) continue;
      updatedPtys.add(pane.ptyId);

      this.updatePtyState(pane.ptyId, pane.emulator, pane.isAlternateScreen, output);
    }

    for (const [paneKey, pane] of this.panes) {
      if (pane.removed || !pane.ptyId || !pane.emulator) {
        this.clearPanePlacements(paneKey, output);
        if (pane.removed) {
          this.panes.delete(paneKey);
        }
        continue;
      }

      if (pane.hidden) {
        if (pane.needsClear) {
          this.clearPanePlacements(paneKey, output);
          pane.needsClear = false;
        }
        continue;
      }

      if (pane.needsClear) {
        this.clearPanePlacements(paneKey, output);
        pane.needsClear = false;
      }

      const ptyState = this.ptyStates.get(pane.ptyId);
      if (!ptyState) continue;

      this.renderPanePlacements(paneKey, pane, ptyState, metrics, output);
    }

    for (const [ptyId, ptyState] of this.ptyStates) {
      if (!activePtys.has(ptyId)) {
        for (const image of ptyState.images.values()) {
          output.push(buildDeleteImage(image.hostId));
        }
        this.ptyStates.delete(ptyId);
      }
    }

    if (output.length === 0) {
      if (flushedBroker) return;
      return;
    }
    writeOut(output.join(''));
  }

  private getCellMetrics(renderer: RendererLike): CellMetrics | null {
    const resolution = renderer.resolution ?? null;
    const terminalWidth = renderer.width || renderer.terminalWidth || 0;
    const terminalHeight = renderer.height || renderer.terminalHeight || 0;
    if (!resolution || terminalWidth <= 0 || terminalHeight <= 0) return null;

    const cellWidth = Math.max(1, Math.floor(resolution.width / terminalWidth));
    const cellHeight = Math.max(1, Math.floor(resolution.height / terminalHeight));
    return { cellWidth, cellHeight };
  }

  private getWriter(renderer: RendererLike): ((chunk: string) => void) | null {
    if (typeof renderer.writeOut === 'function') {
      return renderer.writeOut.bind(renderer);
    }

    const stdout = renderer.stdout ?? process.stdout;
    const writer = renderer.realStdoutWrite ?? stdout.write.bind(stdout);
    if (!writer) return null;

    return (chunk: string) => {
      writer.call(stdout, chunk);
    };
  }

  private updatePtyState(
    ptyId: string,
    emulator: ITerminalEmulator,
    isAlternateScreen: boolean,
    output: string[]
  ): void {
    if (emulator.isDisposed) return;
    const supportsKitty = !!emulator.getKittyImageIds && !!emulator.getKittyPlacements;
    if (!supportsKitty) return;

    const existing = this.ptyStates.get(ptyId);
    const dirty = emulator.getKittyImagesDirty?.() ?? false;

    const broker = getKittyTransmitBroker();
    if (!existing || existing.screenIsAlternate !== isAlternateScreen) {
      if (existing) {
        for (const image of existing.images.values()) {
          output.push(buildDeleteImage(image.hostId));
        }
        if (broker) {
          broker.clearPty(ptyId);
        }
      }
      this.ptyStates.set(ptyId, {
        screenIsAlternate: isAlternateScreen,
        images: new Map(),
        placements: [],
      });
    } else if (!dirty) {
      return;
    }

    const state = this.ptyStates.get(ptyId);
    if (!state) return;

    const ids = emulator.getKittyImageIds?.() ?? [];
    const nextImages = new Map<number, ImageCache>();

    for (const id of ids) {
      const info = emulator.getKittyImageInfo?.(id);
      if (!info) continue;

      const previous = state.images.get(id);
      const brokerHostId = broker?.resolveHostId(ptyId, info) ?? null;
      const hostId = brokerHostId ?? previous?.hostId ?? this.nextHostImageId++;
      const changed = !previous || !this.isSameImage(previous.info, info);

      if (changed && !brokerHostId) {
        const data = emulator.getKittyImageData?.(id);
        if (data) {
          const transmit = buildTransmitImage(hostId, info, data);
          if (transmit) {
            output.push(transmit);
          }
        }
      }

      nextImages.set(id, { hostId, info });
    }

    for (const [id, image] of state.images) {
      if (!nextImages.has(id)) {
        output.push(buildDeleteImage(image.hostId));
        this.deletePlacementsForImage(id, output);
        broker?.dropMapping(ptyId, image.info);
      }
    }

    state.images = nextImages;
    state.placements = emulator.getKittyPlacements?.() ?? [];
    emulator.clearKittyImagesDirty?.();
  }

  private isSameImage(a: KittyGraphicsImageInfo, b: KittyGraphicsImageInfo): boolean {
    return (
      a.transmitTime === b.transmitTime &&
      a.dataLength === b.dataLength &&
      a.width === b.width &&
      a.height === b.height &&
      a.format === b.format &&
      a.compression === b.compression
    );
  }

  private deletePlacementsForImage(imageId: number, output: string[]): void {
    for (const [paneKey, placements] of this.placementsByPane) {
      for (const [key, placement] of placements) {
        if (placement.imageId !== imageId) continue;
        output.push(buildDeletePlacement(placement.hostImageId, placement.hostPlacementId));
        placements.delete(key);
      }
      if (placements.size === 0) {
        this.placementsByPane.delete(paneKey);
      }
    }
  }

  private clearPanePlacements(paneKey: string, output: string[]): void {
    const placements = this.placementsByPane.get(paneKey);
    if (!placements) return;

    for (const placement of placements.values()) {
      output.push(buildDeletePlacement(placement.hostImageId, placement.hostPlacementId));
    }
    this.placementsByPane.delete(paneKey);
  }

  private renderPanePlacements(
    paneKey: string,
    pane: PaneState,
    state: PtyKittyState,
    metrics: CellMetrics,
    output: string[]
  ): void {
    const prevPlacements = this.placementsByPane.get(paneKey) ?? new Map<string, PlacementRender>();
    const nextPlacements = new Map<string, PlacementRender>();

    for (const placement of state.placements) {
      const image = state.images.get(placement.imageId);
      if (!image) continue;

      const baseRender = computePlacementRender(pane, placement, image.info, metrics);
      if (!baseRender) continue;

      const renders = applyClipRects(baseRender, metrics, this.clipRects);
      if (renders.length === 0) continue;

      for (const render of renders) {
        const existing = prevPlacements.get(render.key);
        const hostPlacementId = existing?.hostPlacementId ?? this.nextHostPlacementId++;
        const renderState: PlacementRender = { ...render, hostImageId: image.hostId, hostPlacementId };

        nextPlacements.set(render.key, renderState);
        if (!existing || !this.isSameRender(existing, renderState)) {
          output.push(buildDisplay(renderState));
        }
      }
    }

    for (const [key, placement] of prevPlacements) {
      if (nextPlacements.has(key)) continue;
      output.push(buildDeletePlacement(placement.hostImageId, placement.hostPlacementId));
    }

    if (nextPlacements.size > 0) {
      this.placementsByPane.set(paneKey, nextPlacements);
    } else {
      this.placementsByPane.delete(paneKey);
    }
  }

  private isSameRender(a: PlacementRender, b: PlacementRender): boolean {
    return (
      a.globalRow === b.globalRow &&
      a.globalCol === b.globalCol &&
      a.columns === b.columns &&
      a.rows === b.rows &&
      a.xOffset === b.xOffset &&
      a.yOffset === b.yOffset &&
      a.sourceX === b.sourceX &&
      a.sourceY === b.sourceY &&
      a.sourceWidth === b.sourceWidth &&
      a.sourceHeight === b.sourceHeight &&
      a.z === b.z &&
      a.hostImageId === b.hostImageId
    );
  }
}
