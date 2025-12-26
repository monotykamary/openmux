/**
 * TemplateOverlay - modal overlay for applying and saving layout templates
 */

import { Show, For, createEffect, createMemo, createSignal } from 'solid-js';
import { useSession } from '../contexts/SessionContext';
import { useLayout } from '../contexts/LayoutContext';
import { useConfig } from '../contexts/ConfigContext';
import { useTheme } from '../contexts/ThemeContext';
import { useTerminal } from '../contexts/TerminalContext';
import { useOverlayKeyboardHandler } from '../contexts/keyboard/use-overlay-keyboard-handler';
import { formatComboSet, matchKeybinding, type ResolvedKeybindingMap } from '../core/keybindings';
import type { KeyboardEvent } from '../effect/bridge';
import type { TemplateSession } from '../effect/models';

interface TemplateOverlayProps {
  width: number;
  height: number;
  onRequestApplyConfirm: (applyTemplate: () => Promise<void>) => void;
  onRequestOverwriteConfirm: (overwriteTemplate: () => Promise<void>) => void;
  onRequestDeleteConfirm: (deleteTemplate: () => Promise<void>) => void;
}

type TabMode = 'apply' | 'save';

function getCombos(bindings: ResolvedKeybindingMap, action: string): string[] {
  return bindings.byAction.get(action) ?? [];
}

function truncate(text: string, width: number): string {
  if (width <= 0) return '';
  if (text.length <= width) return text.padEnd(width);
  if (width <= 3) return text.slice(0, width);
  return `${text.slice(0, width - 3)}...`;
}

function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return 'unknown';
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function abbreviatePath(path: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (home && path.startsWith(home)) {
    const suffix = path.slice(home.length);
    return `~${suffix || ''}`;
  }
  return path;
}

