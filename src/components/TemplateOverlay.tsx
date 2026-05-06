/**
 * TemplateOverlay - modal overlay for applying and saving layout templates
 */

import { createEffect, createMemo, createSignal } from 'solid-js';
import { useSession } from '../contexts/SessionContext';
import { useLayout } from '../contexts/LayoutContext';
import { useConfig } from '../contexts/ConfigContext';
import { useTheme } from '../contexts/ThemeContext';
import { useTerminal } from '../contexts/TerminalContext';
import { useOverlayKeyboardHandler } from '../contexts/keyboard/use-overlay-keyboard-handler';
import { eventToCombo, matchKeybinding } from '../core/keybindings';
import type { KeyboardEvent } from '../effect/bridge';
import { normalizeTemplateId } from '../core/template-utils';
import type { TemplateTabMode } from './template-overlay/keyboard';
import { abbreviatePath } from './template-overlay/formatting';
import { buildSaveSummaryLines, buildTemplateSummary } from './template-overlay/summary';
import { createVimSequenceHandler, type VimInputMode } from '../core/vim-sequences';
import { TemplateOverlayView } from './template-overlay/TemplateOverlayView';

interface TemplateOverlayProps {
  width: number;
  height: number;
  onRequestApplyConfirm: (applyTemplate: () => Promise<void>) => void;
  onRequestOverwriteConfirm: (overwriteTemplate: () => Promise<void>) => void;
  onRequestDeleteConfirm: (deleteTemplate: () => Promise<void>) => void;
  onVimModeChange?: (mode: VimInputMode) => void;
}

