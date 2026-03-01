/**
 * Check Translation Coverage & Duplicates
 *
 * Scans through the translated text files in `gemini-translation-text/` and
 * cross-references them against the original script files in `original/`.
 *
 * Each translated text file contains one or more translation entries. An entry
 * is identified by a three-line header:
 *
 *   --------------------       (20 dashes)
 *   {fileName}
 *   ********************       (20 asterisks)
 *
 * Entries are separated by a line of 80 dashes, which is ignored during
 * parsing.
 *
 * Checks performed:
 *   1. Duplicate entries — the same fileName appearing more than once across
 *      all translation files (or within the same file).
 *   2. Missing translations — original script files that have no corresponding
 *      translation entry in any of the text files.
 *
 * Usage:
 *   node check-translations.mjs
 */

import { readFile, readdir } from "fs/promises";
import path from "path";

const TRANSLATION_DIR = "gemini-translation-text";
const ORIGINAL_DIR = "original";

// Entry headers use 20 dashes / 20 asterisks; the separator between entries
// in a single assistant reply is a full line of 80 dashes.
const HEADER_DASHES = "-".repeat(20);
const SEPARATOR_DASHES = "-".repeat(80);
const HEADER_STARS = "*".repeat(20);

/**
 * Parse a single translation text file and return every entry header found.
 * Each entry is identified by the three-line pattern:
 *   HEADER_DASHES → fileName → HEADER_STARS
 */
async function parseTranslationEntries(filePath) {
  const content = await readFile(filePath, "utf-8");
  const lines = content.split("\n");
  const entries = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();

    // Skip the 80-dash separators between assistant replies.
    if (line === SEPARATOR_DASHES) continue;

    // Detect a three-line entry header: 20 dashes, fileName, 20 asterisks.
    if (
      line === HEADER_DASHES &&
      i + 2 < lines.length &&
      lines[i + 2].trimEnd() === HEADER_STARS
    ) {
      const fileName = lines[i + 1].trimEnd();
      // Line numbers are 1-based for human-readable output.
      entries.push({ fileName, line: i + 2 });
      i += 2;
    }
  }

  return entries;
}

async function main() {
  // Step 1: Discover all translation text files and sort them for
  // deterministic processing order.
  const translationFileNames = (await readdir(TRANSLATION_DIR))
    .filter((f) => f.endsWith(".txt"))
    .sort();

  // Step 2: Parse every translation file and build a map from fileName to
  // the list of locations (translation file + line number) where it appears.
  const allEntries = new Map();
  let totalEntries = 0;

  for (const file of translationFileNames) {
    const filePath = path.join(TRANSLATION_DIR, file);
    const entries = await parseTranslationEntries(filePath);
    totalEntries += entries.length;

    for (const entry of entries) {
      if (!allEntries.has(entry.fileName)) {
        allEntries.set(entry.fileName, []);
      }
      allEntries.get(entry.fileName).push({
        translationFile: file,
        line: entry.line,
      });
    }
  }

  console.log(`Total translation entries found: ${totalEntries}`);
  console.log(`Unique file names in translations: ${allEntries.size}`);
  console.log();

  // Step 3: Report any duplicate entries — fileNames that appear more than
  // once, either across different translation files or within the same file.
  console.log("=== DUPLICATE ENTRIES ===");
  let duplicateCount = 0;

  for (const [fileName, locations] of allEntries) {
    if (locations.length > 1) {
      duplicateCount++;
      console.log(`  "${fileName}" appears ${locations.length} times:`);
      for (const loc of locations) {
        console.log(`    - ${loc.translationFile} (line ${loc.line})`);
      }
    }
  }

  if (duplicateCount === 0) {
    console.log("  No duplicates found.");
  } else {
    console.log(`\n  Total duplicated entries: ${duplicateCount}`);
  }
  console.log();

  // Step 4: List all original script files and find any that are missing a
  // corresponding translation entry.
  const originalFileNames = (await readdir(ORIGINAL_DIR))
    .filter((f) => f.endsWith(".txt"))
    .sort();

  const missingFiles = originalFileNames.filter((f) => !allEntries.has(f));

  console.log("=== MISSING TRANSLATIONS ===");
  console.log(`Original files: ${originalFileNames.length}`);
  console.log(`Missing translations: ${missingFiles.length}`);

  if (missingFiles.length > 0) {
    console.log();
    for (const f of missingFiles) {
      console.log(`  - ${f}`);
    }
  }
}

main().catch(console.error);
