/**
 * Export Gemini Translation Entries
 *
 * Parses all translated text files in `gemini-translation-text/` and exports
 * each entry as a separate Shift-JIS file, named to match the corresponding
 * original script file.
 *
 * Files are routed to one of five output directories:
 *
 *   - `translated/`            — normal (horizontal) scripts
 *   - `translated-vertical/`   — vertical-style scripts (every non-empty line
 *                                 in the original starts with a fullwidth space
 *                                 or left corner bracket)
 *   - `translated-inspection/` — inspection scripts (filenames matching
 *                                 [A-Z][0-9][0-9]_[0-9][0-9]s.txt)
 *   - `translated-question/`    — question scripts (filenames matching
 *                                 [A-Z][0-9][0-9]_[a-z][0-9][0-9][0-9].txt)
 *   - `translated-exploration/` — exploration scripts (remaining filenames
 *                                 starting with [A-Z][0-9][0-9]_)
 *
 * Each translated text file contains one or more entries delimited by a
 * three-line header:
 *
 *   --------------------       (20 dashes)
 *   {fileName}
 *   ********************       (20 asterisks)
 *
 * The content lines of an entry span from the line after the header until the
 * next entry header, a separator line (80 dashes), or end-of-file.
 *
 * If a fileName appears more than once across all translation files, a warning
 * is printed and only the first occurrence is kept.
 *
 * Usage:
 *   node export-gemini-translations.mjs
 */

import { readFile, readdir, writeFile, mkdir } from "fs/promises";
import path from "path";
import Encoding from "encoding-japanese";

const INPUT_DIR = "gemini-translation-text";
const ORIGINAL_DIR = "original";
const OUTPUT_DIR = "translated";
const OUTPUT_VERTICAL_DIR = "translated-vertical";
const OUTPUT_INSPECTION_DIR = "translated-inspection";
const OUTPUT_QUESTION_DIR = "translated-question";
const OUTPUT_EXPLORATION_DIR = "translated-exploration";

const INSPECTION_RE = /^[A-Z]\d{2}_\d{2}s\.txt$/;
const QUESTION_RE = /^[A-Z]\d{2}_[a-z]\d{3}\.txt$/;
const EXPLORATION_RE = /^[A-Z]\d{2}_/;

// Unicode characters that have no Shift-JIS representation → safe replacements.
const CHAR_REPLACEMENTS = new Map([
  ["\u2014", "-"], // — (em dash) → ― (horizontal bar)
  ["\u00B7", "."], // · (middle dot) → ・ (katakana middle dot)
  ["\u00E9", "e"], // é (e-acute) → e
]);

/**
 * Encode a Unicode string to a Shift-JIS Buffer, replacing characters that
 * cannot be represented in Shift-JIS first.
 */
function encodeShiftJIS(str) {
  let safe = str;
  for (const [from, to] of CHAR_REPLACEMENTS) {
    safe = safe.replaceAll(from, to);
  }
  const codeArray = Encoding.convert(Encoding.stringToCode(safe), {
    to: "SJIS",
    from: "UNICODE",
  });
  return Buffer.from(codeArray);
}

const HEADER_DASHES = "-".repeat(20);
const SEPARATOR_DASHES = "-".repeat(80);
const HEADER_STARS = "*".repeat(20);

const sjisDecoder = new TextDecoder("shift_jis");

/**
 * Returns true when every non-empty line in the Shift-JIS buffer starts with
 * either a fullwidth space (U+3000) or a left corner bracket (「, U+300C).
 */
function isVertical(buf) {
  const text = sjisDecoder.decode(buf);
  const lines = text.split("\n");
  let hasContent = false;

  for (const raw of lines) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.length === 0) continue;

    hasContent = true;
    const first = line[0];
    if (first !== "\u3000" && first !== "\u300C") return false;
  }

  return hasContent;
}