export function TemplateOverlay(props: TemplateOverlayProps) {
  const config = useConfig();
  const theme = useTheme();
  const session = useSession();
  const layout = useLayout();
  const terminal = useTerminal();
  const accentColor = () => theme.pane.focusedBorderColor;
  const vimEnabled = () => config.config().keyboard.vimMode === 'overlays';
  const [vimMode, setVimMode] = createSignal<VimInputMode>('normal');
  let vimHandler = createVimSequenceHandler({
    timeoutMs: config.config().keyboard.vimSequenceTimeoutMs,
    sequences: [
      { keys: ['j'], action: 'template.list.down' },
      { keys: ['k'], action: 'template.list.up' },
      { keys: ['g', 'g'], action: 'template.list.top' },
      { keys: ['shift+g'], action: 'template.list.bottom' },
      { keys: ['enter'], action: 'template.enter' },
      { keys: ['d', 'd'], action: 'template.delete' },
      { keys: ['q'], action: 'template.close' },
    ],
  });

  const [tab, setTab] = createSignal<TemplateTabMode>('apply');
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [error, setError] = createSignal<string | null>(null);

  const [saveName, setSaveName] = createSignal('New template');
  const [paneCwds, setPaneCwds] = createSignal<Map<string, string>>(new Map());
  const [paneProcesses, setPaneProcesses] = createSignal<Map<string, string>>(new Map());
  let cwdFetchSeq = 0;

  createEffect(() => {
    if (session.showTemplateOverlay) {
      setTab('apply');
      setSelectedIndex(0);
      setError(null);
      setSaveName(session.state.activeSession?.name ?? 'New template');
    }
  });

  createEffect(() => {
    if (!session.showTemplateOverlay || tab() !== 'save') return;
    const summary = currentSummary();
    const fallbackCwd = process.env.OPENMUX_ORIGINAL_CWD ?? process.cwd();
    const shellPath = process.env.SHELL ?? '';
    const shellName = shellPath ? shellPath.split('/').pop() : null;
    const seq = ++cwdFetchSeq;
    const panes = summary.workspaces.flatMap((workspace) => workspace.panes);

    const fetchCwds = async () => {
      const next = new Map<string, string>();
      const nextProcesses = new Map<string, string>();
      for (const pane of panes) {
        let cwd = fallbackCwd;
        let processName: string | undefined;
        if (pane.ptyId) {
          try {
            cwd = await terminal.getSessionCwd(pane.ptyId);
          } catch {
            // intentionally ignored: fallback to session CWD
            cwd = fallbackCwd;
          }
          try {
            processName = await terminal.getSessionForegroundProcess(pane.ptyId);
          } catch {
            // intentionally ignored: process name is optional metadata
            processName = undefined;
          }
        }
        next.set(pane.id, abbreviatePath(cwd));
        if (processName) {
          const trimmed = processName.trim();
          if (
            trimmed &&
            !trimmed.includes('defunct') &&
            trimmed !== shellPath &&
            trimmed !== shellName
          ) {
            nextProcesses.set(pane.id, trimmed);
          }
        }
      }
      if (seq === cwdFetchSeq) {
        setPaneCwds(next);
        setPaneProcesses(nextProcesses);
      }
    };

    fetchCwds();
  });

  createEffect(() => {
    const count = templates().length;
    if (count === 0) {
      setSelectedIndex(0);
      return;
    }
    if (selectedIndex() >= count) {
      setSelectedIndex(count - 1);
    }
  });

  const templates = () => session.templates;

  const currentSummary = createMemo(() => buildTemplateSummary(layout.state.workspaces));

  const maxListRows = () => Math.max(1, props.height - 10);
  const listOffset = createMemo(() => {
    const count = templates().length;
    const maxRows = maxListRows();
    if (count <= maxRows) return 0;
    const half = Math.floor(maxRows / 2);
    let start = selectedIndex() - half;
    start = Math.max(0, Math.min(start, count - maxRows));
    return start;
  });
  const visibleTemplates = createMemo(() =>
    templates().slice(listOffset(), listOffset() + maxListRows())
  );

  const applySelectedTemplate = async () => {
    const list = templates();
    const selected = list[selectedIndex()];
    if (!selected) return;

    const applyAction = async () => {
      await session.applyTemplate(selected);
      session.closeTemplateOverlay();
    };

    if (!session.isLayoutEmpty()) {
      props.onRequestApplyConfirm(applyAction);
      return;
    }

    await applyAction();
  };

  const findTemplateCollision = (name: string) => {
    const trimmed = name.trim();
    const normalizedId = normalizeTemplateId(trimmed);
    if (normalizedId) {
      const match = templates().find((template) => template.id === normalizedId);
      if (match) return match;
    }
    const lowered = trimmed.toLowerCase();
    return templates().find((template) => template.name.trim().toLowerCase() === lowered) ?? null;
  };

  const saveTemplate = async () => {
    const name = saveName().trim();
    if (!name) {
      setError('Template name is required.');
      return;
    }

    const summary = currentSummary();
    if (summary.workspaceCount === 0 || summary.paneCount === 0) {
      setError('No panes to save.');
      return;
    }

    const performSave = async () => {
      const templateId = await session.saveTemplate(name);

      if (!templateId) {
        setError('Failed to save template.');
        return;
      }

      setError(null);
      setTab('apply');
      const index = session.templates.findIndex((template) => template.id === templateId);
      setSelectedIndex(index >= 0 ? index : 0);
    };

    const existing = findTemplateCollision(name);
    if (existing) {
      props.onRequestOverwriteConfirm(async () => {
        await performSave();
      });
      return;
    }

    await performSave();
  };

  const requestDeleteSelectedTemplate = () => {
    const list = templates();
    const selected = list[selectedIndex()];
    if (!selected) return;

    props.onRequestDeleteConfirm(async () => {
      await session.deleteTemplate(selected.id);
    });
  };

  const handleAction = (action: string | null): boolean => {
    if (!action) return false;

    if (action === 'template.close') {
      session.closeTemplateOverlay();
      return true;
    }

    if (action === 'template.tab.save') {
      setTab('save');
      return true;
    }

    if (action === 'template.tab.apply') {
      setTab('apply');
      return true;
    }

    if (tab() === 'apply') {
      const count = templates().length;
      switch (action) {
        case 'template.list.down':
          if (count > 0) {
            setSelectedIndex((value) => Math.min(count - 1, value + 1));
          }
          return true;
        case 'template.list.up':
          if (count > 0) {
            setSelectedIndex((value) => Math.max(0, value - 1));
          }
          return true;
        case 'template.list.top':
          setSelectedIndex(0);
          return true;
        case 'template.list.bottom':
          if (count > 0) {
            setSelectedIndex(count - 1);
          }
          return true;
        case 'template.delete':
          requestDeleteSelectedTemplate();
          return true;
        case 'template.apply':
        case 'template.enter':
          void applySelectedTemplate();
          return true;
        default:
          break;
      }
    }

    if (tab() === 'save') {
      switch (action) {
        case 'template.save.delete':
          setSaveName((value) => value.slice(0, -1));
          return true;
        case 'template.save':
        case 'template.enter':
          void saveTemplate();
          return true;
        default:
          break;
      }
    }

    return false;
  };

  const handleInput = (event: KeyboardEvent): boolean => {
    if (tab() !== 'save') return true;
    const input = event.sequence ?? (event.key.length === 1 ? event.key : '');
    const charCode = input.charCodeAt(0) ?? 0;
    const isPrintable = input.length === 1 && charCode >= 32 && charCode < 127;
    if (isPrintable && !event.ctrl && !event.alt && !event.meta) {
      setSaveName((value) => value + input);
      return true;
    }
    return true;
  };

  const isBareEscape = (event: KeyboardEvent) =>
    event.key === 'escape' && !event.ctrl && !event.alt && !event.meta && !event.shift;

  const handleKeyDown = (event: KeyboardEvent) => {
    const bindings =
      tab() === 'apply'
        ? config.keybindings().templateOverlay.apply
        : config.keybindings().templateOverlay.save;
    const keyEvent = {
      key: event.key,
      ctrl: event.ctrl,
      alt: event.alt,
      shift: event.shift,
      meta: event.meta,
    };

    if (!vimEnabled()) {
      const action = matchKeybinding(bindings, keyEvent);
      if (handleAction(action)) return true;
      return handleInput(event);
    }

    if (vimMode() === 'insert') {
      if (event.key === 'escape' && !event.ctrl && !event.alt && !event.meta) {
        setVimMode('normal');
        vimHandler.reset();
        return true;
      }
      const action = matchKeybinding(bindings, keyEvent);
      if (handleAction(action)) return true;
      return handleInput(event);
    }

    if (event.key === 'i' && !event.ctrl && !event.alt && !event.meta) {
      setVimMode('insert');
      vimHandler.reset();
      return true;
    }

    const combo = eventToCombo(keyEvent);
    const result = vimHandler.handleCombo(combo);
    if (result.pending) return true;
    if (handleAction(result.action)) return true;

    const isBackspace = event.key === 'backspace';
    const shouldMatchBindings =
      !isBackspace && (event.ctrl || event.alt || event.meta || event.key.length > 1);
    if (shouldMatchBindings && !isBareEscape(event)) {
      const action = matchKeybinding(bindings, keyEvent);
      if (handleAction(action)) return true;
    }

    return true;
  };

  useOverlayKeyboardHandler({
    overlay: 'templateOverlay',
    isActive: () => session.showTemplateOverlay,
    handler: handleKeyDown,
  });

  createEffect(() => {
    if (!session.showTemplateOverlay) return;
    if (vimEnabled()) {
      setVimMode('normal');
    }
    vimHandler.reset();
  });

  createEffect(() => {
    props.onVimModeChange?.(vimMode());
  });

  createEffect(() => {
    const timeoutMs = config.config().keyboard.vimSequenceTimeoutMs;
    vimHandler.reset();
    vimHandler = createVimSequenceHandler({
      timeoutMs,
      sequences: [
        { keys: ['j'], action: 'template.list.down' },
        { keys: ['k'], action: 'template.list.up' },
        { keys: ['g', 'g'], action: 'template.list.top' },
        { keys: ['shift+g'], action: 'template.list.bottom' },
        { keys: ['enter'], action: 'template.enter' },
        { keys: ['d', 'd'], action: 'template.delete' },
        { keys: ['q'], action: 'template.close' },
      ],
    });
  });

  const overlayWidth = () => Math.min(72, props.width - 4);
  const saveIndent = ' ';
  const saveIndentWidth = saveIndent.length;
  const listRows = () => Math.max(1, Math.min(templates().length, maxListRows()));
  const maxSaveSummaryLines = () => Math.max(0, props.height - 13);
  const saveSummaryLines = createMemo(() => {
    const summary = currentSummary();
    return buildSaveSummaryLines({
      summary,
      paneCwds: paneCwds(),
      paneProcesses: paneProcesses(),
      fallbackCwd: abbreviatePath(process.env.OPENMUX_ORIGINAL_CWD ?? process.cwd()),
    });
  });

  const visibleSaveSummaryLines = createMemo(() => {
    return saveSummaryLines().slice(0, maxSaveSummaryLines());
  });

  const saveSummaryTruncated = createMemo(() => {
    return saveSummaryLines().length > maxSaveSummaryLines();
  });

  const saveContentRows = () => {
    const headerRows = 2;
    const nameRows = 1;
    const summaryRows = visibleSaveSummaryLines().length + (saveSummaryTruncated() ? 1 : 0);
    const footerRows = 1 + 1;
    return headerRows + nameRows + summaryRows + footerRows;
  };
  const applyContentRows = () => {
    const headerRows = 2;
    const footerRows = 1 + 1;
    return headerRows + listRows() + footerRows;
  };
  const overlayHeight = () => {
    if (tab() === 'apply') {
      return Math.min(applyContentRows() + 2, props.height - 4);
    }
    return Math.min(saveContentRows() + 2, props.height - 4);
  };
  const overlayX = () => Math.floor((props.width - overlayWidth()) / 2);
  const overlayY = () => Math.floor((props.height - overlayHeight()) / 2);

  const paneLabelWidth = createMemo(() => {
    const summary = currentSummary();
    const processMap = paneProcesses();
    let maxLen = 0;
    summary.workspaces.forEach((workspace) => {
      workspace.panes.forEach((pane, paneIndex) => {
        const label = processMap.get(pane.id) ?? `pane ${paneIndex + 1}`;
        maxLen = Math.max(maxLen, label.length);
      });
    });
    return Math.max(1, maxLen);
  });
  return (
    <TemplateOverlayView
      show={session.showTemplateOverlay}
      tab={tab()}
      overlayWidth={overlayWidth()}
      overlayHeight={overlayHeight()}
      overlayX={overlayX()}
      overlayY={overlayY()}
      accentColor={accentColor()}
      templates={templates()}
      visibleTemplates={visibleTemplates()}
      listOffset={listOffset()}
      selectedIndex={selectedIndex()}
      saveIndent={saveIndent}
      saveIndentWidth={saveIndentWidth}
      saveName={saveName()}
      error={error()}
      paneLabelWidth={paneLabelWidth()}
      visibleSaveSummaryLines={visibleSaveSummaryLines()}
      saveSummaryTruncated={saveSummaryTruncated()}
      vimEnabled={vimEnabled()}
      vimMode={vimMode()}
      applyBindings={config.keybindings().templateOverlay.apply}
      saveBindings={config.keybindings().templateOverlay.save}
    />
  );
}
