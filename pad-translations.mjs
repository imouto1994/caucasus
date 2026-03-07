/**
 * Pad Translated Scripts for Display Line Wrapping
 *
 * The game text box displays each line across a maximum of 2 displayed rows.
 * The 1st row accepts 64 characters; any remaining text flows to the 2nd row.
 * When a word straddles the 64-char boundary, part of it appears on row 1 and
 * the rest on row 2, which looks bad.
 *
 * This script scans each line in `translated/` and:
 *   1. Detects choice/option lines in the original script and replaces them
 *      with the original Japanese text (the game can't render translated
 *      options well).
 *   2. Expands template variables ((NAME01), (NAME02)) to their display
 *      values for accurate width calculation.
 *   3. If a word would be cut at the 64-char boundary, inserts space padding
 *      before that word so it starts on the 2nd row instead.
 *   4. If a word ends exactly at char 64 and the next char is a space,
 *      removes that redundant leading space from the 2nd row.
 *   5. Logs lines where padding causes the total length to exceed MAX_LENGTH.
 *
 * Speech source lines are skipped. Output is written to `translated-padding/`.
 *
 * Usage:
 *   node pad-translations.mjs
 */

import { readFile, readdir, writeFile, mkdir } from "fs/promises";
import path from "path";
import Encoding from "encoding-japanese";

const INPUT_DIR = "translated";
const ORIGINAL_DIR = "original";
const OUTPUT_DIR = "translated-padding";
// The game's 1st display row fits this many characters.
const LINE_WIDTH = 64;
// Warn when a padded line exceeds this total length.
const MAX_LENGTH = 128;

const sjisDecoder = new TextDecoder("shift_jis");

// The game engine replaces these template variables at runtime with the
// player's chosen name. We substitute the longest expected values so
// padding calculations reflect the actual display width.
const TEMPLATE_REPLACEMENTS = [
  // (NAME01)(NAME02) must come before (NAME01) so the combined form is
  // matched first and not partially replaced.
  ["(NAME01)(NAME02)", "Kobayashi Satoshi"],
  ["(NAME01)", "Kobayashi"],
];

/**
 * Expand template variables to their display values for width calculation.
 */
function expandTemplates(line) {
  let result = line;
  for (const [tpl, val] of TEMPLATE_REPLACEMENTS) {
    result = result.replaceAll(tpl, val);
  }
  return result;
}

/**
 * Check if a character is a Japanese kanji, hiragana, katakana, or fullwidth
 * question mark. These are the typical ending characters for choice lines
 * in the original script.
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
 *   - Each line ends with kanji, hiragana, katakana, or fullwidth ?
 *
 * Returns a Set of 0-based line indices that belong to option groups.
 */
