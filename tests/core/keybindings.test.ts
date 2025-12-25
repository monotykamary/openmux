import { describe, expect, it } from 'vitest';
import {
  eventToCombo,
  formatComboSet,
  matchKeybinding,
  normalizeKeyCombo,
  resolveKeybindingMap,
} from '../../src/core/keybindings';

describe('keybindings', () => {
  it('normalizes modifiers and case', () => {
    expect(normalizeKeyCombo('CTRL+B')).toBe('ctrl+b');
  });

  it('treats uppercase letters as shift combos', () => {
    expect(normalizeKeyCombo('H')).toBe('shift+h');
    expect(eventToCombo({ key: 'H', shift: true })).toBe('shift+h');
  });

  it('drops shift for punctuation keys', () => {
    expect(normalizeKeyCombo('shift+?')).toBe('?');
    expect(eventToCombo({ key: '?', shift: true })).toBe('?');
  });

  it('matches keybinding maps', () => {
    const bindings = resolveKeybindingMap({ 'alt+h': 'pane.focus.west' });
    expect(matchKeybinding(bindings, { key: 'h', alt: true })).toBe('pane.focus.west');
  });

  it('formats grouped combos', () => {
    expect(formatComboSet(['alt+h', 'alt+j', 'alt+k', 'alt+l'])).toBe('Alt+hjkl');
    expect(formatComboSet([
      'alt+1',
      'alt+2',
      'alt+3',
      'alt+4',
      'alt+5',
      'alt+6',
      'alt+7',
      'alt+8',
      'alt+9',
    ])).toBe('Alt+1-9');
  });
});
