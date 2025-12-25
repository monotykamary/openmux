/**
 * Generate CONFIG.md from the default openmux config.
 */

import fs from 'node:fs';
import path from 'node:path';
import * as TOML from '@iarna/toml';
import { DEFAULT_USER_CONFIG } from '../src/core/user-config';

const outputPath = path.join(process.cwd(), 'CONFIG.md');

const toml = TOML.stringify(DEFAULT_USER_CONFIG as unknown as any).trimEnd();

const content = [
  '# Configuration',
  '',
  'This document is generated from the default openmux config.',
  '',
  'It mirrors the file created at:',
  '- `~/.config/openmux/config.toml`',
  '- `$XDG_CONFIG_HOME/openmux/config.toml` (if set)',
  '',
  'Regenerate with:',
  '',
  '```bash',
  'bun scripts/generate-config-doc.ts',
  '```',
  '',
  '```toml',
  toml,
  '```',
  '',
].join('\n');

fs.writeFileSync(outputPath, content, 'utf8');

console.log(`Wrote ${outputPath}`);
