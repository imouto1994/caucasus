/**
 * Clean Up Translated Scripts
 *
 * Processes every .txt file in `translated/` and `translated-vertical/` to
 * normalise formatting:
 *
 *   1. Remove all empty lines.
 *   2. Trim leading and trailing whitespace from each line.
 *   3. Convert single-quote-wrapped speech lines ('...') to double-quote
 *      ("..."). Only the outermost quotes are replaced; internal apostrophes
 *      (e.g. "Man's") are left untouched.
 *   4. Convert ASCII hash (#) speech source prefixes to fullwidth hash (＃)
 *      to match the original script formatting.
 *   5. Append a trailing empty line if the corresponding original file in
 *      `original/` also ends with one.
 *
 * Files are overwritten in place.
 *
 * Usage:
 *   node clean-translations.mjs
 */

import { readFile, readdir, writeFile } from "fs/promises";
import path from "path";

const ORIGINAL_DIR = "original";
const DIRS = ["translated", "translated-vertical"];

/**
 * Clean a single file: trim lines, drop empties, fix quote wrapping, fix
 * speech source prefix, and match the original's trailing newline.
 * Returns true if the file was modified.
 */
async function cleanFile(filePath, originalPath) {
  const content = await readFile(filePath, "utf-8");
  const lines = content.split("\n");

  const cleaned = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      // Convert single-quote-wrapped speech lines to double-quote.
      if (line.startsWith("'") && line.endsWith("'") && line.length >= 2) {
        return `"${line.slice(1, -1)}"`;
      }
      // Convert ASCII hash speech source prefix to fullwidth hash.
      if (line.startsWith("#") && line.length > 1) {
        return `＃${line.slice(1)}`;
      }
      return line;
    });

  let result = cleaned.join("\n");

  // Match the original file's trailing newline: if the original ends with
  // a newline, ensure the translated file does too.
  try {
    const originalContent = await readFile(originalPath);
    if (originalContent.length > 0 && originalContent[originalContent.length - 1] === 0x0a) {
      result += "\n";
    }
  } catch {
    // No corresponding original — leave as-is.
  }

  if (result === content) return false;

  await writeFile(filePath, result, "utf-8");
  return true;
}

async function main() {
  let totalFiles = 0;
  let modifiedFiles = 0;

  for (const dir of DIRS) {
    // Step 1: Discover all .txt files in the directory.
    let fileNames;
    try {
      fileNames = (await readdir(dir))
        .filter((f) => f.endsWith(".txt"))
        .sort();
    } catch {
      console.log(`Directory ${dir}/ not found, skipping.`);
      continue;
    }

    console.log(`Processing ${dir}/ (${fileNames.length} files)...`);

    // Step 2: Clean each file in place.
    for (const fileName of fileNames) {
      const filePath = path.join(dir, fileName);
      const originalPath = path.join(ORIGINAL_DIR, fileName);
      const modified = await cleanFile(filePath, originalPath);
      totalFiles++;
      if (modified) {
        modifiedFiles++;
      }
    }
  }

  // Step 3: Print summary.
  console.log();
  console.log("— Summary —");
  console.log(`  Total files scanned: ${totalFiles}`);
  console.log(`  Files modified:      ${modifiedFiles}`);
}

main().catch(console.error);
