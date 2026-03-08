/**
 * Pad Exploration Scripts to Exact Required Length
 *
 * Reads every translated exploration script in `translated-exploration/` and
 * its corresponding original in `original/`, then pads each content line
 * with '-' characters so it reaches exactly 2× the original line's character
 * count.
 *
 * If `long_lines_exploration_updated.txt` exists, lines that were flagged as
 * too long are replaced with the shortened versions from that file before
 * padding is applied.
 *
 * Lines identical to the original (speech sources, etc.) and empty lines are
 * copied as-is. Option/choice lines are detected and replaced with the
 * original Japanese text, since the game can't render translated options.
 *
 * Output is written to `translated-exploration-padding/` as Shift-JIS.
 *
 * Usage:
 *   node pad-exploration.mjs
 */

import { readFile, readdir, writeFile, mkdir } from "fs/promises";
import path from "path";
import Encoding from "encoding-japanese";

const EXPLORATION_DIR = "translated-exploration";
const ORIGINAL_DIR = "original";
const OUTPUT_DIR = "translated-exploration-padding";
const OVERRIDES_FILE = "long_lines_exploration_updated.txt";
const OPTIONS_FILE = "options_exploration.txt";

const sjisDecoder = new TextDecoder("shift_jis");

// Unicode characters that have no Shift-JIS representation → safe replacements.
const CHAR_REPLACEMENTS = new Map([
  ["\u2014", "-"], // — (em dash) → ― (horizontal bar)
  ["\u00B7", "."], // · (middle dot) → ・ (katakana middle dot)
  ["\u00E9", "e"], // é (e-acute) → e
]);

function encodeShiftJIS(str) {
  let safe = str;
  for (const [from, to] of CHAR_REPLACEMENTS) {
    safe = safe.replaceAll(from, to);
  }
  const codeArray = Encoding.convert(Encoding.stringToCode(safe), {
    to: "SJIS",
    from: "UNICODE",
  });
  return Buffer.from(codeArray);
}

/**
 * Check if a character is a Japanese kanji, hiragana, or katakana.
 * These are the typical ending characters for choice lines in the original.
 */
function isOptionEndingChar(ch) {
  if (!ch) return false;
  const code = ch.codePointAt(0);
  return (
    (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs (kanji)
    (code >= 0x3040 && code <= 0x309f) || // Hiragana
    (code >= 0x30a0 && code <= 0x30ff) // Katakana
  );
}

/**
 * Detect option/choice line groups in the original script.
 *
 * An option group is 2+ consecutive lines that are:
 *   - NOT a speech source line (does not start with fullwidth #)
 *   - NOT a speech content line (not immediately after a speech source line)
 *   - Each line ends with kanji, hiragana, or katakana
 *
 * Returns a Set of 0-based line indices that belong to option groups.
 */
function detectOptionLines(originalLines) {
  const speechContent = new Set();
  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].startsWith("\uFF03") && i + 1 < originalLines.length) {
      speechContent.add(i + 1);
    }
  }

  const optionIndices = new Set();
  let i = 0;
  while (i < originalLines.length) {
    if (
      speechContent.has(i) ||
      originalLines[i].startsWith("\uFF03") ||
      originalLines[i].length === 0
    ) {
      i++;
      continue;
    }

    const lastChar = originalLines[i].trimEnd().slice(-1);
    if (isOptionEndingChar(lastChar)) {
      const group = [i];
      let j = i + 1;
      while (
        j < originalLines.length &&
        !speechContent.has(j) &&
        !originalLines[j].startsWith("\uFF03") &&
        originalLines[j].length > 0
      ) {
        const jLast = originalLines[j].trimEnd().slice(-1);
        if (isOptionEndingChar(jLast)) {
          group.push(j);
          j++;
        } else {
          break;
        }
      }

      if (group.length >= 2) {
        for (const idx of group) optionIndices.add(idx);
      }
      i = j;
    } else {
      i++;
    }
  }

  return optionIndices;
}

/**
 * Load overrides from the updated long-lines file.
 * Returns a Map keyed by "{fileName}:{lineNum}" → overrideText.
 */
