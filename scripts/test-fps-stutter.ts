#!/usr/bin/env bun
/**
 * FPS Stutter Test - Outputs a continuous animation to detect frame drops
 *
 * Usage: bun scripts/test-fps-stutter.ts [fps]
 *
 * This outputs a smooth animation that makes stuttering visually obvious.
 * It also tracks frame timing and reports statistics about frame drops.
 *
 * Default FPS: 60 (configurable via argument)
 * Press Ctrl+C to stop and see statistics.
 */

const ESC = '\x1b';

// Parse command line args
const targetFps = parseInt(process.argv[2] || '60', 10);
const frameInterval = 1000 / targetFps;

// Animation state
let frame = 0;
let startTime = performance.now();
let lastFrameTime = startTime;

// Statistics
const frameTimes: number[] = [];
let droppedFrames = 0;
let maxFrameTime = 0;
const stutterThreshold = frameInterval * 1.5; // 50% over target = stutter

// Animation characters
const spinnerChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const barWidth = 40;

function clearLine() {
  process.stdout.write(`${ESC}[2K${ESC}[G`);
}

function moveCursor(row: number, col: number) {
  process.stdout.write(`${ESC}[${row};${col}H`);
}

function hideCursor() {
  process.stdout.write(`${ESC}[?25l`);
}

function showCursor() {
  process.stdout.write(`${ESC}[?25h`);
}

function clearScreen() {
  process.stdout.write(`${ESC}[2J${ESC}[H`);
}

function formatMs(ms: number): string {
  return ms.toFixed(2).padStart(7);
}

function renderFrame() {
  const now = performance.now();
  const frameTime = now - lastFrameTime;
  lastFrameTime = now;

  // Track statistics (skip first frame)
  if (frame > 0) {
    frameTimes.push(frameTime);
    if (frameTime > maxFrameTime) {
      maxFrameTime = frameTime;
    }
    if (frameTime > stutterThreshold) {
      droppedFrames++;
    }
  }

  // Calculate metrics
  const elapsed = (now - startTime) / 1000;
  const actualFps = frame / elapsed;
  const avgFrameTime = frameTimes.length > 0
    ? frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length
    : 0;

  // Animation 1: Spinner
  const spinnerIdx = frame % spinnerChars.length;
  const spinner = spinnerChars[spinnerIdx];

  // Animation 2: Bouncing ball
  const ballPos = Math.floor((Math.sin(frame * 0.1) + 1) * barWidth / 2);
  const ballBar = ' '.repeat(ballPos) + '●' + ' '.repeat(barWidth - ballPos - 1);

  // Animation 3: Progress bar wave
  const waveBar = Array.from({ length: barWidth }, (_, i) => {
    const wave = Math.sin((frame * 0.2) + (i * 0.3));
    if (wave > 0.6) return '█';
    if (wave > 0.2) return '▓';
    if (wave > -0.2) return '▒';
    if (wave > -0.6) return '░';
    return ' ';
  }).join('');

  // Animation 4: Moving gradient
  const gradientChars = '░▒▓█▓▒░';
  const gradient = Array.from({ length: barWidth }, (_, i) => {
    const idx = (i + frame) % gradientChars.length;
    return gradientChars[idx];
  }).join('');

  // Stutter indicator
  const stutterIndicator = frameTime > stutterThreshold
    ? `${ESC}[91m STUTTER! ${formatMs(frameTime)}ms ${ESC}[0m`
    : `${ESC}[92m OK ${ESC}[0m`;

  // Render
  moveCursor(1, 1);
  console.log(`${ESC}[1m=== FPS Stutter Test ===${ESC}[0m`);
  console.log(`Target: ${targetFps} FPS (${frameInterval.toFixed(2)}ms/frame)`);
  console.log('');
  console.log(`${ESC}[36mSpinner:${ESC}[0m  ${spinner}  Frame: ${frame.toString().padStart(6)}`);
  console.log(`${ESC}[36mBounce:${ESC}[0m   [${ballBar}]`);
  console.log(`${ESC}[36mWave:${ESC}[0m     [${waveBar}]`);
  console.log(`${ESC}[36mGradient:${ESC}[0m [${gradient}]`);
  console.log('');
  console.log(`${ESC}[33mStatistics:${ESC}[0m`);
  console.log(`  Elapsed:      ${elapsed.toFixed(1)}s`);
  console.log(`  Actual FPS:   ${actualFps.toFixed(1)}`);
  console.log(`  Frame time:   ${formatMs(frameTime)}ms  ${stutterIndicator}`);
  console.log(`  Avg frame:    ${formatMs(avgFrameTime)}ms`);
  console.log(`  Max frame:    ${formatMs(maxFrameTime)}ms`);
  console.log(`  Stutters:     ${droppedFrames} (>${stutterThreshold.toFixed(1)}ms)`);
  console.log('');
  console.log(`${ESC}[90mPress Ctrl+C to stop and see detailed statistics${ESC}[0m`);

  frame++;
}

