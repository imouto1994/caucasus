/**
 * Detect Vertical-Style Scripts
 *
 * Japanese text set in vertical (tategumi) style is typically indented with a
 * fullwidth space (　, U+3000) at the start of every line. In Shift-JIS that
 * character is encoded as the two-byte sequence 0x81 0x40.
 *
 * This script scans every .txt file in `original/`, reads each one as a raw
 * buffer (preserving Shift-JIS bytes), and flags any file where ALL non-empty
 * lines begin with the 0x81 0x40 byte pair.
 *
 * Usage:
 *   node detect-vertical-scripts.mjs
 */

import { glob } from "glob";
import { readFile } from "fs/promises";
import path from "path";

const ORIGINAL_DIR = "original";

// Shift-JIS encoding of the fullwidth space (　, U+3000).
const SJIS_FULLWIDTH_SPACE_B0 = 0x81;
const SJIS_FULLWIDTH_SPACE_B1 = 0x40;

/**
 * Returns true when every non-empty line in the buffer starts with the
 * Shift-JIS fullwidth-space byte pair (0x81 0x40).
 */
function isVertical(buf) {
  let pos = 0;
  let hasContent = false;

  while (pos < buf.length) {
    // Locate the next newline to isolate the current line.
    let end = buf.indexOf(0x0a, pos);
    if (end === -1) end = buf.length;

    // Exclude a trailing \r so both LF and CRLF files are handled correctly.
    const lineEnd = end > pos && buf[end - 1] === 0x0d ? end - 1 : end;
    const lineLen = lineEnd - pos;

    if (lineLen > 0) {
      hasContent = true;
      // Fail fast: the moment any non-empty line doesn't open with the
      // fullwidth-space bytes the file is not uniformly vertical.
      if (
        lineLen < 2 ||
        buf[pos] !== SJIS_FULLWIDTH_SPACE_B0 ||
        buf[pos + 1] !== SJIS_FULLWIDTH_SPACE_B1
      ) {
        return false;
      }
    }

    // Advance past the newline character to the start of the next line.
    pos = end + 1;
  }

  // Guard against empty files being misidentified as vertical.
  return hasContent;
}

async function main() {
  // Collect and sort all .txt files so the output order is deterministic.
  const files = (await glob(`${ORIGINAL_DIR}/*.txt`)).sort();

  const vertical = [];

  // Read each file as a raw buffer and run the vertical-style check.
  for (const filePath of files) {
    const buf = await readFile(filePath);
    if (isVertical(buf)) {
      vertical.push(path.basename(filePath));
    }
  }

  if (vertical.length === 0) {
    console.log("No vertical-style scripts found.");
    return;
  }

  // Print the results.
  console.log(`Vertical-style scripts (${vertical.length}):`);
  for (const name of vertical) {
    console.log(`  ${name}`);
  }
}

main().catch(console.error);