/**
 * Parse a single translation text file and return every entry with its
 * fileName and content lines.
 *
 * An entry's content spans from the line after its "********************"
 * header until the next header, a separator, or end-of-file.
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
      const headerLine = i + 2;
      i += 3;

      const contentLines = [];
      while (i < lines.length) {
        const current = lines[i].trimEnd();
        if (current === HEADER_DASHES || current === SEPARATOR_DASHES) break;
        contentLines.push(current);
        i++;
      }

      entries.push({ fileName, headerLine, contentLines });
    } else {
      i++;
    }
  }

  return entries;
}

async function main() {
  // Step 1: Discover and sort all translation text files.
  const translationFileNames = (await readdir(INPUT_DIR))
    .filter((f) => f.endsWith(".txt"))
    .sort();

  // Step 2: Ensure all output directories exist.
  await mkdir(OUTPUT_DIR, { recursive: true });
  await mkdir(OUTPUT_VERTICAL_DIR, { recursive: true });
  await mkdir(OUTPUT_INSPECTION_DIR, { recursive: true });
  await mkdir(OUTPUT_QUESTION_DIR, { recursive: true });
  await mkdir(OUTPUT_EXPLORATION_DIR, { recursive: true });

  // Step 3: Build a set of vertical-style original filenames by reading each
  // original as raw Shift-JIS bytes and checking the line-starter pattern.
  const originalFileNames = await readdir(ORIGINAL_DIR);
  const verticalFiles = new Set();

  for (const filename of originalFileNames) {
    const buf = await readFile(path.join(ORIGINAL_DIR, filename));
    if (isVertical(buf)) {
      verticalFiles.add(filename);
    }
  }

  // Step 4: Parse every translation file, detect duplicates, and export
  // each unique entry to the appropriate output directory.
  const seen = new Map();
  let duplicateCount = 0;
  let exportedCount = 0;
  let exportedVerticalCount = 0;
  let exportedInspectionCount = 0;
  let exportedQuestionCount = 0;
  let exportedExplorationCount = 0;

  for (const file of translationFileNames) {
    const filePath = path.join(INPUT_DIR, file);
    const entries = await parseTranslationEntries(filePath);

    for (const entry of entries) {
      if (seen.has(entry.fileName)) {
        duplicateCount++;
        const prev = seen.get(entry.fileName);
        console.warn(
          `  ⚠  Duplicate "${entry.fileName}" — ` +
            `keeping ${prev.sourceFile} line ${prev.headerLine}, ` +
            `skipping ${file} line ${entry.headerLine}`
        );
        continue;
      }

      seen.set(entry.fileName, {
        sourceFile: file,
        headerLine: entry.headerLine,
      });

      // Route to the appropriate output directory.
      const outDir = INSPECTION_RE.test(entry.fileName)
        ? OUTPUT_INSPECTION_DIR
        : QUESTION_RE.test(entry.fileName)
          ? OUTPUT_QUESTION_DIR
          : EXPLORATION_RE.test(entry.fileName)
            ? OUTPUT_EXPLORATION_DIR
            : verticalFiles.has(entry.fileName)
              ? OUTPUT_VERTICAL_DIR
              : OUTPUT_DIR;

      const outputPath = path.join(outDir, entry.fileName);
      await writeFile(
        outputPath,
        encodeShiftJIS(entry.contentLines.join("\n"))
      );

      if (outDir === OUTPUT_INSPECTION_DIR) {
        exportedInspectionCount++;
      } else if (outDir === OUTPUT_QUESTION_DIR) {
        exportedQuestionCount++;
      } else if (outDir === OUTPUT_EXPLORATION_DIR) {
        exportedExplorationCount++;
      } else if (outDir === OUTPUT_VERTICAL_DIR) {
        exportedVerticalCount++;
      } else {
        exportedCount++;
      }
    }
  }

  // Step 5: Print summary.
  console.log();
  console.log("— Summary —");
  console.log(`  Exported: ${exportedCount} files to ${OUTPUT_DIR}/`);
  console.log(
    `  Exported: ${exportedVerticalCount} files to ${OUTPUT_VERTICAL_DIR}/`
  );
  console.log(
    `  Exported: ${exportedInspectionCount} files to ${OUTPUT_INSPECTION_DIR}/`
  );
  console.log(
    `  Exported: ${exportedQuestionCount} files to ${OUTPUT_QUESTION_DIR}/`
  );
  console.log(
    `  Exported: ${exportedExplorationCount} files to ${OUTPUT_EXPLORATION_DIR}/`
  );
  if (duplicateCount > 0) {
    console.log(`  Duplicates skipped: ${duplicateCount}`);
  }
}

main().catch(console.error);
