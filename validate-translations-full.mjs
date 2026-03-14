/**
 * Validate Full Translated Scripts (UTF-8)
 *
 * Compares each translated script in `translated-full/` against its original
 * counterpart in `original/` to ensure structural consistency.
 *
 * Checks performed:
 *   1. Both files have the same number of lines.
 *   2. Speech source lines (＃) must appear at the same positions and be
 *      identical between original and translated (Japanese speaker names).
 *
 * Original files are Shift-JIS encoded; translated-full files are UTF-8.
 *
 * Usage:
 *   node validate-translations-full.mjs
 */

import { glob } from "glob";
import { readFile } from "fs/promises";
import path from "path";
import Encoding from "encoding-japanese";

const sjisDecoder = new TextDecoder("shift_jis");

const ORIGINAL_DIR = "original";
const TRANSLATED_FULL_DIR = "translated-full";

const isSpeechSource = (line) => line.startsWith("＃");

/**
 * Read a translated-full file, auto-detecting Shift-JIS or UTF-8.
 */
async function readTranslated(filePath) {
  const raw = await readFile(filePath);
  const detected = Encoding.detect(raw);
  if (detected === "SJIS") {
    return sjisDecoder.decode(raw);
  }
  return raw.toString("utf-8");
}

/**
 * Validate all translated files in the given directory against originals.
 * Returns { checked, skipped, mismatched }.
 */
async function validateDirectory(translatedDir) {
  const translatedFiles = (await glob(`${translatedDir}/*.txt`)).sort();

  let checked = 0;
  let skipped = 0;
  let mismatched = 0;

  for (const translatedPath of translatedFiles) {
    const filename = path.basename(translatedPath);
    const originalPath = path.join(ORIGINAL_DIR, filename);

    let originalText;
    try {
      const raw = await readFile(originalPath);
      originalText = sjisDecoder.decode(raw);
    } catch {
      console.warn(`⚠  No original found for ${filename}, skipping.`);
      skipped++;
      continue;
    }

    const translatedText = await readTranslated(translatedPath);

    const originalLines = originalText.split("\n");
    const translatedLines = translatedText.split("\n");

    if (originalLines.at(-1) === "") originalLines.pop();
    if (translatedLines.at(-1) === "") translatedLines.pop();

    checked++;

    if (originalLines.length !== translatedLines.length) {
      console.log(`\n✗  ${filename}`);
      console.log(
        `   Line count mismatch: original has ${originalLines.length} lines, translated has ${translatedLines.length} lines`,
      );

      const minLen = Math.min(originalLines.length, translatedLines.length);
      for (let i = 0; i < minLen; i++) {
        const origIsSrc = isSpeechSource(originalLines[i]);
        const transIsSrc = isSpeechSource(translatedLines[i]);
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

    const lineMismatches = [];
    for (let i = 0; i < originalLines.length; i++) {
      const origLine = originalLines[i];
      const transLine = translatedLines[i];
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
  console.log(`=== ${TRANSLATED_FULL_DIR}/ ===`);
  const result = await validateDirectory(TRANSLATED_FULL_DIR);

  console.log("\n— Summary —");
  console.log(`  Checked:    ${result.checked} files`);
  console.log(
    `  Skipped:    ${result.skipped} files (untranslated or missing original)`,
  );
  console.log(`  Mismatched: ${result.mismatched} files`);

  if (result.mismatched > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
