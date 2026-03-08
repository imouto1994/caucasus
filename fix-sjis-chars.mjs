/**
 * Fix Characters Lost in Shift-JIS Encoding
 *
 * Some Unicode characters have no Shift-JIS representation and were silently
 * converted to '?' during encoding. This script restores them by comparing
 * each translated file against the original UTF-8 entry from
 * `gemini-translation-text/`.
 *
 * Characters fixed:
 *   — (U+2014 em dash)    → ― (U+2015 horizontal bar)
 *   · (U+00B7 middle dot) → ・ (U+30FB katakana middle dot)
 *   é (U+00E9 e-acute)    → e
 *
 * For each line, if the UTF-8 source has N occurrences of these characters
 * and the translated line has N extra '?' compared to the source's real '?'
 * count, we walk both strings and replace each corrupted '?' with the
 * appropriate Shift-JIS-safe character.
 *
 * Lines that were paraphrased (e.g. long line fixes) can't be matched
 * positionally, so we fall back to replacing all '?' that don't appear in
 * the source.
 *
 * Usage:
 *   node fix-sjis-chars.mjs
 */

import { readFile, readdir, writeFile } from "fs/promises";
import path from "path";
import Encoding from "encoding-japanese";

const TRANSLATION_TEXT_DIR = "gemini-translation-text";
const ORIGINAL_DIR = "original";
const TRANSLATED_DIRS = ["translated", "translated-inspection", "translated-question", "translated-vertical"];

const sjisDecoder = new TextDecoder("shift_jis");

// Characters that get corrupted to '?' in Shift-JIS, and their safe replacements.
const UNSAFE_CHARS = new Map([
  ["\u2014", "-"], // — → ―
  ["\u00B7", "."], // · → ・
  ["\u00E9", "e"], // é → e
]);

const HEADER_DASHES = "-".repeat(20);
const SEPARATOR_DASHES = "-".repeat(80);
const HEADER_STARS = "*".repeat(20);

function encodeShiftJIS(str) {
  const codeArray = Encoding.convert(Encoding.stringToCode(str), {
    to: "SJIS",
    from: "UNICODE",
  });
  return Buffer.from(codeArray);
}

/**
 * Replace unsafe Unicode characters with Shift-JIS-safe equivalents.
 */
function replaceUnsafe(str) {
  let result = str;
  for (const [from, to] of UNSAFE_CHARS) {
    result = result.replaceAll(from, to);
  }
  return result;
}

/**
 * Check if a character is one of the unsafe chars.
 */
function isUnsafeChar(ch) {
  return UNSAFE_CHARS.has(ch);
}

/**
 * Get the safe replacement for an unsafe char.
 */
function safeReplacement(ch) {
  return UNSAFE_CHARS.get(ch) ?? ch;
}

/**
 * Fix a translated line by comparing against its UTF-8 source.
 *
 * First filters out paraphrased lines using count-based checks. For lines
 * where the counts match, walks both strings character-by-character to
 * replace corrupted '?' at the exact positions where the source had unsafe
 * chars.
 */
function fixLine(translatedLine, sourceLine) {
  // Quick check: does the source even have unsafe chars?
  let unsafeCount = 0;
  for (const ch of sourceLine) {
    if (isUnsafeChar(ch)) unsafeCount++;
  }
  if (unsafeCount === 0) return { text: translatedLine };

  const sourceClean = replaceUnsafe(sourceLine);

  // Strip wrappers from source to match the translated format.
  let sourceUnwrapped = sourceClean;
  if (
    (sourceClean.startsWith("「") && sourceClean.endsWith("」")) ||
    (sourceClean.startsWith("『") && sourceClean.endsWith("』")) ||
    (sourceClean.startsWith('"') && sourceClean.endsWith('"'))
  ) {
    sourceUnwrapped = sourceClean.slice(1, -1);
  }

  // Already matches — no fix needed.
  if (sourceUnwrapped === translatedLine) return { text: translatedLine };

  // Count '?' in both to detect paraphrased lines.
  const sourceQCount = (sourceLine.match(/\?/g) || []).length;
  const transQCount = (translatedLine.match(/\?/g) || []).length;
  const corruptedCount = transQCount - sourceQCount;

  // No extra '?' — the unsafe chars were removed during paraphrasing.
  if (corruptedCount <= 0) return { text: translatedLine };

  // Counts don't add up — line was paraphrased
  // and the number of corrupted '?' doesn't match with the number of unsafe chars.
  if (corruptedCount !== unsafeCount) {
    return { text: translatedLine, unreliable: true };
  }

  // Build an ordered queue of what each '?' in the translated line should
  // become, based on the order of unsafe chars and real '?' in the source.
  // E.g. source "—!?" → queue: ['―', '?'] (unsafe first, then real '?').
  const queue = [];
  for (const ch of sourceLine) {
    if (isUnsafeChar(ch)) queue.push(safeReplacement(ch));
    else if (ch === "?") queue.push("?");
  }

  // Apply the queue to each '?' in the translated line in order.
  let qi = 0;
  const result = [];
  for (const ch of translatedLine) {
    if (ch === "?" && qi < queue.length) {
      result.push(queue[qi]);
      qi++;
    } else {
      result.push(ch);
    }
  }

  const fixed = result.join("");
  if (fixed === translatedLine) return { text: translatedLine };

  // Flag lines that have both real '?' and unsafe chars in the source,
  // so the user can double-check the ordering is correct.
  const mixed = sourceQCount > 0 && unsafeCount > 0;
  return { text: fixed, mixed: mixed || undefined };
}

