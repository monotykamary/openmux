/**
 * Minimal FFI smoke test for the zig-ghostty-wrapper.
 */
import { ghostty } from "../src/terminal/ghostty-vt/ffi";

const cols = 4;
const rows = 2;
const ESC = "\x1b";

const term = ghostty.symbols.ghostty_terminal_new(cols, rows);
if (!term) {
  throw new Error("ghostty_terminal_new returned null");
}

try {
  const text = Buffer.from("hi");
  ghostty.symbols.ghostty_terminal_write(term, text, text.length);
  ghostty.symbols.ghostty_render_state_update(term);

  const cellSize = 16;
  const totalCells = cols * rows;
  const buffer = Buffer.alloc(totalCells * cellSize);
  const count = ghostty.symbols.ghostty_render_state_get_viewport(term, buffer, totalCells);
  if (count <= 0) {
    throw new Error(`render_state_get_viewport returned ${count}`);
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const codepoint = view.getUint32(0, true);
  if (codepoint !== "h".codePointAt(0)) {
    throw new Error(`unexpected codepoint ${codepoint}`);
  }

  const query = Buffer.from(`${ESC}_Ga=q,t=f,i=1;${ESC}\\`);
  ghostty.symbols.ghostty_terminal_write(term, query, query.length);
  ghostty.symbols.ghostty_render_state_update(term);

  if (!ghostty.symbols.ghostty_terminal_has_response(term)) {
    throw new Error("expected kitty query response");
  }

  const responseBuffer = Buffer.alloc(64);
  const written = ghostty.symbols.ghostty_terminal_read_response(
    term,
    responseBuffer,
    responseBuffer.length
  );
  if (written <= 0) {
    throw new Error(`expected kitty query response, got ${written}`);
  }

  const response = responseBuffer.subarray(0, written).toString("utf8");
  const expected = `${ESC}_Gi=1;OK${ESC}\\`;
  if (response !== expected) {
    throw new Error(`unexpected kitty response: ${response}`);
  }

  console.log("zig-ghostty-wrapper smoke test ok");
} finally {
  ghostty.symbols.ghostty_terminal_free(term);
}
