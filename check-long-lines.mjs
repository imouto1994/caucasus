/**
 * Export Long Lines from Translated Scripts
 *
 * Scans every .txt file in `translated/` and `translated-vertical/` and
 * exports lines exceeding MAX_LENGTH characters to `long_lines.txt`.
 *
 * Output format (one entry per long line):
 *
 *   {fileName} | {lineNumber}
 *   {lineContent}
 *
 * This file can be copied to `long_lines_updated.txt` for manual editing,
 * then applied back using `apply-long-lines-fix.mjs`.
 *
 * All files are Shift-JIS encoded.
 *
 * Usage:
 *   node check-long-lines.mjs
 */

import { readFile, readdir, writeFile } from "fs/promises";
import path from "path";

const DIRS = ["translated"];
const MAX_LENGTH = 120;
const OUTPUT_FILE = "long_lines.txt";

const sjisDecoder = new TextDecoder("shift_jis");

async function main() {
  const entries = [];

  for (const dir of DIRS) {
    let fileNames;
    try {
      fileNames = (await readdir(dir)).filter((f) => f.endsWith(".txt")).sort();
    } catch {
      continue;
    }

    for (const fileName of fileNames) {
      const filePath = path.join(dir, fileName);
      const raw = await readFile(filePath);
      const text = sjisDecoder.decode(raw);
      const lines = text.split("\n");

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].length > MAX_LENGTH) {
          entries.push({ file: filePath, lineNum: i + 1, text: lines[i] });
        }
      }
    }
  }

  // Build the output: each entry is a header line + content line.
  const outputLines = [];
  for (const entry of entries) {
    outputLines.push(`${entry.file} | ${entry.lineNum}`);
    outputLines.push(entry.text);
  }

  await writeFile(OUTPUT_FILE, outputLines.join("\n"), "utf-8");

  console.log(`Exported ${entries.length} long lines to ${OUTPUT_FILE}`);
  console.log(
    `Copy to long_lines_updated.txt, shorten each content line, then run apply-long-lines-fix.mjs`
  );
}

main().catch(console.error);
