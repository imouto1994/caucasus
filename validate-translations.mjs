/**
 * Validate Translated Scripts
 *
 * Compares each translated script against its original counterpart in
 * `original/` to ensure structural consistency. Handles two directories:
 *
 *   - `translated/`            — normal (horizontal) scripts
 *   - `translated-inspection/` — inspection scripts
 *   - `translated-vertical/`   — vertical-style scripts whose lines have
 *                               leading whitespace that must be trimmed
 *                               before classification
 *
 * Checks performed:
 *   1. Both files have the same number of lines.
 *   2. Speech source lines (＃) must appear at the same positions and be
 *      identical between original and translated (Japanese speaker names).
 *
 * Both original and translated files are Shift-JIS encoded, so we read raw
 * bytes and decode with TextDecoder("shift_jis").
 *
 * Usage:
 *   node validate-translations.mjs
 */

import { glob } from "glob";
import { readFile } from "fs/promises";
import path from "path";

const sjisDecoder = new TextDecoder("shift_jis");

const ORIGINAL_DIR = "original";
const TRANSLATED_DIR = "translated";
const TRANSLATED_INSPECTION_DIR = "translated-inspection";
const TRANSLATED_VERTICAL_DIR = "translated-vertical";

const isSpeechSource = (line) => line.startsWith("＃");

// Canonical Japanese → English speech source name mapping.
// Kept for reference; speech source lines now use the original Japanese names.
const SPEAKER_MAP = new Map([
  ["主人公", "Protagonist"],
  ["なるみ", "Narumi"],
  ["想子", "Souko"],
  ["辻村", "Tsujimura"],
  ["高嶺", "Takamine"],
  ["紅緒", "Benio"],
  ["あかね", "Akane"],
  ["御巫", "Mikanagi"],
  ["摩夜", "Maya"],
  ["藍", "Ai"],
  ["詩音", "Shion"],
  ["六曜", "Rokuyou"],
  ["？？？", "???"],
  ["警官", "Police Officer"],
  ["御者", "Coachman"],
]);

/**
 * Validate all translated files in the given directory against originals.
 * When `trim` is true, lines are trimmed before classification (needed for
 * vertical-style scripts that carry leading whitespace).
 *
 * Returns { checked, skipped, mismatched }.
 */
async function validateDirectory(translatedDir, trim) {
  const translatedFiles = (await glob(`${translatedDir}/*.txt`)).sort();

  let checked = 0;
  let skipped = 0;
  let mismatched = 0;

  for (const translatedPath of translatedFiles) {
    const filename = path.basename(translatedPath);
    const originalPath = path.join(ORIGINAL_DIR, filename);

    // Read both files as raw bytes and decode from Shift-JIS.
    let originalText;
    try {
      const raw = await readFile(originalPath);
      originalText = sjisDecoder.decode(raw);
    } catch {
      console.warn(`⚠  No original found for ${filename}, skipping.`);
      skipped++;
      continue;
    }

    const translatedText = sjisDecoder.decode(await readFile(translatedPath));

    // Split into lines and strip the trailing empty line that a final
    // newline produces, so we compare actual content lines only.
    const originalLines = originalText.split("\n");
    const translatedLines = translatedText.split("\n");

    if (originalLines.at(-1) === "") originalLines.pop();
    if (translatedLines.at(-1) === "") translatedLines.pop();

    checked++;

    // Verify both files have the same number of lines.
    if (originalLines.length !== translatedLines.length) {
      console.log(`\n✗  ${filename}`);
      console.log(
        `   Line count mismatch: original has ${originalLines.length} lines, translated has ${translatedLines.length} lines`,
      );

      // Walk through the overlapping lines to find the first speech source
      // position mismatch.
      const minLen = Math.min(originalLines.length, translatedLines.length);
      for (let i = 0; i < minLen; i++) {
        const origLine = trim ? originalLines[i].trim() : originalLines[i];
        const transLine = trim ? translatedLines[i].trim() : translatedLines[i];
        const origIsSrc = isSpeechSource(origLine);
        const transIsSrc = isSpeechSource(transLine);
        if (origIsSrc !== transIsSrc) {
          console.log(
            `   First speech source mismatch at line ${i + 1}:`,
          );
          console.log(`     original:   ${originalLines[i]}`);
          console.log(`     translated: ${translatedLines[i]}`);
          break;
        }
      }

      mismatched++;
      continue;
    }

    // Compare each line pair. Speech source lines must appear at the same
    // positions and be identical to the original (Japanese speaker names).
    const lineMismatches = [];
    for (let i = 0; i < originalLines.length; i++) {
      const origLine = trim ? originalLines[i].trim() : originalLines[i];
      const transLine = trim ? translatedLines[i].trim() : translatedLines[i];
      const origIsSrc = isSpeechSource(origLine);
      const transIsSrc = isSpeechSource(transLine);

      if (origIsSrc !== transIsSrc) {
        lineMismatches.push({
          line: i + 1,
          kind: "type",
          origText: originalLines[i],
          transText: translatedLines[i],
        });
      } else if (origIsSrc && origLine !== transLine) {
        lineMismatches.push({
          line: i + 1,
          kind: "speaker_name",
          origText: originalLines[i],
          transText: translatedLines[i],
        });
      }
    }

    if (lineMismatches.length > 0) {
      mismatched++;
      console.log(`\n✗  ${filename}`);
      for (const m of lineMismatches) {
        if (m.kind === "type") {
          console.log(
            `   Line ${m.line}: speech source position mismatch`,
          );
        } else if (m.kind === "speaker_name") {
          console.log(
            `   Line ${m.line}: speech source line differs from original`,
          );
        }
        console.log(`     original:   ${m.origText}`);
        console.log(`     translated: ${m.transText}`);
      }
    }
  }

  return { checked, skipped, mismatched };
}

async function main() {
  let totalChecked = 0;
  let totalSkipped = 0;
  let totalMismatched = 0;

  // Step 1: Validate normal (horizontal) scripts — no trimming needed.
  console.log(`=== ${TRANSLATED_DIR}/ ===`);
  const normal = await validateDirectory(TRANSLATED_DIR, false);
  totalChecked += normal.checked;
  totalSkipped += normal.skipped;
  totalMismatched += normal.mismatched;

  // Step 2: Validate inspection scripts — no trimming needed.
  console.log(`\n=== ${TRANSLATED_INSPECTION_DIR}/ ===`);
  const inspection = await validateDirectory(TRANSLATED_INSPECTION_DIR, false);
  totalChecked += inspection.checked;
  totalSkipped += inspection.skipped;
  totalMismatched += inspection.mismatched;

  // Step 3: Validate vertical-style scripts — trim leading whitespace
  // before classifying lines, since vertical scripts indent every line.
  console.log(`\n=== ${TRANSLATED_VERTICAL_DIR}/ ===`);
  const vertical = await validateDirectory(TRANSLATED_VERTICAL_DIR, true);
  totalChecked += vertical.checked;
  totalSkipped += vertical.skipped;
  totalMismatched += vertical.mismatched;

  // Step 3: Print summary.
  console.log("\n— Summary —");
  console.log(`  Checked:    ${totalChecked} files`);
  console.log(
    `  Skipped:    ${totalSkipped} files (untranslated or missing original)`,
  );
  console.log(`  Mismatched: ${totalMismatched} files`);

  if (totalMismatched > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
