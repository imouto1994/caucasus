/**
 * Check Speech Sources
 *
 * Collects all unique speech source names from the original scripts and from
 * the translated scripts, then compares the two sets.
 *
 * Speech source lines use the fullwidth hash ＃ in both original and
 * translated files. The name is everything after the ＃ prefix.
 *
 * Both `translated/` and `translated-vertical/` are scanned. All files
 * (original and translated) are Shift-JIS encoded and decoded to Unicode.
 *
 * Usage:
 *   node check-speech-sources.mjs
 */

import { readFile, readdir } from "fs/promises";
import path from "path";

const sjisDecoder = new TextDecoder("shift_jis");

const ORIGINAL_DIR = "original";
const TRANSLATED_DIRS = ["translated", "translated-vertical"];

/**
 * Extract unique speech source names from lines of text.
 * `prefix` is the character(s) that mark a speech source line.
 */
function extractSpeechSources(lines, prefix) {
  const sources = new Set();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(prefix)) {
      sources.add(trimmed.slice(prefix.length));
    }
  }
  return sources;
}

async function main() {
  // Step 1: Collect speech sources from all original scripts (Shift-JIS).
  const originalFileNames = (await readdir(ORIGINAL_DIR))
    .filter((f) => f.endsWith(".txt"))
    .sort();

  const originalSources = new Map();

  for (const fileName of originalFileNames) {
    const raw = await readFile(path.join(ORIGINAL_DIR, fileName));
    const text = sjisDecoder.decode(raw);
    const lines = text.split("\n");
    for (const name of extractSpeechSources(lines, "＃")) {
      if (!originalSources.has(name)) {
        originalSources.set(name, new Set());
      }
      originalSources.get(name).add(fileName);
    }
  }

  // Step 2: Collect speech sources from all translated scripts (UTF-8).
  const translatedSources = new Map();

  for (const dir of TRANSLATED_DIRS) {
    let fileNames;
    try {
      fileNames = (await readdir(dir))
        .filter((f) => f.endsWith(".txt"))
        .sort();
    } catch {
      continue;
    }

    for (const fileName of fileNames) {
      const text = sjisDecoder.decode(await readFile(path.join(dir, fileName)));
      const lines = text.split("\n");
      for (const name of extractSpeechSources(lines, "＃")) {
        if (!translatedSources.has(name)) {
          translatedSources.set(name, new Set());
        }
        translatedSources.get(name).add(fileName);
      }
    }
  }

  // Step 3: Print original speech sources sorted by frequency.
  const origByCount = [...originalSources.entries()]
    .map(([name, files]) => ({ name, count: files.size }))
    .sort((a, b) => b.count - a.count);

  console.log(`=== ORIGINAL SPEECH SOURCES (${origByCount.length} unique) ===`);
  for (const { name, count } of origByCount) {
    console.log(`  ${name}  (${count} files)`);
  }

  // Step 4: Print translated speech sources sorted by frequency.
  const transByCount = [...translatedSources.entries()]
    .map(([name, files]) => ({ name, count: files.size }))
    .sort((a, b) => b.count - a.count);

  console.log(
    `\n=== TRANSLATED SPEECH SOURCES (${transByCount.length} unique) ===`,
  );
  for (const { name, count } of transByCount) {
    console.log(`  ${name}  (${count} files)`);
  }

  // Step 5: Print count comparison.
  console.log("\n— Summary —");
  console.log(`  Original unique sources:   ${origByCount.length}`);
  console.log(`  Translated unique sources: ${transByCount.length}`);
}

main().catch(console.error);