/**
 * Parse all gemini translation entries into a map: fileName → content lines.
 */
async function loadGeminiEntries() {
  const files = (await readdir(TRANSLATION_TEXT_DIR))
    .filter((f) => f.endsWith(".txt"))
    .sort();

  const entries = new Map();

  for (const file of files) {
    const content = await readFile(
      path.join(TRANSLATION_TEXT_DIR, file),
      "utf-8"
    );
    const lines = content.split("\n");

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
        i += 3;

        const contentLines = [];
        while (i < lines.length) {
          const current = lines[i].trimEnd();
          if (current === HEADER_DASHES || current === SEPARATOR_DASHES) break;
          contentLines.push(current);
          i++;
        }

        // Filter out empty lines to match the translated files, which have
        // had empty lines stripped by clean-translations.mjs.
        const nonEmptyLines = contentLines.filter((l) => l.trim().length > 0);

        // Keep first occurrence only (no duplicates).
        if (!entries.has(fileName)) {
          entries.set(fileName, nonEmptyLines);
        }
      } else {
        i++;
      }
    }
  }

  return entries;
}

async function main() {
  // Step 1: Load all gemini translation entries as UTF-8 source of truth.
  const geminiEntries = await loadGeminiEntries();
  console.log(`Loaded ${geminiEntries.size} gemini translation entries.`);

  let totalFiles = 0;
  let fixedFiles = 0;
  let fixedLines = 0;

  for (const dir of TRANSLATED_DIRS) {
    let fileNames;
    try {
      fileNames = (await readdir(dir)).filter((f) => f.endsWith(".txt")).sort();
    } catch {
      continue;
    }

    for (const fileName of fileNames) {
      const filePath = path.join(dir, fileName);
      totalFiles++;

      // Step 2: Read the current Shift-JIS translated file.
      const raw = await readFile(filePath);
      const text = sjisDecoder.decode(raw);
      const translatedLines = text.split("\n");

      // Step 3: Get the gemini source lines for this file.
      const sourceLines = geminiEntries.get(fileName);
      if (!sourceLines) continue;

      // Step 4: Fix each line where the gemini source had unsafe chars.
      // Skip speech source lines (those come from the original, not gemini).
      let fileModified = false;
      const minLen = Math.min(translatedLines.length, sourceLines.length);

      for (let i = 0; i < minLen; i++) {
        // Skip speech source lines — they're copied from original, not gemini.
        if (translatedLines[i].startsWith("＃")) continue;

        const result = fixLine(translatedLines[i], sourceLines[i]);

        if (result.unreliable) {
          console.log(`\n[UNRELIABLE] ${fileName} | ${i + 1}`);
          console.log(`  source:     ${sourceLines[i]}`);
          console.log(`  translated: ${translatedLines[i]}`);
        }

        if (result.mixed) {
          console.log(`\n[MIXED ?] ${fileName} | ${i + 1}`);
          console.log(`  Source: ${sourceLines[i]}`);
          console.log(`  Before: ${translatedLines[i]}`);
          console.log(`  After:  ${result.text}`);
        }

        if (result.text !== translatedLines[i]) {
          translatedLines[i] = result.text;
          fileModified = true;
          fixedLines++;
        }
      }

      if (fileModified) {
        await writeFile(filePath, encodeShiftJIS(translatedLines.join("\n")));
        fixedFiles++;
      }
    }
  }

  console.log();
  console.log("— Summary —");
  console.log(`  Files scanned: ${totalFiles}`);
  console.log(`  Files fixed:   ${fixedFiles}`);
  console.log(`  Lines fixed:   ${fixedLines}`);
}

main().catch(console.error);
