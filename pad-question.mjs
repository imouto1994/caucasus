/**
 * Pad Question Scripts to Exact Required Length
 *
 * Reads every translated question script in `translated-question/` and
 * its corresponding original in `original/`, then pads each content line
 * with '-' characters so it reaches exactly 2× the original line's character
 * count.
 *
 * If `long_lines_question_updated.txt` exists, lines that were flagged as
 * too long are replaced with the shortened versions from that file before
 * padding is applied.
 *
 * Lines identical to the original (speech sources, options, etc.) and empty
 * lines are copied as-is.
 *
 * Output is written to `translated-question-padding/` as Shift-JIS.
 *
 * Usage:
 *   node pad-question.mjs
 */

import { readFile, readdir, writeFile, mkdir } from "fs/promises";
import path from "path";
import Encoding from "encoding-japanese";

const QUESTION_DIR = "translated-question";
const ORIGINAL_DIR = "original";
const OUTPUT_DIR = "translated-question-padding";
const OVERRIDES_FILE = "long_lines_question_updated.txt";

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

  const fileNames = (await readdir(QUESTION_DIR))
    .filter((f) => f.endsWith(".txt"))
    .sort();

  let totalFiles = 0;
  let paddedLines = 0;
  let overriddenLines = 0;
  let overLimitLines = 0;

  for (const fileName of fileNames) {
    const transRaw = await readFile(path.join(QUESTION_DIR, fileName));
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

    const lineCount = Math.min(transLines.length, origLines.length);
    const result = [...transLines];

    for (let i = 0; i < lineCount; i++) {
      const origLine = origLines[i];
      if (origLine.length === 0) continue;
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

  console.log("— Summary —");
  console.log(`  Files processed:  ${totalFiles}`);
  console.log(`  Lines overridden: ${overriddenLines}`);
  console.log(`  Lines padded:     ${paddedLines}`);
  if (overLimitLines > 0) {
    console.error(`  Lines over limit: ${overLimitLines} (fix these first!)`);
  }
}

main().catch(console.error);