function printFinalStats() {
  showCursor();
  clearScreen();

  console.log('=== Final Statistics ===\n');

  if (frameTimes.length === 0) {
    console.log('No frames recorded.');
    return;
  }

  const totalTime = (performance.now() - startTime) / 1000;
  const avgFrameTime = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
  const actualFps = frame / totalTime;

  // Calculate percentiles
  const sorted = [...frameTimes].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.50)];
  const p90 = sorted[Math.floor(sorted.length * 0.90)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];

  // Count stutters by severity
  const mildStutters = frameTimes.filter(t => t > stutterThreshold && t <= frameInterval * 2).length;
  const moderateStutters = frameTimes.filter(t => t > frameInterval * 2 && t <= frameInterval * 4).length;
  const severeStutters = frameTimes.filter(t => t > frameInterval * 4).length;

  console.log(`Total frames:     ${frame}`);
  console.log(`Total time:       ${totalTime.toFixed(2)}s`);
  console.log(`Target FPS:       ${targetFps}`);
  console.log(`Actual FPS:       ${actualFps.toFixed(2)}`);
  console.log(`FPS efficiency:   ${((actualFps / targetFps) * 100).toFixed(1)}%`);
  console.log('');
  console.log('Frame times:');
  console.log(`  Average:        ${avgFrameTime.toFixed(2)}ms`);
  console.log(`  Min:            ${sorted[0].toFixed(2)}ms`);
  console.log(`  Max:            ${maxFrameTime.toFixed(2)}ms`);
  console.log(`  P50:            ${p50.toFixed(2)}ms`);
  console.log(`  P90:            ${p90.toFixed(2)}ms`);
  console.log(`  P95:            ${p95.toFixed(2)}ms`);
  console.log(`  P99:            ${p99.toFixed(2)}ms`);
  console.log('');
  console.log('Stutters (frame time > target):');
  console.log(`  Mild (1.5-2x):    ${mildStutters}`);
  console.log(`  Moderate (2-4x):  ${moderateStutters}`);
  console.log(`  Severe (>4x):     ${severeStutters}`);
  console.log(`  Total:            ${droppedFrames}`);
  console.log('');

  // Show histogram of frame times
  const buckets = [
    { max: frameInterval, label: `<${frameInterval.toFixed(0)}ms (on time)` },
    { max: frameInterval * 1.5, label: `<${(frameInterval * 1.5).toFixed(0)}ms` },
    { max: frameInterval * 2, label: `<${(frameInterval * 2).toFixed(0)}ms` },
    { max: frameInterval * 4, label: `<${(frameInterval * 4).toFixed(0)}ms` },
    { max: Infinity, label: `>${(frameInterval * 4).toFixed(0)}ms` },
  ];

  console.log('Frame time distribution:');
  let remaining = frameTimes.length;
  for (const bucket of buckets) {
    const count = frameTimes.filter(t => t <= bucket.max).length;
    const inBucket = count - (frameTimes.length - remaining);
    remaining = frameTimes.length - count;
    const pct = (inBucket / frameTimes.length) * 100;
    const bar = '█'.repeat(Math.floor(pct / 2));
    console.log(`  ${bucket.label.padEnd(20)} ${bar} ${pct.toFixed(1)}%`);
  }
}

// Setup
clearScreen();
hideCursor();

console.log('Starting FPS test...\n');

// Main loop using setInterval for consistent timing
const interval = setInterval(renderFrame, frameInterval);

// Handle Ctrl+C
process.on('SIGINT', () => {
  clearInterval(interval);
  printFinalStats();
  process.exit(0);
});

// Also handle SIGTERM
process.on('SIGTERM', () => {
  clearInterval(interval);
  printFinalStats();
  process.exit(0);
});
