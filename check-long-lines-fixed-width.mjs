/**
 * Check Long Lines in Fixed-Width Scripts
 *
 * Reads the list of filenames from `fixed-width-files.json` and scans each
 * corresponding file in `translated/` against its original in `original/`.
 *
 * Fixed-width scripts use a fixed-width layout: each fullwidth character in
 * the original occupies 2 columns, so the translated (ASCII) line must have
 * exactly 2× the character count of the original line. Lines exceeding this
 * limit are exported to `long_lines_fixed_width.txt`.
 *
 * Lines identical to the original (speech sources, options, etc.) and empty
 * lines are skipped.
 *
 * When re-run after adding new files to the manifest, entries for the new
 * files are prepended above any existing entries so they appear at the top
 * for editing.
 *
 * Output format (one entry per long line):
 *
 *   {fileName} | {lineNumber} | {requiredLength}
 *   {lineContent}
 *
 * Copy the output to `long_lines_fixed_width_updated.txt`, shorten each
 * content line, then run `validate-long-lines-fix-fixed-width.mjs`.
 *
 * All files are Shift-JIS encoded.
 *
 * Usage:
 *   node check-long-lines-fixed-width.mjs
 */

import { readFile, writeFile } from "fs/promises";
import path from "path";

const TRANSLATED_DIR = "translated";
const ORIGINAL_DIR = "original";
const MANIFEST_FILE = "fixed-width-files.json";
const OUTPUT_FILE = "long_lines_fixed_width.txt";

const sjisDecoder = new TextDecoder("shift_jis");

/**
 * Parse existing entries from the output file.
 * Returns a Map of fileName → array of raw two-line strings.
 */
function parseExistingEntries(content) {
  const lines = content.split("\n");
  const byFile = new Map();

  for (let i = 0; i + 1 < lines.length; i += 2) {
    const header = lines[i];
    const text = lines[i + 1];
    const parts = header.split(" | ");
    if (parts.length !== 3) continue;

    const fileName = parts[0];
    if (!byFile.has(fileName)) byFile.set(fileName, []);
    byFile.get(fileName).push(header, text);
  }

  return byFile;
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST_FILE, "utf-8"));

  if (manifest.length === 0) {
    console.log("No files listed in fixed-width-files.json, nothing to check.");
    return;
  }

  // Load existing output to preserve entries for files already processed.
  let existingByFile = new Map();
  try {
    const existing = await readFile(OUTPUT_FILE, "utf-8");
    if (existing.trim().length > 0) {
      existingByFile = parseExistingEntries(existing);
    }
  } catch {
    // No existing file — first run.
  }

  const existingFileNames = new Set(existingByFile.keys());

  const newEntries = [];
  let totalChecked = 0;
  let newFileCount = 0;

  for (const fileName of manifest) {
    // Skip files that already have entries in the output.
    if (existingFileNames.has(fileName)) continue;

    newFileCount++;

    let transRaw;
    try {
      transRaw = await readFile(path.join(TRANSLATED_DIR, fileName));
    } catch {
      console.warn(`  ⚠  Translated file not found: ${fileName}, skipping.`);
      continue;
    }

    const transText = sjisDecoder.decode(transRaw);
    const transLines = transText.split("\n");

    let origRaw;
    try {
      origRaw = await readFile(path.join(ORIGINAL_DIR, fileName));
    } catch {
      console.warn(`  ⚠  No original found for ${fileName}, skipping.`);
      continue;
    }

    const origText = sjisDecoder.decode(origRaw);
    const origLines = origText.split("\n");

    const lineCount = Math.min(transLines.length, origLines.length);

    for (let i = 0; i < lineCount; i++) {
      const origLine = origLines[i];
      if (origLine.length === 0) continue;
      if (transLines[i] === origLine) continue;

      const required = origLine.length * 2;
      totalChecked++;

      if (transLines[i].length > required) {
        newEntries.push({
          fileName,
          lineNum: i + 1,
          required,
          text: transLines[i],
        });
      }
    }
  }

  // Build output: new entries first, then existing entries.
  const outputLines = [];

  for (const entry of newEntries) {
    outputLines.push(
      `${entry.fileName} | ${entry.lineNum} | ${entry.required}`
    );
    outputLines.push(entry.text);
  }

  for (const fileName of manifest) {
    if (!existingByFile.has(fileName)) continue;
    outputLines.push(...existingByFile.get(fileName));
  }

  await writeFile(OUTPUT_FILE, outputLines.join("\n"), "utf-8");

  console.log("— Summary —");
  console.log(`  Files in manifest:  ${manifest.length}`);
  console.log(`  New files scanned:  ${newFileCount}`);
  console.log(`  New lines too long: ${newEntries.length}`);
  console.log(`  Existing entries:   ${existingByFile.size} files kept`);
  console.log(`  Exported to: ${OUTPUT_FILE}`);
  console.log();
  console.log(
    `Copy to long_lines_fixed_width_updated.txt, shorten each content line,` +
      ` then run validate-long-lines-fix-fixed-width.mjs`
  );
}

main().catch(console.error);