function pathTail(path: string): string {
  const normalized = path.replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

function templateIdFromName(name: string): string | null {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.length > 0 ? normalized : null;
}

export function TemplateOverlay(props: TemplateOverlayProps) {
  const config = useConfig();
  const theme = useTheme();
  const session = useSession();
  const layout = useLayout();
  const terminal = useTerminal();
  const accentColor = () => theme.pane.focusedBorderColor;

  const [tab, setTab] = createSignal<TabMode>('apply');
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [error, setError] = createSignal<string | null>(null);

  const [saveName, setSaveName] = createSignal('New template');
  const [paneCwds, setPaneCwds] = createSignal<Map<string, string>>(new Map());
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
    const seq = ++cwdFetchSeq;
    const panes = summary.workspaces.flatMap((workspace) => workspace.panes);

    const fetchCwds = async () => {
      const next = new Map<string, string>();
      for (const pane of panes) {
        let cwd = fallbackCwd;
        if (pane.ptyId) {
          try {
            cwd = await terminal.getSessionCwd(pane.ptyId);
          } catch {
            cwd = fallbackCwd;
          }
        }
        next.set(pane.id, abbreviatePath(cwd));
      }
      if (seq === cwdFetchSeq) {
        setPaneCwds(next);
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

  const currentSummary = createMemo(() => {
    const workspaces = layout.state.workspaces;
    const summaries: Array<{
      id: number;
      layoutMode: string;
      panes: Array<{ id: string; ptyId?: string }>;
    }> = [];

    const entries = Object.entries(workspaces)
      .map(([idStr, workspace]) => ({ id: Number(idStr), workspace }))
      .filter(({ workspace }) => workspace && (workspace.mainPane || workspace.stackPanes.length > 0))
      .sort((a, b) => a.id - b.id);

    for (const entry of entries) {
      const workspace = entry.workspace!;
      const panes: Array<{ id: string; ptyId?: string }> = [];
      if (workspace.mainPane) {
        panes.push({ id: workspace.mainPane.id, ptyId: workspace.mainPane.ptyId });
      }
      for (const pane of workspace.stackPanes) {
        panes.push({ id: pane.id, ptyId: pane.ptyId });
      }
      summaries.push({
        id: entry.id,
        layoutMode: workspace.layoutMode,
        panes,
      });
    }

    const totalPanes = summaries.reduce((count, ws) => count + ws.panes.length, 0);
    return {
      workspaceCount: summaries.length,
      paneCount: totalPanes,
      workspaces: summaries,
    };
  });

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
    const normalizedId = templateIdFromName(trimmed);
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

  const handleApplyKeys = (event: KeyboardEvent) => {
    const action = matchKeybinding(config.keybindings().templateOverlay.apply, {
      key: event.key,
      ctrl: event.ctrl,
      alt: event.alt,
      shift: event.shift,
      meta: event.meta,
    });
    const count = templates().length;
    switch (action) {
      case 'template.close':
        session.closeTemplateOverlay();
        return true;
      case 'template.tab.save':
        setTab('save');
        return true;
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
      case 'template.delete':
        requestDeleteSelectedTemplate();
        return true;
      case 'template.apply':
        void applySelectedTemplate();
        return true;
      default:
        return true;
    }
  };

  const handleSaveKeys = (event: KeyboardEvent) => {
    const action = matchKeybinding(config.keybindings().templateOverlay.save, {
      key: event.key,
      ctrl: event.ctrl,
      alt: event.alt,
      shift: event.shift,
      meta: event.meta,
    });

    switch (action) {
      case 'template.close':
        session.closeTemplateOverlay();
        return true;
      case 'template.tab.apply':
        setTab('apply');
        return true;
      case 'template.save.delete':
        setSaveName((value) => value.slice(0, -1));
        return true;
      case 'template.save':
        void saveTemplate();
        return true;
      default:
        break;
    }

    const input = event.sequence ?? (event.key.length === 1 ? event.key : '');
    const charCode = input.charCodeAt(0) ?? 0;
    const isPrintable = input.length === 1 && charCode >= 32 && charCode < 127;
    if (isPrintable && !event.ctrl && !event.alt && !event.meta) {
      setSaveName((value) => value + input);
      return true;
    }
    return true;
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (tab() === 'apply') {
      return handleApplyKeys(event);
    }
    return handleSaveKeys(event);
  };

  useOverlayKeyboardHandler({
    overlay: 'templateOverlay',
    isActive: () => session.showTemplateOverlay,
    handler: handleKeyDown,
  });

  const overlayWidth = () => Math.min(72, props.width - 4);
  const saveIndent = ' ';
  const saveIndentWidth = saveIndent.length;
  const listRows = () => Math.max(1, Math.min(templates().length, maxListRows()));
  const maxSaveSummaryLines = () => Math.max(0, props.height - 13);
  const saveSummaryLines = createMemo(() => {
    const summary = currentSummary();
    const cwdMap = paneCwds();
    const fallbackCwd = abbreviatePath(process.env.OPENMUX_ORIGINAL_CWD ?? process.cwd());
    const lines: string[] = [];

    if (summary.workspaceCount === 0) {
      lines.push('No panes to save');
      return lines;
    }

    summary.workspaces.forEach((workspace, workspaceIndex) => {
      const paneCount = workspace.panes.length;
      const isLastWorkspace = workspaceIndex === summary.workspaces.length - 1;
      const workspacePrefix = isLastWorkspace ? '└─' : '├─';
      const paneIndent = isLastWorkspace ? '   ' : '│  ';

      lines.push(
        `${workspacePrefix} workspace [${workspace.id}] (${workspace.layoutMode.toUpperCase()})`
      );

      workspace.panes.forEach((pane, paneIndex) => {
        const cwd = cwdMap.get(pane.id) ?? fallbackCwd;
        const isLastPane = paneIndex === paneCount - 1;
        const panePrefix = isLastPane ? '└─' : '├─';
        lines.push(`${paneIndent}${panePrefix} pane ${paneIndex + 1} [${pathTail(cwd)}]`);
      });
    });

    return lines;
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
      return Math.min(applyContentRows() + 4, props.height - 4);
    }
    return Math.min(saveContentRows() + 4, props.height - 4);
  };
  const overlayX = () => Math.floor((props.width - overlayWidth()) / 2);
  const overlayY = () => Math.floor((props.height - overlayHeight()) / 2);

  const getTemplateStats = (template: TemplateSession) => {
    if (template.workspaces.length > 0) {
      let paneCount = 0;
      for (const workspace of template.workspaces) {
        paneCount += workspace.panes.length;
      }
      return {
        workspaceCount: template.workspaces.length,
        paneCount,
      };
    }

    return {
      workspaceCount: template.defaults.workspaceCount,
      paneCount: template.defaults.workspaceCount * template.defaults.paneCount,
    };
  };

  const renderTemplateRow = (template: TemplateSession, index: number) => {
    const selected = index === selectedIndex();
    const maxWidth = Math.max(1, overlayWidth() - 4);
    const stats = getTemplateStats(template);
    const ws = `${stats.workspaceCount}ws`.padEnd(4);
    const panes = `${stats.paneCount}p`.padEnd(3);
    const timeWidth = Math.min(12, Math.max(8, maxWidth - 20));
    const time = truncate(formatRelativeTime(template.createdAt), timeWidth);
    const nameWidth = Math.max(1, Math.min(24, maxWidth - (12 + timeWidth)));
    const name = truncate(template.name, nameWidth);
    const line = `  ${name} ${ws} ${panes} ${time}`;
    const color = selected ? '#FFFFFF' : '#CCCCCC';
    const bg = selected ? '#334455' : undefined;
    return (
      <text fg={color} bg={bg}>
        {truncate(line, maxWidth)}
      </text>
    );
  };

  const renderTab = (label: string, active: boolean) => (
    <text fg={active ? '#FFFFFF' : '#888888'} bg={active ? '#334455' : undefined}>
      {` ${label} `}
    </text>
  );

  const applyHints = () => {
    const bindings = config.keybindings().templateOverlay.apply;
    const nav = formatComboSet([
      ...getCombos(bindings, 'template.list.up'),
      ...getCombos(bindings, 'template.list.down'),
    ]);
    const apply = formatComboSet(getCombos(bindings, 'template.apply'));
    const remove = formatComboSet(getCombos(bindings, 'template.delete'));
    const save = formatComboSet(getCombos(bindings, 'template.tab.save'));
    const close = formatComboSet(getCombos(bindings, 'template.close'));
    return `${nav}:nav ${apply}:apply ${remove}:delete ${save}:save ${close}:close`;
  };

  const saveHints = () => {
    const bindings = config.keybindings().templateOverlay.save;
    const apply = formatComboSet(getCombos(bindings, 'template.tab.apply'));
    const save = formatComboSet(getCombos(bindings, 'template.save'));
    const close = formatComboSet(getCombos(bindings, 'template.close'));
    return `${apply}:apply ${save}:save ${close}:close`;
  };

  const emptyApplyHints = () => {
    const bindings = config.keybindings().templateOverlay.apply;
    const save = formatComboSet(getCombos(bindings, 'template.tab.save'));
    const close = formatComboSet(getCombos(bindings, 'template.close'));
    return `${save}:save ${close}:close`;
  };

  return (
    <Show when={session.showTemplateOverlay}>
      <box
        style={{
          position: 'absolute',
          left: overlayX(),
          top: overlayY(),
          width: overlayWidth(),
          height: overlayHeight(),
          border: true,
          borderStyle: 'rounded',
          borderColor: accentColor(),
          padding: 1,
          zIndex: 120,
        }}
        backgroundColor="#1a1a1a"
        title=" Templates "
        titleAlignment="center"
      >
        <box style={{ flexDirection: 'column' }}>
          <box style={{ flexDirection: 'row', height: 1 }}>
            {renderTab('Apply', tab() === 'apply')}
            <text fg="#444444">{'  '}</text>
            {renderTab('Save', tab() === 'save')}
          </box>

          <box style={{ height: 1 }}>
            <text fg="#444444">{'─'.repeat(overlayWidth() - 4)}</text>
          </box>

          <Show
            when={tab() === 'apply'}
            fallback={
              <box style={{ flexDirection: 'column' }}>
                <box style={{ height: 1, flexDirection: 'row' }}>
                  <text fg="#888888">{saveIndent}Name: </text>
                  <text fg="#FFFFFF">
                    {truncate(
                      `${saveName()}_`,
                      Math.max(1, overlayWidth() - 4 - saveIndentWidth - 'Name: '.length)
                    )}
                  </text>
                </box>
                <For each={visibleSaveSummaryLines()}>
                  {(line) => (
                    <box style={{ height: 1 }}>
                      <text fg="#888888">
                        {truncate(`${saveIndent}${line}`, overlayWidth() - 4)}
                      </text>
                    </box>
                  )}
                </For>
                <Show when={saveSummaryTruncated()}>
                  <box style={{ height: 1 }}>
                    <text fg="#666666">...</text>
                  </box>
                </Show>
                <box style={{ height: 1 }}>
                  <text fg="#444444">{'─'.repeat(overlayWidth() - 4)}</text>
                </box>
                <box style={{ height: 1 }}>
                  <text fg="#666666">
                    {error() ?? saveHints()}
                  </text>
                </box>
              </box>
            }
          >
            <Show
              when={templates().length > 0}
              fallback={
                <box style={{ height: 1 }}>
                  <text fg="#666666">  No templates saved</text>
                </box>
              }
            >
              <For each={visibleTemplates()}>
                {(template, index) => (
                  <box style={{ height: 1 }}>
                    {renderTemplateRow(template, index() + listOffset())}
                  </box>
                )}
              </For>
            </Show>

            <box style={{ height: 1 }}>
              <text fg="#444444">{'─'.repeat(overlayWidth() - 4)}</text>
            </box>
            <box style={{ height: 1 }}>
              <text fg="#666666">
                {templates().length === 0
                  ? emptyApplyHints()
                  : applyHints()}
              </text>
            </box>
          </Show>
        </box>
      </box>
    </Show>
  );
}
