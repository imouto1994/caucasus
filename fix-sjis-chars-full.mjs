/**
 * Fix Characters Lost in Shift-JIS Encoding (Full Translations, UTF-8)
 *
 * Some Unicode characters have no Shift-JIS representation and were silently
 * converted to '?' during encoding. This script restores them by comparing
 * each translated file against the original UTF-8 entry from
 * `gemini-translation-text/`.
 *
 * Since `translated-full/` files are UTF-8, corrupted characters are restored
 * to their original Unicode forms (not Shift-JIS-safe replacements):
 *   ? (corrupted from —) → — (U+2014 em dash)
 *   ? (corrupted from ·) → · (U+00B7 middle dot)
 *   ? (corrupted from é) → é (U+00E9 e-acute)
 *
 * For each line, if the UTF-8 source has N occurrences of these characters
 * and the translated line has N extra '?' compared to the source's real '?'
 * count, we walk both strings and replace each corrupted '?' with the
 * original Unicode character.
 *
 * Usage:
 *   node fix-sjis-chars-full.mjs
 */

import { readFile, readdir, writeFile } from "fs/promises";
import path from "path";
import Encoding from "encoding-japanese";

const TRANSLATION_TEXT_DIR = "gemini-translation-text";
const TRANSLATED_DIRS = ["translated-full"];

const sjisDecoder = new TextDecoder("shift_jis");

// Characters that get corrupted to '?' in Shift-JIS. Since the output is
// UTF-8, we restore the original Unicode characters directly.
const UNSAFE_CHARS = new Set(["\u2014", "\u00B7", "\u00E9"]);

const HEADER_DASHES = "-".repeat(20);
const SEPARATOR_DASHES = "-".repeat(80);
const HEADER_STARS = "*".repeat(20);

/**
 * Read a translated-full file, auto-detecting Shift-JIS or UTF-8.
 */
function decodeTranslated(raw) {
  const detected = Encoding.detect(raw);
  if (detected === "SJIS") {
    return sjisDecoder.decode(raw);
  }
  return raw.toString("utf-8");
}

function isUnsafeChar(ch) {
  return UNSAFE_CHARS.has(ch);
}

/**
 * Fix a translated line by comparing against its UTF-8 source.
 *
 * Walks both strings character-by-character to replace corrupted '?' at the
 * exact positions where the source had unsafe chars, restoring the original
 * Unicode character.
 */
function fixLine(translatedLine, sourceLine) {
  let unsafeCount = 0;
  for (const ch of sourceLine) {
    if (isUnsafeChar(ch)) unsafeCount++;
  }
  if (unsafeCount === 0) return { text: translatedLine };

  // Strip wrappers from source to match the translated format.
  let sourceUnwrapped = sourceLine;
  if (
    (sourceLine.startsWith("「") && sourceLine.endsWith("」")) ||
    (sourceLine.startsWith("『") && sourceLine.endsWith("』")) ||
    (sourceLine.startsWith('"') && sourceLine.endsWith('"'))
  ) {
    sourceUnwrapped = sourceLine.slice(1, -1);
  }

  if (sourceUnwrapped === translatedLine) return { text: translatedLine };

  const sourceQCount = (sourceLine.match(/\?/g) || []).length;
  const transQCount = (translatedLine.match(/\?/g) || []).length;
  const corruptedCount = transQCount - sourceQCount;

  if (corruptedCount <= 0) return { text: translatedLine };

  if (corruptedCount !== unsafeCount) {
    return { text: translatedLine, unreliable: true };
  }

  // Build a queue: for each '?' in the source order, record the original
  // Unicode char (for unsafe) or literal '?' (for real question marks).
  const queue = [];
  for (const ch of sourceLine) {
    if (isUnsafeChar(ch)) queue.push(ch);
    else if (ch === "?") queue.push("?");
  }

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

        const nonEmptyLines = contentLines.filter((l) => l.trim().length > 0);

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

      const raw = await readFile(filePath);
      const text = decodeTranslated(raw);
      const translatedLines = text.split("\n");

      const sourceLines = geminiEntries.get(fileName);
      if (!sourceLines) continue;

      let fileModified = false;
      const minLen = Math.min(translatedLines.length, sourceLines.length);

      for (let i = 0; i < minLen; i++) {
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
        await writeFile(filePath, translatedLines.join("\n"), "utf-8");
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
