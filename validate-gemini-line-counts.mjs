/**
 * Validate Gemini Translation Line Counts
 *
 * Parses each section in `gemini-translation-text/*.txt` and compares its
 * non-empty line count against the corresponding original script in
 * `original/`. Reports any mismatches so they can be corrected before
 * exporting.
 *
 * Section format in gemini-translation-text files:
 *
 *   --------------------       (20 dashes)
 *   {fileName}
 *   ********************       (20 asterisks)
 *   ...content lines...
 *
 * Sections end at the next header, a separator (80 dashes), or EOF.
 *
 * Usage:
 *   node validate-gemini-line-counts.mjs
 */

import { readFile, readdir } from "fs/promises";
import path from "path";

const INPUT_DIR = "gemini-translation-text";
const ORIGINAL_DIR = "original";

const HEADER_DASHES = "-".repeat(20);
const SEPARATOR_DASHES = "-".repeat(80);
const HEADER_STARS = "*".repeat(20);

const sjisDecoder = new TextDecoder("shift_jis");

/**
 * Parse a single translation text file and return every entry with its
 * fileName, source line number, and content lines.
 */
async function parseTranslationEntries(filePath) {
  const content = await readFile(filePath, "utf-8");
  const lines = content.split("\n");
  const entries = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trimEnd();

    if (line === SEPARATOR_DASHES) {
      i++;
      continue;
    }

    if (
      line === HEADER_DASHES &&
      i + 2 < lines.length &&
      lines[i + 2].trimEnd() === HEADER_STARS
    ) {
      const fileName = lines[i + 1].trimEnd();
      const headerLineNum = i + 1;
      i += 3;

      const contentLines = [];
      while (i < lines.length) {
        const current = lines[i].trimEnd();
        if (current === HEADER_DASHES || current === SEPARATOR_DASHES) break;
        contentLines.push(current);
        i++;
      }

      entries.push({ fileName, headerLineNum, contentLines });
    } else {
      i++;
    }
  }

  return entries;
}

/**
 * Read an original Shift-JIS file and return its non-empty lines.
 */
async function readOriginalLines(filePath) {
  const raw = await readFile(filePath);
  const text = sjisDecoder.decode(raw);
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.filter((l) => l.trim().length > 0);
}

const isSpeechSource = (line) =>
  line.startsWith("＃") || line.startsWith("#");

/**
 * Classify a line as "speech" or "content" for comparison purposes.
 */
function lineType(line) {
  return isSpeechSource(line) ? "speech" : "content";
}

/**
 * Walk original and translated lines in parallel and find the first position
 * where their line types (speech source vs content) diverge.
 * Returns a description object or null if types align perfectly.
 */
function findFirstTypeMismatch(originalLines, translatedLines) {
  const maxLen = Math.max(originalLines.length, translatedLines.length);

  for (let i = 0; i < maxLen; i++) {
    const origLine = i < originalLines.length ? originalLines[i] : null;
    const transLine = i < translatedLines.length ? translatedLines[i] : null;

    if (origLine === null) {
      return {
        index: i,
        reason: "extra translated line",
        transLine,
        transType: lineType(transLine),
      };
    }
    if (transLine === null) {
      return {
        index: i,
        reason: "missing translated line",
        origLine,
        origType: lineType(origLine),
      };
    }

    if (lineType(origLine) !== lineType(transLine)) {
      return {
        index: i,
        reason: "type mismatch",
        origLine,
        origType: lineType(origLine),
        transLine,
        transType: lineType(transLine),
      };
    }
  }

  return null;
}

async function main() {
  const translationFiles = (await readdir(INPUT_DIR))
    .filter((f) => f.endsWith(".txt"))
    .sort();

  let totalSections = 0;
  let mismatched = 0;
  let missingOriginals = 0;

  for (const file of translationFiles) {
    const filePath = path.join(INPUT_DIR, file);
    const entries = await parseTranslationEntries(filePath);

    for (const entry of entries) {
      totalSections++;

      const originalPath = path.join(ORIGINAL_DIR, entry.fileName);
      let originalLines;
      try {
        originalLines = await readOriginalLines(originalPath);
      } catch {
        missingOriginals++;
        continue;
      }

      const translatedLines = entry.contentLines.filter(
        (l) => l.trim().length > 0,
      );

      if (originalLines.length !== translatedLines.length) {
        mismatched++;
        const diff = translatedLines.length - originalLines.length;
        console.log(
          `\n${file} → ${entry.fileName} (line ${entry.headerLineNum}): ` +
            `original ${originalLines.length} lines, ` +
            `translated ${translatedLines.length} lines ` +
            `(diff ${diff > 0 ? "+" : ""}${diff})`,
        );

        const mismatch = findFirstTypeMismatch(originalLines, translatedLines);
        if (mismatch) {
          const pos = mismatch.index + 1;
          if (mismatch.reason === "type mismatch") {
            console.log(`  First type mismatch at line ${pos}:`);
            console.log(
              `    original   [${mismatch.origType}]: ${mismatch.origLine}`,
            );
            console.log(
              `    translated [${mismatch.transType}]: ${mismatch.transLine}`,
            );
          } else if (mismatch.reason === "missing translated line") {
            console.log(`  Missing translated line at position ${pos}:`);
            console.log(
              `    original [${mismatch.origType}]: ${mismatch.origLine}`,
            );
          } else if (mismatch.reason === "extra translated line") {
            console.log(`  Extra translated line at position ${pos}:`);
            console.log(
              `    translated [${mismatch.transType}]: ${mismatch.transLine}`,
            );
          }
        } else {
          console.log(
            "  Line types all match — difference is at the end of the file.",
          );
        }
      }
    }
  }

  console.log();
  console.log("— Summary —");
  console.log(`  Total sections:    ${totalSections}`);
  console.log(`  Mismatched:        ${mismatched}`);
  if (missingOriginals > 0) {
    console.log(`  Missing originals: ${missingOriginals}`);
  }

  if (mismatched > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
