/**
 * Validate Translated Scripts
 *
 * Compares each translated script in `translated/` against its original
 * counterpart in `original/` to ensure structural consistency.
 *
 * Checks performed:
 *   1. Both files have the same number of lines.
 *   2. Each line's "type" matches between the two files.
 *
 * Line types:
 *   - Speech source  — ＃*** (original) / #*** (translated)
 *   - Speech content  — 「***」(original) / "***" (translated)
 *   - Normal line     — anything else
 *
 * Files in `translated/` that still use Japanese formatting (＃ and 「」)
 * are treated as not-yet-translated and silently skipped.
 *
 * Both `original/` and `translated/` files are Shift-JIS encoded, so we
 * read raw bytes and decode with TextDecoder("shift_jis").
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

// Line-type classifiers for original (Japanese) formatting.
const isJpSpeechSource = (line) => line.startsWith("＃");
const isJpSpeechContent = (line) => line.startsWith("「") && line.endsWith("」");

// Line-type classifiers for translated (English) formatting.
const isEnSpeechSource = (line) => line.startsWith("#");
const isEnSpeechContent = (line) => line.startsWith('"') && line.endsWith('"');

const LINE_TYPE = { SPEECH_SOURCE: "speech_source", SPEECH_CONTENT: "speech_content", NORMAL: "normal" };

function classifyOriginalLine(line) {
  if (isJpSpeechSource(line)) return LINE_TYPE.SPEECH_SOURCE;
  if (isJpSpeechContent(line)) return LINE_TYPE.SPEECH_CONTENT;
  return LINE_TYPE.NORMAL;
}

function classifyTranslatedLine(line) {
  if (isEnSpeechSource(line)) return LINE_TYPE.SPEECH_SOURCE;
  if (isEnSpeechContent(line)) return LINE_TYPE.SPEECH_CONTENT;
  return LINE_TYPE.NORMAL;
}

// A translated file that still uses Japanese line formatting hasn't been
// translated yet. We detect this by checking whether the content is
// identical to the original, or if it uses Japanese markers (＃ / 「」)
// without any English markers (# / "").
function isUntranslated(translatedLines, originalLines) {
  if (translatedLines.join("\n") === originalLines.join("\n")) return true;

  const hasJpFormat = translatedLines.some((l) => isJpSpeechSource(l) || isJpSpeechContent(l));
  const hasEnFormat = translatedLines.some((l) => isEnSpeechSource(l) || isEnSpeechContent(l));
  return hasJpFormat && !hasEnFormat;
}

async function main() {
  // Step 1: Discover all translated script files.
  const translatedFiles = await glob(`${TRANSLATED_DIR}/*.txt`);
  translatedFiles.sort();

  let checkedCount = 0;
  let skippedCount = 0;
  let mismatchedFileCount = 0;

  for (const translatedPath of translatedFiles) {
    const filename = path.basename(translatedPath);
    const originalPath = path.join(ORIGINAL_DIR, filename);

    // Step 2: Read both files as raw bytes and decode from Shift-JIS.
    // If the original doesn't exist, warn and skip.
    let originalRaw;
    try {
      originalRaw = sjisDecoder.decode(await readFile(originalPath));
    } catch {
      console.warn(`⚠  No original found for ${filename}, skipping.`);
      skippedCount++;
      continue;
    }

    const translatedRaw = sjisDecoder.decode(await readFile(translatedPath));

    // Step 3: Split into lines and strip the trailing empty line that a
    // final newline produces, so we compare actual content lines only.
    const originalLines = originalRaw.split("\n");
    const translatedLines = translatedRaw.split("\n");

    if (originalLines.at(-1) === "") originalLines.pop();
    if (translatedLines.at(-1) === "") translatedLines.pop();

    // Step 4: Skip files that haven't been translated yet (still using
    // original Japanese formatting).
    if (isUntranslated(translatedLines, originalLines)) {
      skippedCount++;
      continue;
    }

    checkedCount++;
    const mismatches = [];

    // Step 5: Verify both files have the same number of lines.
    if (originalLines.length !== translatedLines.length) {
      console.log(`\n✗  ${filename}`);
      console.log(
        `   Line count mismatch: original has ${originalLines.length} lines, translated has ${translatedLines.length} lines`,
      );
      mismatchedFileCount++;
      continue;
    }

    // Step 6: Compare the line type of each line pair. The translated line's
    // type (speech source / speech content / normal) must match the
    // original's type on the same line number.
    for (let i = 0; i < originalLines.length; i++) {
      const origType = classifyOriginalLine(originalLines[i]);
      const transType = classifyTranslatedLine(translatedLines[i]);

      if (origType !== transType) {
        mismatches.push({
          line: i + 1,
          origType,
          transType,
          origText: originalLines[i],
          transText: translatedLines[i],
        });
      }
    }

    // Step 7: Report any mismatches found for this file.
    if (mismatches.length > 0) {
      mismatchedFileCount++;
      console.log(`\n✗  ${filename}`);
      for (const m of mismatches) {
        console.log(`   Line ${m.line}: expected [${m.origType}] but got [${m.transType}]`);
        console.log(`     original:   ${m.origText}`);
        console.log(`     translated: ${m.transText}`);
      }
    }
  }

  // Step 8: Print summary and exit with non-zero code if any mismatches
  // were found (useful for CI pipelines).
  console.log("\n— Summary —");
  console.log(`  Checked:    ${checkedCount} files`);
  console.log(`  Skipped:    ${skippedCount} files (untranslated or missing original)`);
  console.log(`  Mismatched: ${mismatchedFileCount} files`);

  if (mismatchedFileCount > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
