/**
 * Detect Vertical-Style Scripts
 *
 * Japanese text set in vertical (tategumi) style starts every line with one
 * of two characters:
 *   - 　 (fullwidth space, U+3000) — indent for narration lines
 *   - 「 (left corner bracket, U+300C) — opening of a dialogue line
 *
 * In Shift-JIS these are encoded as:
 *   　 → 0x81 0x40
 *   「 → 0x81 0x42
 *
 * Both share the lead byte 0x81, so the check only needs to branch on the
 * second byte.
 *
 * This script scans every .txt file in `original/`, reads each one as a raw
 * buffer (preserving Shift-JIS bytes), and flags any file where ALL non-empty
 * lines begin with one of those two byte pairs.
 *
 * Usage:
 *   node detect-vertical-scripts.mjs
 */

import { glob } from "glob";
import { readFile } from "fs/promises";
import path from "path";

const ORIGINAL_DIR = "original";

// Both vertical-style line starters share the Shift-JIS lead byte 0x81.
const SJIS_LEAD_BYTE = 0x81;
// 　 (fullwidth space, U+3000) → 0x81 0x40
const SJIS_FULLWIDTH_SPACE = 0x40;
// 「 (left corner bracket, U+300C) → 0x81 0x75
const SJIS_LEFT_CORNER_BRACKET = 0x75;

/**
 * Returns true when every non-empty line in the buffer starts with the
 * Shift-JIS encoding of either 　 (0x81 0x40) or 「 (0x81 0x42).
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
      // Fail fast: the moment any non-empty line doesn't open with either
      // vertical-style starter the file is not uniformly vertical.
      if (
        lineLen < 2 ||
        buf[pos] !== SJIS_LEAD_BYTE ||
        (buf[pos + 1] !== SJIS_FULLWIDTH_SPACE &&
          buf[pos + 1] !== SJIS_LEFT_CORNER_BRACKET)
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
