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
import { formatComboSet, type ResolvedKeybindingMap } from '../core/keybindings';
import type { TemplateSession } from '../effect/models';
import { normalizeTemplateId } from '../core/template-utils';
import { createTemplateOverlayKeyHandler, type TemplateTabMode } from './template-overlay/keyboard';
import {
  abbreviatePath,
  fitLabel,
  formatRelativeTime,
  truncate,
} from './template-overlay/formatting';
import {
  buildSaveSummaryLines,
  buildTemplateSummary,
  getTemplateStats,
  type SaveSummaryLine,
} from './template-overlay/summary';

interface TemplateOverlayProps {
  width: number;
  height: number;
  onRequestApplyConfirm: (applyTemplate: () => Promise<void>) => void;
  onRequestOverwriteConfirm: (overwriteTemplate: () => Promise<void>) => void;
  onRequestDeleteConfirm: (deleteTemplate: () => Promise<void>) => void;
}

function getCombos(bindings: ResolvedKeybindingMap, action: string): string[] {
  return bindings.byAction.get(action) ?? [];
}

export function TemplateOverlay(props: TemplateOverlayProps) {
  const config = useConfig();
  const theme = useTheme();
  const session = useSession();
  const layout = useLayout();
  const terminal = useTerminal();
  const accentColor = () => theme.pane.focusedBorderColor;

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
            cwd = fallbackCwd;
          }
          try {
            processName = await terminal.getSessionForegroundProcess(pane.ptyId);
          } catch {
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

  const handleKeyDown = createTemplateOverlayKeyHandler({
    tab,
    setTab,
    getTemplateCount: () => templates().length,
    setSelectedIndex,
    onApply: () => {
      void applySelectedTemplate();
    },
    onDelete: requestDeleteSelectedTemplate,
    onClose: () => session.closeTemplateOverlay(),
    onSave: () => {
      void saveTemplate();
    },
    setSaveName,
    applyBindings: config.keybindings().templateOverlay.apply,
    saveBindings: config.keybindings().templateOverlay.save,
  });

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
  const saveSummaryLines = createMemo<SaveSummaryLine[]>(() => {
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

  const renderSaveLine = (line: SaveSummaryLine) => {
    const maxWidth = Math.max(1, overlayWidth() - 4);
    if (line.type === 'text') {
      return (
        <box style={{ flexDirection: 'row', height: 1 }}>
          <text fg="#888888">
            {truncate(`${saveIndent}${line.value}`, maxWidth)}
          </text>
        </box>
      );
    }

    const prefix = `${saveIndent}${line.prefix}`;
    const suffix = ` [${line.cwdTail}]`;
    const available = maxWidth - prefix.length - suffix.length;
    if (available <= 0) {
      const fallback = `${prefix}${line.label}${suffix}`;
      return (
        <box style={{ flexDirection: 'row', height: 1 }}>
          <text fg="#888888">{truncate(fallback, maxWidth)}</text>
        </box>
      );
    }

    const labelWidth = Math.min(paneLabelWidth(), available);
    const labelText = fitLabel(line.label, labelWidth);
    return (
      <box style={{ flexDirection: 'row', height: 1 }}>
        <text fg="#888888">{prefix}</text>
        <text fg={line.hasProcess ? '#CCCCCC' : '#888888'}>{labelText}</text>
        <text fg="#888888">{suffix}</text>
      </box>
    );
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
          paddingLeft: 1,
          paddingRight: 1,
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
                    renderSaveLine(line)
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
