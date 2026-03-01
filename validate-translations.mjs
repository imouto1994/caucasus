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
 *   3. Speech source names match the expected Japanese → English mapping.
 *
 * Line types:
 *   - Speech source  — ＃*** (both original and translated use fullwidth hash)
 *   - Speech content — 「***」or 『***』(original) / "***" (translated)
 *   - Normal line    — anything else
 *
 * Original files in `original/` are Shift-JIS encoded, so we read raw bytes
 * and decode with TextDecoder("shift_jis"). Translated files are UTF-8.
 *
 * Files that still use Japanese speech content formatting (「」/『』) without
 * any English speech content ("") are treated as not-yet-translated and
 * silently skipped.
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

// Speech source lines use the fullwidth hash (＃) in both original and
// translated files.
const isSpeechSource = (line) => line.startsWith("＃");

// Speech content classifiers differ between original (Japanese brackets)
// and translated (double quotes).
const isJpSpeechContent = (line) =>
  (line.startsWith("「") && line.endsWith("」")) ||
  (line.startsWith("『") && line.endsWith("』"));
const isEnSpeechContent = (line) => line.startsWith('"') && line.endsWith('"');

// Canonical Japanese → English speech source name mapping.
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

const LINE_TYPE = {
  SPEECH_SOURCE: "speech_source",
  SPEECH_CONTENT: "speech_content",
  NORMAL: "normal",
};

function classifyOriginalLine(line, trim) {
  const target = trim ? line.trim() : line;
  if (isSpeechSource(target)) return LINE_TYPE.SPEECH_SOURCE;
  if (isJpSpeechContent(target)) return LINE_TYPE.SPEECH_CONTENT;
  return LINE_TYPE.NORMAL;
}

function classifyTranslatedLine(line, trim) {
  const target = trim ? line.trim() : line;
  if (isSpeechSource(target)) return LINE_TYPE.SPEECH_SOURCE;
  if (isEnSpeechContent(target)) return LINE_TYPE.SPEECH_CONTENT;
  return LINE_TYPE.NORMAL;
}

// A translated file that still uses Japanese speech content formatting
// hasn't been translated yet. We detect this by checking whether it uses
// Japanese content markers (「」/『』) without any English content markers ("").
function isUntranslated(translatedLines) {
  const hasJpContent = translatedLines.some((l) => isJpSpeechContent(l.trim()));
  const hasEnContent = translatedLines.some((l) => isEnSpeechContent(l.trim()));
  return hasJpContent && !hasEnContent;
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

      // Walk through the overlapping lines to find the first type mismatch,
      // which usually indicates where the translation diverged.
      const minLen = Math.min(originalLines.length, translatedLines.length);
      for (let i = 0; i < minLen; i++) {
        const origType = classifyOriginalLine(originalLines[i], trim);
        const transType = classifyTranslatedLine(translatedLines[i], trim);
        if (origType !== transType) {
          console.log(
            `   First type mismatch at line ${i + 1}: expected [${origType}] but got [${transType}]`,
          );
          console.log(`     original:   ${originalLines[i]}`);
          console.log(`     translated: ${translatedLines[i]}`);
          break;
        }
      }

      mismatched++;
      continue;
    }

    // Compare the line type of each line pair, and for speech source lines
    // also verify the speaker name matches the expected mapping.
    const lineMismatches = [];
    for (let i = 0; i < originalLines.length; i++) {
      const origTrimmed = trim ? originalLines[i].trim() : originalLines[i];
      const transTrimmed = trim
        ? translatedLines[i].trim()
        : translatedLines[i];
      const origType = classifyOriginalLine(originalLines[i], trim);
      const transType = classifyTranslatedLine(translatedLines[i], trim);

      if (origType !== transType) {
        lineMismatches.push({
          line: i + 1,
          kind: "type",
          origType,
          transType,
          origText: originalLines[i],
          transText: translatedLines[i],
        });
      } else if (origType === LINE_TYPE.SPEECH_SOURCE) {
        const jpName = origTrimmed.slice("＃".length);
        const enName = transTrimmed.slice("＃".length);
        const expectedEn = SPEAKER_MAP.get(jpName);

        if (expectedEn === undefined) {
          lineMismatches.push({
            line: i + 1,
            kind: "unknown_speaker",
            origText: originalLines[i],
            transText: translatedLines[i],
          });
        } else if (enName !== expectedEn) {
          lineMismatches.push({
            line: i + 1,
            kind: "speaker_name",
            expected: expectedEn,
            actual: enName,
            origText: originalLines[i],
            transText: translatedLines[i],
          });
        }
      }
    }

    if (lineMismatches.length > 0) {
      mismatched++;
      console.log(`\n✗  ${filename}`);
      for (const m of lineMismatches) {
        if (m.kind === "type") {
          console.log(
            `   Line ${m.line}: expected [${m.origType}] but got [${m.transType}]`,
          );
        } else if (m.kind === "speaker_name") {
          console.log(
            `   Line ${m.line}: speaker name mismatch — expected "${m.expected}" but got "${m.actual}"`,
          );
        } else if (m.kind === "unknown_speaker") {
          console.log(
            `   Line ${m.line}: unknown original speaker (not in mapping)`,
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
