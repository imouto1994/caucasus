/**
 * Validate Translated Scripts
 *
 * Compares each translated script against its original counterpart in
 * `original/` to ensure structural consistency. Handles two directories:
 *
 *   - `translated/`          — normal (horizontal) scripts
 *   - `translated-vertical/` — vertical-style scripts whose lines have
 *                               leading whitespace that must be trimmed
 *                               before classification
 *
 * Checks performed:
 *   1. Both files have the same number of lines.
 *   2. Each line's "type" matches between the two files.
 *
 * Line types:
 *   - Speech source  — ＃*** (original) / #*** (translated)
 *   - Speech content — 「***」or 『***』(original) / "***" (translated)
 *   - Normal line    — anything else
 *
 * Original files in `original/` are Shift-JIS encoded, so we read raw bytes
 * and decode with TextDecoder("shift_jis"). Translated files are UTF-8.
 *
 * Files that still use Japanese formatting (＃ and 「」/『』) are treated as
 * not-yet-translated and silently skipped.
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
const TRANSLATED_VERTICAL_DIR = "translated-vertical";

// Line-type classifiers for original (Japanese) formatting.
const isJpSpeechSource = (line) => line.startsWith("＃");
const isJpSpeechContent = (line) =>
  (line.startsWith("「") && line.endsWith("」")) ||
  (line.startsWith("『") && line.endsWith("』"));

// Line-type classifiers for translated (English) formatting.
const isEnSpeechSource = (line) => line.startsWith("#");
const isEnSpeechContent = (line) => line.startsWith('"') && line.endsWith('"');

const LINE_TYPE = {
  SPEECH_SOURCE: "speech_source",
  SPEECH_CONTENT: "speech_content",
  NORMAL: "normal",
};

function classifyOriginalLine(line, trim) {
  const target = trim ? line.trim() : line;
  if (isJpSpeechSource(target)) return LINE_TYPE.SPEECH_SOURCE;
  if (isJpSpeechContent(target)) return LINE_TYPE.SPEECH_CONTENT;
  return LINE_TYPE.NORMAL;
}

function classifyTranslatedLine(line, trim) {
  const target = trim ? line.trim() : line;
  if (isEnSpeechSource(target)) return LINE_TYPE.SPEECH_SOURCE;
  if (isEnSpeechContent(target)) return LINE_TYPE.SPEECH_CONTENT;
  return LINE_TYPE.NORMAL;
}

// A translated file that still uses Japanese line formatting hasn't been
// translated yet. We detect this by checking whether it uses Japanese markers
// (＃ / 「」/ 『』) without any English markers (# / "").
function isUntranslated(translatedLines) {
  const hasJpFormat = translatedLines.some(
    (l) => isJpSpeechSource(l.trim()) || isJpSpeechContent(l.trim()),
  );
  const hasEnFormat = translatedLines.some(
    (l) => isEnSpeechSource(l.trim()) || isEnSpeechContent(l.trim()),
  );
  return hasJpFormat && !hasEnFormat;
}

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

    // Read the original file as raw bytes and decode from Shift-JIS.
    // Read the translated file as UTF-8.
    let originalText;
    try {
      const raw = await readFile(originalPath);
      originalText = sjisDecoder.decode(raw);
    } catch {
      console.warn(`⚠  No original found for ${filename}, skipping.`);
      skipped++;
      continue;
    }

    const translatedText = await readFile(translatedPath, "utf-8");

    // Split into lines and strip the trailing empty line that a final
    // newline produces, so we compare actual content lines only.
    const originalLines = originalText.split("\n");
    const translatedLines = translatedText.split("\n");

    if (originalLines.at(-1) === "") originalLines.pop();
    if (translatedLines.at(-1) === "") translatedLines.pop();

    // Skip files that haven't been translated yet.
    if (isUntranslated(translatedLines)) {
      skipped++;
      continue;
    }

    checked++;

    // Verify both files have the same number of lines.
    if (originalLines.length !== translatedLines.length) {
      console.log(`\n✗  ${filename}`);
      console.log(
        `   Line count mismatch: original has ${originalLines.length} lines, translated has ${translatedLines.length} lines`,
      );
      mismatched++;
      continue;
    }

    // Compare the line type of each line pair.
    const lineMismatches = [];
    for (let i = 0; i < originalLines.length; i++) {
      const origType = classifyOriginalLine(originalLines[i], trim);
      const transType = classifyTranslatedLine(translatedLines[i], trim);

      if (origType !== transType) {
        lineMismatches.push({
          line: i + 1,
          origType,
          transType,
          origText: originalLines[i],
          transText: translatedLines[i],
        });
      }
    }

    if (lineMismatches.length > 0) {
      mismatched++;
      console.log(`\n✗  ${filename}`);
      for (const m of lineMismatches) {
        console.log(
          `   Line ${m.line}: expected [${m.origType}] but got [${m.transType}]`,
        );
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

  // Step 2: Validate vertical-style scripts — trim leading whitespace
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
