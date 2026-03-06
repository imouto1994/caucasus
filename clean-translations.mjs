/**
 * Clean Up Translated Scripts
 *
 * Processes every .txt file in `translated/` and `translated-vertical/` to
 * normalise formatting:
 *
 *   1. Remove all empty lines.
 *   2. Trim leading and trailing whitespace from each line.
 *   3. Convert single-quote-wrapped speech lines ('...') to unwrapped text
 *      as an intermediate step. Only the outermost quotes are removed;
 *      internal apostrophes (e.g. Man's) are left untouched.
 *   4. Convert ASCII hash (#) speech source prefixes to fullwidth hash (＃)
 *      to match the original script formatting.
 *   5. Strip wrapping brackets/quotes from speech content lines (the line
 *      immediately after a ＃ speech source line). Handles 「」, 『』, and
 *      "..." wrappers. The game engine renders these automatically.
 *   6. Append a trailing empty line if the corresponding original file in
 *      `original/` also ends with one.
 *   7. Encode the output as Shift-JIS to match the original script encoding.
 *
 * Files are overwritten in place.
 *
 * Usage:
 *   node clean-translations.mjs
 */

import { readFile, readdir, writeFile } from "fs/promises";
import path from "path";
import Encoding from "encoding-japanese";

const ORIGINAL_DIR = "original";
const DIRS = ["translated", "translated-vertical"];

const sjisDecoder = new TextDecoder("shift_jis");

/**
 * Encode a Unicode string to a Shift-JIS Buffer.
 */
function encodeShiftJIS(str) {
  const codeArray = Encoding.convert(Encoding.stringToCode(str), {
    to: "SJIS",
    from: "UNICODE",
  });
  return Buffer.from(codeArray);
}

/**
 * Read the original file and return its raw buffer for trailing-newline
 * detection. Returns null if the original does not exist.
 */
async function readOriginal(originalPath) {
  try {
    return await readFile(originalPath);
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
  if (line.startsWith('"') && line.endsWith('"') && line.length >= 2) return line.slice(1, -1);
  if (line.startsWith("'") && line.endsWith("'") && line.length >= 2) return line.slice(1, -1);
  return line;
}

/**
 * Clean a single file against its original. Returns true if modified.
 */
async function cleanFile(filePath, originalPath) {
  const content = await readTranslated(filePath);
  const lines = content.split("\n");

  // Steps 1–4: trim, drop empties, fix speech source prefix.
  let cleaned = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      // Convert ASCII hash speech source prefix to fullwidth hash.
      if (line.startsWith("#") && line.length > 1) {
        return `＃${line.slice(1)}`;
      }
      return line;
    });

  // Step 5: Strip wrapping brackets/quotes from speech content lines.
  // A speech content line is the line immediately after a ＃ source line.
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i].startsWith("＃") && i + 1 < cleaned.length) {
      cleaned[i + 1] = stripSpeechWrappers(cleaned[i + 1]);
    }
  }

  let result = cleaned.join("\n");

  // Step 6: Match the original file's trailing newline.
  const originalRaw = await readOriginal(originalPath);
  if (originalRaw && originalRaw.length > 0 && originalRaw[originalRaw.length - 1] === 0x0a) {
    result += "\n";
  }

  // Step 7: Encode as Shift-JIS and write.
  const encoded = encodeShiftJIS(result);

  const existingRaw = await readFile(filePath);
  if (Buffer.compare(encoded, existingRaw) === 0) return false;

  await writeFile(filePath, encoded);
  return true;
}

async function main() {
  let totalFiles = 0;
  let modifiedFiles = 0;

  for (const dir of DIRS) {
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
