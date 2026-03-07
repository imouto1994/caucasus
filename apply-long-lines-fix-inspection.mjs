/**
 * Apply Long Lines Fix for Inspection Scripts
 *
 * Reads the original export (`long_lines_inspection.txt`) and the manually
 * edited version (`long_lines_inspection_updated.txt`), verifies structural
 * consistency, then patches each corresponding line in the translated
 * inspection files.
 *
 * Both files use the same format (one entry = two lines):
 *
 *   {fileName} | {lineNumber} | {requiredLength}
 *   {lineContent}
 *
 * Verification steps:
 *   1. Both files have the same number of entries.
 *   2. Each entry's header (fileName, lineNumber, requiredLength) matches
 *      between the original and updated files.
 *   3. Every updated content line is at most requiredLength characters.
 *
 * If all checks pass, each inspection file is patched in place. Files are
 * Shift-JIS encoded.
 *
 * Usage:
 *   node apply-long-lines-fix-inspection.mjs
 */

import { readFile, writeFile } from "fs/promises";
import path from "path";
import Encoding from "encoding-japanese";

const ORIGINAL_FILE = "long_lines_inspection.txt";
const UPDATED_FILE = "long_lines_inspection_updated.txt";
const INSPECTION_DIR = "translated-inspection";

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
 * Parse the inspection long_lines format into an array of entries.
 * Every two lines form one entry: header then content.
 * Header format: {fileName} | {lineNumber} | {requiredLength}
 */
function parseEntries(content) {
  const lines = content.split("\n");
  const entries = [];

  for (let i = 0; i + 1 < lines.length; i += 2) {
    const header = lines[i];
    const text = lines[i + 1];

    const parts = header.split(" | ");
    if (parts.length !== 3) {
      throw new Error(`Invalid header at line ${i + 1}: ${header}`);
    }

    const fileName = parts[0];
    const lineNum = parseInt(parts[1], 10);
    const required = parseInt(parts[2], 10);

    if (isNaN(lineNum) || isNaN(required)) {
      throw new Error(
        `Invalid numbers in header at line ${i + 1}: ${header}`
      );
    }

    entries.push({ fileName, lineNum, required, text });
  }

  return entries;
}

async function main() {
  // Step 1: Read and parse both files.
  const originalContent = await readFile(ORIGINAL_FILE, "utf-8");
  const updatedContent = await readFile(UPDATED_FILE, "utf-8");

  const originalEntries = parseEntries(originalContent);
  const updatedEntries = parseEntries(updatedContent);

  // Step 2: Verify both files have the same number of entries.
  if (originalEntries.length !== updatedEntries.length) {
    console.error(
      `Entry count mismatch: original has ${originalEntries.length}, ` +
        `updated has ${updatedEntries.length}`
    );
    process.exit(1);
  }

  // Step 3: Verify headers match and updated lines are within limits.
  let hasErrors = false;

  for (let i = 0; i < originalEntries.length; i++) {
    const orig = originalEntries[i];
    const upd = updatedEntries[i];

    if (
      orig.fileName !== upd.fileName ||
      orig.lineNum !== upd.lineNum ||
      orig.required !== upd.required
    ) {
      console.error(
        `Entry ${i + 1}: header mismatch —\n` +
          `  original: "${orig.fileName} | ${orig.lineNum} | ${orig.required}"\n` +
          `  updated:  "${upd.fileName} | ${upd.lineNum} | ${upd.required}"`
      );
      hasErrors = true;
    }

    if (upd.text.length > upd.required) {
      console.error(
        `Entry ${i + 1} (${upd.fileName} line ${upd.lineNum}): ` +
          `still too long (${upd.text.length} chars, max ${upd.required})`
      );
      hasErrors = true;
    }
  }

  if (hasErrors) {
    process.exit(1);
  }

  // Step 4: Group updated entries by file for batch patching.
  const patchesByFile = new Map();
  for (const entry of updatedEntries) {
    if (!patchesByFile.has(entry.fileName)) {
      patchesByFile.set(entry.fileName, []);
    }
    patchesByFile.get(entry.fileName).push(entry);
  }

  // Step 5: Apply patches to each inspection file.
  let patchedFiles = 0;
  let patchedLines = 0;

  for (const [fileName, patches] of patchesByFile) {
    const filePath = path.join(INSPECTION_DIR, fileName);
    const raw = await readFile(filePath);
    const text = sjisDecoder.decode(raw);
    const lines = text.split("\n");

    for (const patch of patches) {
      const idx = patch.lineNum - 1;
      if (idx < 0 || idx >= lines.length) {
        console.error(
          `${fileName}: line ${patch.lineNum} out of range ` +
            `(file has ${lines.length} lines)`
        );
        process.exit(1);
      }
      lines[idx] = patch.text;
      patchedLines++;
    }

    await writeFile(filePath, encodeShiftJIS(lines.join("\n")));
    patchedFiles++;
  }

  console.log("— Summary —");
  console.log(`  Entries verified: ${updatedEntries.length}`);
  console.log(`  Files patched:   ${patchedFiles}`);
  console.log(`  Lines updated:   ${patchedLines}`);
}

main().catch(console.error);
