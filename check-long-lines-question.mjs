/**
 * Check Long Lines in Question Scripts
 *
 * Scans every translated question script in `translated-question/` and
 * compares each line's character count against the corresponding original
 * line in `original/`.
 *
 * Question scripts use a fixed-width layout: each fullwidth character in
 * the original occupies 2 columns, so the translated (ASCII) line must have
 * exactly 2× the character count of the original line. Lines exceeding this
 * limit are exported to `long_lines_question.txt`.
 *
 * Lines identical to the original (speech sources, options, etc.) and empty
 * lines are skipped.
 *
 * Output format (one entry per long line):
 *
 *   {fileName} | {lineNumber} | {requiredLength}
 *   {lineContent}
 *
 * Copy the output to `long_lines_question_updated.txt`, shorten each
 * content line, then run `validate-long-lines-fix-question.mjs`.
 *
 * All files are Shift-JIS encoded.
 *
 * Usage:
 *   node check-long-lines-question.mjs
 */

import { readFile, readdir, writeFile } from "fs/promises";
import path from "path";

const QUESTION_DIR = "translated-question";
const ORIGINAL_DIR = "original";
const OUTPUT_FILE = "long_lines_question.txt";

const sjisDecoder = new TextDecoder("shift_jis");

async function main() {
  const fileNames = (await readdir(QUESTION_DIR))
    .filter((f) => f.endsWith(".txt"))
    .sort();

  const entries = [];
  let totalChecked = 0;

  for (const fileName of fileNames) {
    const transRaw = await readFile(path.join(QUESTION_DIR, fileName));
    const transText = sjisDecoder.decode(transRaw);
    const transLines = transText.split("\n");

    let origRaw;
    try {
      origRaw = await readFile(path.join(ORIGINAL_DIR, fileName));
    } catch {
      console.warn(`  ⚠  No original found for ${fileName}, skipping.`);
      continue;
    }

    const origText = sjisDecoder.decode(origRaw);
    const origLines = origText.split("\n");

    const lineCount = Math.min(transLines.length, origLines.length);

    for (let i = 0; i < lineCount; i++) {
      const origLine = origLines[i];
      if (origLine.length === 0) continue;
      if (transLines[i] === origLine) continue;

      const required = origLine.length * 2;
      totalChecked++;

      if (transLines[i].length > required) {
        entries.push({
          fileName,
          lineNum: i + 1,
          required,
          text: transLines[i],
        });
      }
    }
  }

  const outputLines = [];
  for (const entry of entries) {
    outputLines.push(
      `${entry.fileName} | ${entry.lineNum} | ${entry.required}`
    );
    outputLines.push(entry.text);
  }

  await writeFile(OUTPUT_FILE, outputLines.join("\n"), "utf-8");

  console.log("— Summary —");
  console.log(`  Lines checked: ${totalChecked}`);
  console.log(`  Lines too long: ${entries.length}`);
  console.log(`  Exported to: ${OUTPUT_FILE}`);
  console.log();
  console.log(
    `Copy to long_lines_question_updated.txt, shorten each content line,` +
      ` then run validate-long-lines-fix-question.mjs`
  );
}

main().catch(console.error);
