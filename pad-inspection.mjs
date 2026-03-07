/**
 * Pad Inspection Scripts to Exact Required Length
 *
 * Reads every translated inspection script in `translated-inspection/` and
 * its corresponding original in `original/`, then pads each content line
 * with '-' characters so it reaches exactly 2× the original line's character
 * count.
 *
 * Lines identical to the original (speech sources, options, etc.) and empty
 * lines are copied as-is.
 *
 * Output is written to `translated-inspection-padding/` as Shift-JIS.
 *
 * Prerequisites:
 *   All content lines must already be ≤ the required length (run
 *   check-long-lines-inspection.mjs + apply-long-lines-fix-inspection.mjs
 *   first if needed).
 *
 * Usage:
 *   node pad-inspection.mjs
 */

import { readFile, readdir, writeFile, mkdir } from "fs/promises";
import path from "path";
import Encoding from "encoding-japanese";

const INSPECTION_DIR = "translated-inspection";
const ORIGINAL_DIR = "original";
const OUTPUT_DIR = "translated-inspection-padding";

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

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const fileNames = (await readdir(INSPECTION_DIR))
    .filter((f) => f.endsWith(".txt"))
    .sort();

  let totalFiles = 0;
  let paddedLines = 0;
  let overLimitLines = 0;

  for (const fileName of fileNames) {
    const transRaw = await readFile(path.join(INSPECTION_DIR, fileName));
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
      const current = transLines[i].length;

      if (current > required) {
        overLimitLines++;
        console.error(
          `[OVER] ${fileName} line ${i + 1}: ` +
            `${current} chars, required ${required}`
        );
        continue;
      }

      if (current < required) {
        result[i] = transLines[i] + "-".repeat(required - current);
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
  console.log(`  Files processed: ${totalFiles}`);
  console.log(`  Lines padded:    ${paddedLines}`);
  if (overLimitLines > 0) {
    console.error(`  Lines over limit: ${overLimitLines} (fix these first!)`);
  }
}

main().catch(console.error);