function detectOptionLines(originalLines) {
  // Step 1: Build a set of speech content line indices. A speech content
  // line is the line immediately following a speech source line.
  const speechContent = new Set();
  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].startsWith("\uFF03") && i + 1 < originalLines.length) {
      speechContent.add(i + 1);
    }
  }

  const optionIndices = new Set();
  let i = 0;
  while (i < originalLines.length) {
    // Step 2: Skip speech source lines, speech content lines, and empties.
    if (
      speechContent.has(i) ||
      originalLines[i].startsWith("\uFF03") ||
      originalLines[i].length === 0
    ) {
      i++;
      continue;
    }

    // Step 3: Check if this line ends with an option-like character.
    const lastChar = originalLines[i].trimEnd().slice(-1);
    if (isOptionEndingChar(lastChar)) {
      // Step 4: Collect consecutive lines that also end with option chars.
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

      // Step 5: Only treat as options if there are 2+ consecutive lines.
      // A single line ending with kanji is just normal narration.
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
 * Pad a single line so that no word is cut at the LINE_WIDTH boundary.
 *
 * Three cases:
 *   1. Row 1 ends with a space  -> clean break, no change needed.
 *   2. Row 2 starts with a space -> word ended exactly at the boundary;
 *      remove the redundant leading space (the line break already acts as
 *      the visual word separator).
 *   3. A word straddles the boundary -> insert space padding before that
 *      word so it starts at the beginning of row 2.
 */
function padLine(line) {
  // Lines that fit on one row don't need padding.
  if (line.length <= LINE_WIDTH) return line;

  // Split at the boundary: first 64 chars (row 1) and the rest (row 2).
  const first = line.slice(0, LINE_WIDTH);
  const rest = line.slice(LINE_WIDTH);

  // Case 1: last char of row 1 is a space — clean word break already.
  if (first.endsWith(" ")) return line;

  // Case 2: first char of row 2 is a space — word ended exactly at char 64.
  // Remove the space since the line break is the visual separator.
  if (rest.startsWith(" ")) return first + rest.slice(1);

  // Case 3: a word straddles the boundary. Find where that word starts by
  // scanning backward from the boundary to the last space in row 1.
  const lastSpace = first.lastIndexOf(" ");
  if (lastSpace === -1) {
    // No space in the entire first row — can't pad without breaking it.
    return line;
  }

  // Insert padding spaces between the last complete word and the straddling
  // word, pushing the straddling word to the start of row 2.
  const beforeWord = line.slice(0, lastSpace + 1);
  const wordAndRest = line.slice(lastSpace + 1);
  const padding = " ".repeat(LINE_WIDTH - (lastSpace + 1));

  return beforeWord + padding + wordAndRest;
}

async function main() {
  // Step 1: Ensure the output directory exists.
  await mkdir(OUTPUT_DIR, { recursive: true });

  // Step 2: Discover all translated files.
  const fileNames = (await readdir(INPUT_DIR))
    .filter((f) => f.endsWith(".txt"))
    .sort();

  let totalFiles = 0;
  let modifiedFiles = 0;
  let paddedLines = 0;
  let overLimitLines = 0;
  let optionLineCount = 0;

  for (const fileName of fileNames) {
    // Step 3: Read the translated file (Shift-JIS).
    const raw = await readFile(path.join(INPUT_DIR, fileName));
    const text = sjisDecoder.decode(raw);
    const lines = text.split("\n");

    // Step 4: Read the corresponding original file to detect option lines.
    let originalLines = [];
    let optionIndices = new Set();
    try {
      const origRaw = await readFile(path.join(ORIGINAL_DIR, fileName));
      const origText = sjisDecoder.decode(origRaw);
      originalLines = origText.split("\n");
      if (originalLines.at(-1) === "") originalLines.pop();
      optionIndices = detectOptionLines(originalLines);
    } catch {
      // No original available — skip option detection for this file.
    }

    // Step 5: Log any detected option groups so the user can verify.
    if (optionIndices.size > 0) {
      const sorted = [...optionIndices].sort((a, b) => a - b);
      console.log(fileName);
      for (const idx of sorted) {
        console.log(`${idx + 1} | ${originalLines[idx]}`);
      }
      console.log();
      optionLineCount += optionIndices.size;
    }

    let fileModified = false;

    // Step 6: Process each line.
    const result = lines.map((line, i) => {
      // 6a: Skip speech source lines — the game engine handles these.
      if (line.startsWith("\uFF03")) return line;

      // 6b: For option/choice lines, replace with the original Japanese
      // text since the game can't render translated options properly.
      if (optionIndices.has(i) && i < originalLines.length) {
        if (originalLines[i] !== line) fileModified = true;
        return originalLines[i];
      }

      // 6c: Expand template variables to their display values so the
      // padding calculation uses the actual rendered width.
      const expanded = expandTemplates(line);

      // 6d: Lines that fit on one row need no padding.
      if (expanded.length <= LINE_WIDTH) return expanded;

      // 6e: Apply padding to prevent word cut-off at the row boundary.
      const padded = padLine(expanded);
      if (padded !== expanded) {
        fileModified = true;
        paddedLines++;

        // 6f: Warn if padding pushes the line over the max length.
        if (padded.length > MAX_LENGTH) {
          overLimitLines++;
          console.log(
            `[OVER ${MAX_LENGTH}] ${fileName} | ${i + 1} (${
              padded.length
            } chars)`
          );
          console.log(`  ${padded}`);
        }
      }
      return padded;
    });

    totalFiles++;
    if (fileModified) modifiedFiles++;

    // Step 7: Write the processed file to the output directory (Shift-JIS).
    const outputPath = path.join(OUTPUT_DIR, fileName);
    await writeFile(outputPath, encodeShiftJIS(result.join("\n")));
  }

  // Step 8: Print summary.
  console.log("--- Summary ---");
  console.log(`  Files processed:     ${totalFiles}`);
  console.log(`  Files with changes:  ${modifiedFiles}`);
  console.log(`  Lines padded:        ${paddedLines}`);
  console.log(`  Option lines kept:   ${optionLineCount}`);
  if (overLimitLines > 0) {
    console.log(`  Lines over ${MAX_LENGTH} chars: ${overLimitLines}`);
  }
}

main().catch(console.error);
