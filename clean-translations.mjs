/**
 * Clean Up Translated Scripts
 *
 * Processes every .txt file in `translated/` and `translated-vertical/` to
 * normalise formatting:
 *
 *   1. Remove all empty lines.
 *   2. Trim leading and trailing whitespace from each line.
 *   3. Convert single-quote-wrapped speech lines ('...') to double-quote
 *      ("...") as an intermediate step. Only the outermost quotes are
 *      replaced; internal apostrophes (e.g. "Man's") are left untouched.
 *   4. Convert ASCII hash (#) speech source prefixes to fullwidth hash (＃)
 *      to match the original script formatting.
 *   5. Convert double-quote-wrapped speech content ("...") to the bracket
 *      style used by the corresponding line in the original script —
 *      either 「...」 or 『...』.
 *   6. Append a trailing empty line if the corresponding original file in
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

const sjisDecoder = new TextDecoder("shift_jis");

/**
 * Read the original file and return its non-empty content lines and raw
 * buffer (for trailing-newline detection). Returns null if the original
 * does not exist.
 */
async function readOriginal(originalPath) {
  try {
    const raw = await readFile(originalPath);
    const text = sjisDecoder.decode(raw);
    const lines = text.split("\n");
    if (lines.at(-1) === "") lines.pop();
    return { lines, raw };
  } catch {
    return null;
  }
}

/**
 * Determine the bracket pair used by an original line's speech content.
 * Returns the [open, close] pair, or null if the line isn't speech content.
 */
function getOriginalBrackets(origLine) {
  const trimmed = origLine.trim();
  if (trimmed.startsWith("「") && trimmed.endsWith("」")) return ["「", "」"];
  if (trimmed.startsWith("『") && trimmed.endsWith("』")) return ["『", "』"];
  return null;
}

/**
 * Clean a single file against its original. Returns true if modified.
 */
async function cleanFile(filePath, originalPath) {
  const content = await readFile(filePath, "utf-8");
  const lines = content.split("\n");

  // Steps 1–4: trim, drop empties, fix quotes, fix speech source prefix.
  let cleaned = lines
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

  const original = await readOriginal(originalPath);

  // Step 5: Convert "..." speech content to the bracket style used in the
  // original. We walk both arrays in parallel; if sizes differ we still
  // convert what we can up to the shorter length.
  if (original) {
    const minLen = Math.min(cleaned.length, original.lines.length);
    for (let i = 0; i < minLen; i++) {
      const line = cleaned[i];
      if (line.startsWith('"') && line.endsWith('"') && line.length >= 2) {
        const brackets = getOriginalBrackets(original.lines[i]);
        if (brackets) {
          cleaned[i] = `${brackets[0]}${line.slice(1, -1)}${brackets[1]}`;
        }
      }
    }
  }

  let result = cleaned.join("\n");

  // Step 6: Match the original file's trailing newline.
  if (original) {
    const raw = original.raw;
    if (raw.length > 0 && raw[raw.length - 1] === 0x0a) {
      result += "\n";
    }
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
