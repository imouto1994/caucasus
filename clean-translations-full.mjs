/**
 * Clean Up Full Translated Scripts (UTF-8)
 *
 * Processes every .txt file in `translated-full/` to normalise formatting.
 * This is the UTF-8 counterpart of `clean-translations.mjs` — the logic is
 * identical but the output is written as UTF-8 instead of Shift-JIS, and
 * the Shift-JIS-unsafe character replacements are skipped since UTF-8 can
 * represent all Unicode characters.
 *
 * Steps:
 *   1. Remove all empty lines.
 *   2. Trim leading and trailing whitespace from each line.
 *   3. Convert single-quote-wrapped speech lines ('...') to unwrapped text
 *      as an intermediate step. Only the outermost quotes are removed;
 *      internal apostrophes (e.g. Man's) are left untouched.
 *   4. Convert ASCII hash (#) speech source prefixes to fullwidth hash (＃)
 *      as an intermediate normalisation step.
 *   5. Replace each speech source line (＃...) with the corresponding line
 *      from the original script, restoring the Japanese speaker name.
 *   6. Strip wrapping brackets/quotes from speech content lines (the line
 *      immediately after a ＃ speech source line). Handles 「」, 『』, and
 *      "..." wrappers.
 *   7. For non-speech-content lines, replace Japanese brackets (「」/『』)
 *      with double quotes ("").
 *   8. Append a trailing empty line if the corresponding original file in
 *      `original/` also ends with one.
 *   9. Encode the output as UTF-8.
 *
 * Files are overwritten in place.
 *
 * Usage:
 *   node clean-translations-full.mjs
 */

import { readFile, readdir, writeFile } from "fs/promises";
import path from "path";
import Encoding from "encoding-japanese";

const ORIGINAL_DIR = "original";
const DIRS = ["translated-full"];

const sjisDecoder = new TextDecoder("shift_jis");

/**
 * Read the original file and return its decoded content lines and raw buffer
 * (for trailing-newline detection). Returns null if the original does not
 * exist.
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
 * Read a translated file, decoding from either Shift-JIS or UTF-8 depending
 * on the detected encoding.
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
 * Strip wrapping brackets or quotes from a speech content line.
 * Handles 「...」, 『...』, and "...".
 */
function stripSpeechWrappers(line) {
  if (line.startsWith("「") && line.endsWith("」")) return line.slice(1, -1);
  if (line.startsWith("『") && line.endsWith("』")) return line.slice(1, -1);
  if (line.startsWith('"') && line.endsWith('"') && line.length >= 2)
    return line.slice(1, -1);
  if (line.startsWith("'") && line.endsWith("'") && line.length >= 2)
    return line.slice(1, -1);
  return line;
}

/**
 * Clean a single file against its original. Returns true if modified.
 */
async function cleanFile(filePath, originalPath) {
  const content = await readTranslated(filePath);
  const lines = content.split("\n");

  let cleaned = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      if (line.startsWith("#") && line.length > 1) {
        return `＃${line.slice(1)}`;
      }
      return line;
    });

  const original = await readOriginal(originalPath);

  if (original) {
    const minLen = Math.min(cleaned.length, original.lines.length);
    for (let i = 0; i < minLen; i++) {
      if (cleaned[i].startsWith("＃")) {
        cleaned[i] = original.lines[i].trim();
      }
      if (cleaned[i].startsWith("＃") && i + 1 < minLen) {
        cleaned[i + 1] = stripSpeechWrappers(cleaned[i + 1]);
      }
    }
  } else {
    for (let i = 0; i < cleaned.length; i++) {
      if (cleaned[i].startsWith("＃") && i + 1 < cleaned.length) {
        cleaned[i + 1] = stripSpeechWrappers(cleaned[i + 1]);
      }
    }
  }

  for (let i = 0; i < cleaned.length; i++) {
    const isSpeechContent = i > 0 && cleaned[i - 1].startsWith("＃");
    if (isSpeechContent) continue;

    const line = cleaned[i];
    if (line.startsWith("「") && line.endsWith("」")) {
      cleaned[i] = `"${line.slice(1, -1)}"`;
    } else if (line.startsWith("『") && line.endsWith("』")) {
      cleaned[i] = `"${line.slice(1, -1)}"`;
    }
  }

  let result = cleaned.join("\n");

  if (
    original &&
    original.raw.length > 0 &&
    original.raw[original.raw.length - 1] === 0x0a
  ) {
    result += "\n";
  }

  const existingRaw = await readFile(filePath);
  const resultBuf = Buffer.from(result, "utf-8");
  if (Buffer.compare(resultBuf, existingRaw) === 0) return false;

  await writeFile(filePath, result, "utf-8");
  return true;
}

async function main() {
  let totalFiles = 0;
  let modifiedFiles = 0;

  for (const dir of DIRS) {
    let fileNames;
    try {
      fileNames = (await readdir(dir)).filter((f) => f.endsWith(".txt")).sort();
    } catch {
      console.log(`Directory ${dir}/ not found, skipping.`);
      continue;
    }

    console.log(`Processing ${dir}/ (${fileNames.length} files)...`);

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

  console.log();
  console.log("— Summary —");
  console.log(`  Total files scanned: ${totalFiles}`);
  console.log(`  Files modified:      ${modifiedFiles}`);
}

main().catch(console.error);
