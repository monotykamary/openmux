#!/usr/bin/env bun
/**
 * Title Spam - Updates the terminal title every second
 *
 * Usage: bun scripts/title-spam.ts
 *
 * This helps test if title updates alone cause the flash issue.
 * Press Ctrl+C to stop.
 */

const ESC = '\x1b';
const BEL = '\x07';

let counter = 0;

function setTitle(title: string) {
  // OSC 0 - Set both icon name and window title
  process.stdout.write(`${ESC}]0;${title}${BEL}`);
}

function setTitleST(title: string) {
  // OSC 0 with ST terminator instead of BEL
  process.stdout.write(`${ESC}]0;${title}${ESC}\\`);
}

console.log('Title spam test started. Press Ctrl+C to stop.');
console.log('Watch for flashes in openmux while this runs.\n');

// Update title every second
const interval = setInterval(() => {
  counter++;
  const timestamp = new Date().toLocaleTimeString();
  const title = `Test ${counter} - ${timestamp}`;

  // Alternate between BEL and ST terminators to test both
  if (counter % 2 === 0) {
    setTitle(title);
    console.log(`Set title (BEL): "${title}"`);
  } else {
    setTitleST(title);
    console.log(`Set title (ST): "${title}"`);
  }
}, 1000);

// Handle Ctrl+C
process.on('SIGINT', () => {
  clearInterval(interval);
  // Reset title
  setTitle('');
  console.log('\nStopped.');
  process.exit(0);
});
