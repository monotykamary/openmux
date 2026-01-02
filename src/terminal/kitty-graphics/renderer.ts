import { getHostCapabilities } from '../capabilities';
import type { ITerminalEmulator } from '../emulator-interface';
import { buildDeleteImage, buildDeletePlacement, buildDisplay, buildTransmitImage } from './commands';
import { applyClipRects, computePlacementRender } from './geometry';
import { getKittyTransmitBroker } from './transmit-broker';
import { tracePtyEvent } from '../pty-trace';
import {
  buildScreenKey,
  getCellMetrics,
  getScreenKeys,
  getWriter,
  isSameImage,
  isSameRender,
} from './renderer-helpers';
import type {
  ClipRect,
  CellMetrics,
  KittyPaneLayer,
  PaneState,
  PlacementRender,
  PtyKittyState,
  RendererLike,
  ImageCache,
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
  private screenStates = new Map<string, PtyKittyState>();
  private imageRegistry = new Map<string, Map<number, ImageCache>>();
  private placementsByPane = new Map<string, Map<string, PlacementRender>>();
  private screenTransitionTarget = new Map<string, boolean>();
  private pendingPtyDeletes = new Set<string>();
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
      if (existing.isAlternateScreen !== state.isAlternateScreen) {
        existing.needsClear = true;
        if (existing.ptyId) {
          this.screenTransitionTarget.set(existing.ptyId, state.isAlternateScreen);
          tracePtyEvent('kitty-render-screen-switch', {
            ptyId: existing.ptyId,
            target: state.isAlternateScreen ? 'alt' : 'main',
          });
        }
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

  markPtyDestroyed(ptyId: string): void {
    this.pendingPtyDeletes.add(ptyId);
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
      for (const ptyId of this.imageRegistry.keys()) {
        broker.clearPty(ptyId);
      }
    }
    this.panes.clear();
    this.screenStates.clear();
    this.imageRegistry.clear();
    this.placementsByPane.clear();
    this.clipRects = [];
    this.clipRectsKey = '';
    this.visibleLayers = new Set<KittyPaneLayer>(['base', 'overlay']);
  }

  flush(renderer: RendererLike): void {
    if (!this.enabled) return;

    const writeOut = getWriter(renderer);
    if (!writeOut) return;

    const broker = getKittyTransmitBroker();
    const flushedBroker = broker?.flushPending(writeOut) ?? false;

    const metrics = getCellMetrics(renderer);
    if (!metrics) {
      if (flushedBroker) return;
      return;
    }

    const output: string[] = [];

    for (const pane of this.panes.values()) {
      if (pane.removed || !pane.ptyId || !pane.emulator) {
        continue;
      }
      if (pane.emulator.isDisposed) {
        pane.emulator = null;
        pane.needsClear = true;
        continue;
      }
      const shouldBeVisible = this.visibleLayers.has(pane.layer);
      if (shouldBeVisible && pane.hidden) {
        pane.hidden = false;
        pane.needsClear = true;
      } else if (!shouldBeVisible && !pane.hidden) {
        pane.hidden = true;
        pane.needsClear = true;
      }
    }

    const updatedScreens = new Set<string>();
    for (const [paneKey, pane] of this.panes) {
      if (pane.removed || !pane.ptyId || !pane.emulator) continue;
      if (pane.emulator.isDisposed) {
        pane.emulator = null;
        pane.needsClear = true;
        continue;
      }
      if (pane.hidden) continue;
      const emulatorScreen = pane.emulator.isAlternateScreen();
      const screenKey = buildScreenKey(pane.ptyId, emulatorScreen);
      if (updatedScreens.has(screenKey)) continue;
      updatedScreens.add(screenKey);

      if (emulatorScreen !== pane.isAlternateScreen) {
        tracePtyEvent('kitty-render-screen-mismatch', {
          ptyId: pane.ptyId,
          paneKey,
          pane: pane.isAlternateScreen ? 'alt' : 'main',
          emulator: emulatorScreen ? 'alt' : 'main',
        });
      }

      const allowPlacementReuse =
        emulatorScreen === pane.isAlternateScreen &&
        this.screenTransitionTarget.get(pane.ptyId) === pane.isAlternateScreen;
      this.updatePtyState(pane.ptyId, pane.emulator, emulatorScreen, output, allowPlacementReuse);
      if (allowPlacementReuse) {
        this.screenTransitionTarget.delete(pane.ptyId);
      }
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

      const screenKey = buildScreenKey(pane.ptyId, pane.isAlternateScreen);
      const ptyState = this.screenStates.get(screenKey);
      if (!ptyState) continue;

      this.renderPanePlacements(paneKey, pane, ptyState, metrics, output);
    }

    if (this.pendingPtyDeletes.size > 0) {
      for (const ptyId of this.pendingPtyDeletes) {
        const images = this.imageRegistry.get(ptyId);
        if (images) {
          for (const [id, image] of images) {
            output.push(buildDeleteImage(image.hostId));
            this.deletePlacementsForImage(id, output);
            broker?.dropMapping(ptyId, image.info);
          }
          this.imageRegistry.delete(ptyId);
        }
        for (const screenKey of getScreenKeys(ptyId)) {
          this.screenStates.delete(screenKey);
        }
        this.screenTransitionTarget.delete(ptyId);
        broker?.clearPty(ptyId);
      }
      this.pendingPtyDeletes.clear();
    }

    if (output.length === 0) {
      if (flushedBroker) return;
      return;
    }
    writeOut(output.join(''));
  }

  private getScreenState(screenKey: string): PtyKittyState {
    let state = this.screenStates.get(screenKey);
    if (!state) {
      state = { images: new Map(), placements: [], initialized: false };
      this.screenStates.set(screenKey, state);
    }
    return state;
  }

  private getImageRegistry(ptyId: string): Map<number, ImageCache> {
    let registry = this.imageRegistry.get(ptyId);
    if (!registry) {
      registry = new Map();
      this.imageRegistry.set(ptyId, registry);
    }
    return registry;
  }

  private updatePtyState(
    ptyId: string,
    emulator: ITerminalEmulator,
    isAlternateScreen: boolean,
    output: string[],
    allowPlacementReuse: boolean
  ): void {
    if (emulator.isDisposed) return;
    const supportsKitty = !!emulator.getKittyImageIds && !!emulator.getKittyPlacements;
    if (!supportsKitty) return;

    const dirty = emulator.getKittyImagesDirty?.() ?? false;
    const screenKey = buildScreenKey(ptyId, isAlternateScreen);
    const screenState = this.getScreenState(screenKey);
    const broker = getKittyTransmitBroker();
    if (screenState.initialized && !dirty && !allowPlacementReuse) {
      tracePtyEvent('kitty-render-update-skip', {
        ptyId,
        screen: isAlternateScreen ? 'alt' : 'main',
        allowReuse: allowPlacementReuse,
      });
      return;
    }

    const ids = emulator.getKittyImageIds?.() ?? [];
    const nextImages = new Map<number, ImageCache>();
    const previousImages = screenState.images;
    const registry = this.getImageRegistry(ptyId);
    let imagesChanged = ids.length !== previousImages.size;

    for (const id of ids) {
      const info = emulator.getKittyImageInfo?.(id);
      if (!info) continue;

      const previousScreen = previousImages.get(id);
      const previous = registry.get(id);
      const brokerHostId = broker?.resolveHostId(ptyId, info) ?? null;
      const hostId = brokerHostId ?? previous?.hostId ?? this.nextHostImageId++;
      const changed = !previous || !isSameImage(previous.info, info);
      if (!previousScreen || !isSameImage(previousScreen.info, info)) {
        imagesChanged = true;
      }

      if (changed && !brokerHostId) {
        const data = emulator.getKittyImageData?.(id);
        if (data) {
          const transmit = buildTransmitImage(hostId, info, data);
          if (transmit) {
            output.push(transmit);
          }
        }
      }

      const cache = previous ?? { hostId, info };
      cache.hostId = hostId;
      cache.info = info;
      registry.set(id, cache);
      nextImages.set(id, cache);
    }

    const nextPlacements = emulator.getKittyPlacements?.() ?? [];
    const allowReuseFallback = !imagesChanged && screenState.placements.length > 0;
    const shouldReusePlacements =
      (allowPlacementReuse || allowReuseFallback) &&
      nextPlacements.length === 0 &&
      nextImages.size > 0;
    if (shouldReusePlacements) {
      screenState.images = nextImages;
    } else {
      screenState.images = nextImages;
      screenState.placements = nextPlacements;
    }
    tracePtyEvent('kitty-render-update', {
      ptyId,
      screen: isAlternateScreen ? 'alt' : 'main',
      dirty,
      allowReuse: allowPlacementReuse,
      allowReuseFallback,
      imagesChanged,
      reused: shouldReusePlacements,
      images: nextImages.size,
      placements: nextPlacements.length,
      cachedPlacements: screenState.placements.length,
    });
    screenState.initialized = true;
    emulator.clearKittyImagesDirty?.();

    const activeIds = new Set<number>();
    for (const key of getScreenKeys(ptyId)) {
      const state = this.screenStates.get(key);
      if (!state) continue;
      for (const id of state.images.keys()) {
        activeIds.add(id);
      }
    }
    for (const [id, image] of registry) {
      if (activeIds.has(id)) continue;
      output.push(buildDeleteImage(image.hostId));
      this.deletePlacementsForImage(id, output);
      broker?.dropMapping(ptyId, image.info);
      registry.delete(id);
    }
    if (registry.size === 0) {
      this.imageRegistry.delete(ptyId);
    }
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
    tracePtyEvent('kitty-render-clear', { paneKey });
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
    if (state.placements.length === 0 && state.images.size > 0) {
      tracePtyEvent('kitty-render-empty-placements', {
        ptyId: pane.ptyId,
        paneKey,
        screen: pane.isAlternateScreen ? 'alt' : 'main',
        images: state.images.size,
      });
    }

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
        if (!existing || !isSameRender(existing, renderState)) {
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
    if (nextPlacements.size > 0 || prevPlacements.size > 0) {
      tracePtyEvent('kitty-render-placements', {
        ptyId: pane.ptyId,
        paneKey,
        screen: pane.isAlternateScreen ? 'alt' : 'main',
        prevPlacements: prevPlacements.size,
        nextPlacements: nextPlacements.size,
      });
    }
  }

}