async function loadOverrides() {
  const overrides = new Map();

  let content;
  try {
    content = await readFile(OVERRIDES_FILE, "utf-8");
  } catch {
    return overrides;
  }

  const lines = content.split("\n");
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const parts = lines[i].split(" | ");
    if (parts.length !== 3) continue;

    const fileName = parts[0];
    const lineNum = parseInt(parts[1], 10);
    const required = parseInt(parts[2], 10);
    const text = lines[i + 1];

    if (isNaN(lineNum) || isNaN(required)) continue;

    if (text.length > required) {
      console.error(
        `[SKIP] Override for ${fileName} line ${lineNum} still too long ` +
          `(${text.length} chars, max ${required}). Run validation first.`
      );
      continue;
    }

    overrides.set(`${fileName}:${lineNum}`, text);
  }

  if (overrides.size > 0) {
    console.log(
      `Loaded ${overrides.size} overrides from ${OVERRIDES_FILE}\n`
    );
  }

  return overrides;
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const overrides = await loadOverrides();

  const fileNames = (await readdir(EXPLORATION_DIR))
    .filter((f) => f.endsWith(".txt"))
    .sort();

  let totalFiles = 0;
  let paddedLines = 0;
  let overriddenLines = 0;
  let overLimitLines = 0;
  let optionLineCount = 0;
  const optionEntries = [];

  for (const fileName of fileNames) {
    const transRaw = await readFile(path.join(EXPLORATION_DIR, fileName));
    const transText = sjisDecoder.decode(transRaw);
    const transLines = transText.split("\n");

    let origRaw;
    try {
      origRaw = await readFile(path.join(ORIGINAL_DIR, fileName));
    } catch {
      console.warn(`  ⚠  No original found for ${fileName}, copying as-is.`);
      await writeFile(
        path.join(OUTPUT_DIR, fileName),
        encodeShiftJIS(transText)
      );
      totalFiles++;
      continue;
    }

    const origText = sjisDecoder.decode(origRaw);
    const origLines = origText.split("\n");
    if (origLines.at(-1) === "") origLines.pop();

    const optionIndices = detectOptionLines(origLines);
    optionLineCount += optionIndices.size;

    if (optionIndices.size > 0) {
      const sorted = [...optionIndices].sort((a, b) => a - b);
      const group = { fileName, options: [] };
      for (const idx of sorted) {
        const origText = origLines[idx] || "";
        const transText = idx < transLines.length ? transLines[idx] : "";
        group.options.push({ line: idx + 1, origText, transText });
      }
      optionEntries.push(group);
    }

    const lineCount = Math.min(transLines.length, origLines.length);
    const result = [...transLines];

    for (let i = 0; i < lineCount; i++) {
      const origLine = origLines[i];
      if (origLine.length === 0) continue;

      if (optionIndices.has(i) && i < origLines.length) {
        result[i] = origLines[i];
        continue;
      }

      if (transLines[i] === origLine) continue;

      const required = origLine.length * 2;

      // Apply override if one exists for this line.
      const overrideKey = `${fileName}:${i + 1}`;
      if (overrides.has(overrideKey)) {
        result[i] = overrides.get(overrideKey);
        overriddenLines++;
      }

      const current = result[i].length;

      if (current > required) {
        overLimitLines++;
        console.error(
          `[OVER] ${fileName} line ${i + 1}: ` +
            `${current} chars, required ${required}`
        );
        continue;
      }

      if (current < required) {
        result[i] = result[i] + "-".repeat(required - current);
        paddedLines++;
      }
    }

    await writeFile(
      path.join(OUTPUT_DIR, fileName),
      encodeShiftJIS(result.join("\n"))
    );
    totalFiles++;
  }

  if (optionEntries.length > 0) {
    const optionLines = [];
    for (const group of optionEntries) {
      optionLines.push(group.fileName);
      for (const opt of group.options) {
        optionLines.push(`${opt.line} | ${opt.origText} | ${opt.transText}`);
      }
      optionLines.push("");
    }
    await writeFile(OPTIONS_FILE, optionLines.join("\n"), "utf-8");
    console.log(`Options exported to ${OPTIONS_FILE}`);
  }

  console.log("— Summary —");
  console.log(`  Files processed:  ${totalFiles}`);
  console.log(`  Lines overridden: ${overriddenLines}`);
  console.log(`  Option lines kept: ${optionLineCount}`);
  console.log(`  Lines padded:     ${paddedLines}`);
  if (overLimitLines > 0) {
    console.error(`  Lines over limit: ${overLimitLines} (fix these first!)`);
  }
}

main().catch(console.error);
