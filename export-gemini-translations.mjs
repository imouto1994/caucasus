/**
 * Export Gemini Translation Entries
 *
 * Parses all translated text files in `gemini-translation-text/` and exports
 * each entry as a separate file, named to match the corresponding original
 * script file.
 *
 * Files are routed to one of two output directories based on whether their
 * original is a vertical-style (tategumi) script:
 *
 *   - `translated/`          — normal (horizontal) scripts
 *   - `translated-vertical/` — vertical-style scripts (every non-empty line
 *                               in the original starts with a fullwidth space
 *                               or left corner bracket in Shift-JIS)
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

const INPUT_DIR = "gemini-translation-text";
const ORIGINAL_DIR = "original";
const OUTPUT_DIR = "translated";
const OUTPUT_VERTICAL_DIR = "translated-vertical";

const HEADER_DASHES = "-".repeat(20);
const SEPARATOR_DASHES = "-".repeat(80);
const HEADER_STARS = "*".repeat(20);

// Both vertical-style line starters share the Shift-JIS lead byte 0x81.
const SJIS_LEAD_BYTE = 0x81;
// 　 (fullwidth space, U+3000) → 0x81 0x40
const SJIS_FULLWIDTH_SPACE = 0x40;
// 「 (left corner bracket, U+300C) → 0x81 0x75
const SJIS_LEFT_CORNER_BRACKET = 0x75;

/**
 * Returns true when every non-empty line in the buffer starts with the
 * Shift-JIS encoding of either 　 (0x81 0x40) or 「 (0x81 0x75).
 */
function isVertical(buf) {
  let pos = 0;
  let hasContent = false;

  while (pos < buf.length) {
    let end = buf.indexOf(0x0a, pos);
    if (end === -1) end = buf.length;

    const lineEnd = end > pos && buf[end - 1] === 0x0d ? end - 1 : end;
    const lineLen = lineEnd - pos;

    if (lineLen > 0) {
      hasContent = true;
      if (
        lineLen < 2 ||
        buf[pos] !== SJIS_LEAD_BYTE ||
        (buf[pos + 1] !== SJIS_FULLWIDTH_SPACE &&
          buf[pos + 1] !== SJIS_LEFT_CORNER_BRACKET)
      ) {
        return false;
      }
    }

    pos = end + 1;
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

    // Skip 80-dash separators between assistant replies.
    if (line === SEPARATOR_DASHES) {
      i++;
      continue;
    }

    // Detect a three-line entry header: 20 dashes, fileName, 20 asterisks.
    if (
      line === HEADER_DASHES &&
      i + 2 < lines.length &&
      lines[i + 2].trimEnd() === HEADER_STARS
    ) {
      const fileName = lines[i + 1].trimEnd();
      const headerLine = i + 2;
      i += 3;

      // Collect content lines until the next header, separator, or EOF.
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

  // Step 2: Ensure both output directories exist.
  await mkdir(OUTPUT_DIR, { recursive: true });
  await mkdir(OUTPUT_VERTICAL_DIR, { recursive: true });

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
            `skipping ${file} line ${entry.headerLine}`,
        );
        continue;
      }

      seen.set(entry.fileName, {
        sourceFile: file,
        headerLine: entry.headerLine,
      });

      // Route to the vertical output directory if the original is vertical.
      const outDir = verticalFiles.has(entry.fileName)
        ? OUTPUT_VERTICAL_DIR
        : OUTPUT_DIR;

      const outputPath = path.join(outDir, entry.fileName);
      await writeFile(outputPath, entry.contentLines.join("\n"), "utf-8");

      if (outDir === OUTPUT_VERTICAL_DIR) {
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
  console.log(`  Exported: ${exportedVerticalCount} files to ${OUTPUT_VERTICAL_DIR}/`);
  if (duplicateCount > 0) {
    console.log(`  Duplicates skipped: ${duplicateCount}`);
  }
}

main().catch(console.error);
