/**
 * Pad Translated Scripts for Display Line Wrapping
 *
 * The game text box displays each line across a maximum of 2 displayed rows.
 * The 1st row accepts 64 characters; any remaining text flows to the 2nd row.
 * When a word straddles the 64-char boundary, part of it appears on row 1 and
 * the rest on row 2, which looks bad.
 *
 * This script scans each line in `translated/` and:
 *   1. If a word would be cut at the 64-char boundary, inserts space padding
 *      before that word so it starts on the 2nd row instead.
 *   2. If a word ends exactly at char 64 and the next char is a space, removes
 *      that redundant leading space from the 2nd row.
 *   3. Logs lines where padding causes the total length to exceed 125 chars.
 *
 * Speech source lines (＃...) are skipped — the game engine handles those.
 * Output is written to `translated-padding/`.
 *
 * Usage:
 *   node pad-translations.mjs
 */

import { readFile, readdir, writeFile, mkdir } from "fs/promises";
import path from "path";
import Encoding from "encoding-japanese";

const INPUT_DIR = "translated";
const OUTPUT_DIR = "translated-padding";
const LINE_WIDTH = 64;
const MAX_LENGTH = 128;

const sjisDecoder = new TextDecoder("shift_jis");

function encodeShiftJIS(str) {
  const codeArray = Encoding.convert(Encoding.stringToCode(str), {
    to: "SJIS",
    from: "UNICODE",
  });
  return Buffer.from(codeArray);
}

/**
 * Pad a single line so that no word is cut at the LINE_WIDTH boundary.
 * Returns the padded line.
 */
function padLine(line) {
  // Lines that fit on one row don't need padding.
  if (line.length <= LINE_WIDTH) return line;

  const first = line.slice(0, LINE_WIDTH);
  const rest = line.slice(LINE_WIDTH);

  // Case 1: the last char of row 1 is a space — clean word break.
  if (first.endsWith(" ")) return line;

  // Case 2: the first char of row 2 is a space — the word before it ended
  // exactly at the 64-char boundary. The line break already acts as the
  // visual word separator, so the leading space on row 2 is redundant.
  if (rest.startsWith(" ")) return first + rest.slice(1);

  // Case 2: a word straddles the boundary. Find where that word starts by
  // scanning backward from the boundary to the last space in the 1st row.
  const lastSpace = first.lastIndexOf(" ");
  if (lastSpace === -1) {
    // No space in the entire first row — can't pad without breaking it.
    return line;
  }

  // Insert padding spaces after the last space so the cut word starts at
  // the beginning of the 2nd row.
  const beforeWord = line.slice(0, lastSpace + 1);
  const wordAndRest = line.slice(lastSpace + 1);
  const padding = " ".repeat(LINE_WIDTH - (lastSpace + 1));

  return beforeWord + padding + wordAndRest;
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const fileNames = (await readdir(INPUT_DIR))
    .filter((f) => f.endsWith(".txt"))
    .sort();

  let totalFiles = 0;
  let modifiedFiles = 0;
  let paddedLines = 0;
  let overLimitLines = 0;

  for (const fileName of fileNames) {
    const raw = await readFile(path.join(INPUT_DIR, fileName));
    const text = sjisDecoder.decode(raw);
    const lines = text.split("\n");

    let fileModified = false;

    const result = lines.map((line, i) => {
      // Skip speech source lines.
      if (line.startsWith("＃")) return line;
      // Skip lines that fit on one row.
      if (line.length <= LINE_WIDTH) return line;

      const padded = padLine(line);
      if (padded !== line) {
        fileModified = true;
        paddedLines++;

        if (padded.length > MAX_LENGTH) {
          overLimitLines++;
          console.log(
            `[OVER ${MAX_LENGTH}] ${fileName} | ${i + 1} (${
              padded.length
            } chars)`
          );
          console.log(`  ${padded}`);
        }
      }
      return padded;
    });

    totalFiles++;
    if (fileModified) modifiedFiles++;

    const outputPath = path.join(OUTPUT_DIR, fileName);
    await writeFile(outputPath, encodeShiftJIS(result.join("\n")));
  }

  console.log();
  console.log("— Summary —");
  console.log(`  Files processed:     ${totalFiles}`);
  console.log(`  Files with padding:  ${modifiedFiles}`);
  console.log(`  Lines padded:        ${paddedLines}`);
  if (overLimitLines > 0) {
    console.log(`  Lines over ${MAX_LENGTH} chars: ${overLimitLines}`);
  }
}

main().catch(console.error);
