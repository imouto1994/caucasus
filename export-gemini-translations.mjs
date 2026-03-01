/**
 * Export Gemini Translation Entries
 *
 * Parses all translated text files in `gemini-translation-text/` and exports
 * each entry as a separate file in `translated/`, named to match the
 * corresponding original script file.
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
const OUTPUT_DIR = "translated";

const HEADER_DASHES = "-".repeat(20);
const SEPARATOR_DASHES = "-".repeat(80);
const HEADER_STARS = "*".repeat(20);

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

  // Step 2: Ensure the output directory exists.
  await mkdir(OUTPUT_DIR, { recursive: true });

  // Step 3: Parse every translation file, detect duplicates, and collect
  // unique entries for export.
  const seen = new Map();
  let duplicateCount = 0;
  let exportedCount = 0;

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

      // Step 4: Write each entry's content to a separate file in the output
      // directory, using the entry's fileName as the output file name.
      const outputPath = path.join(OUTPUT_DIR, entry.fileName);
      await writeFile(outputPath, entry.contentLines.join("\n"), "utf-8");
      exportedCount++;
    }
  }

  // Step 5: Print summary.
  console.log();
  console.log("— Summary —");
  console.log(`  Exported: ${exportedCount} files to ${OUTPUT_DIR}/`);
  if (duplicateCount > 0) {
    console.log(`  Duplicates skipped: ${duplicateCount}`);
  }
}

main().catch(console.error);
