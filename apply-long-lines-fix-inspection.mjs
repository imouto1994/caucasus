/**
 * Apply Long Lines Fix for Inspection Scripts
 *
 * Reads the original export (`long_lines_inspection.txt`) and the manually
 * edited version (`long_lines_inspection_updated.txt`), verifies consistency,
 * then patches each corresponding line in the translated inspection files.
 *
 * Both files use the same format (one entry = two lines):
 *
 *   {fileName} | {lineNumber} | {requiredLength}
 *   {lineContent}
 *
 * Verification steps:
 *   1. The set of entry headers in both files must match (order may differ).
 *   2. Every updated content line is at most requiredLength characters.
 *
 * If step 1 passes but step 2 fails, the script rewrites the updated file
 * with still-invalid entries at the top and valid entries at the bottom,
 * then exits without patching.
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
 * Build a canonical header key for set comparison.
 */
function headerKey(entry) {
  return `${entry.fileName} | ${entry.lineNum} | ${entry.required}`;
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
      throw new Error(`Invalid numbers in header at line ${i + 1}: ${header}`);
    }

    entries.push({ fileName, lineNum, required, text });
  }

  return entries;
}

/**
 * Serialize entries back to the two-line-per-entry format.
 */
function serializeEntries(entries) {
  const lines = [];
  for (const entry of entries) {
    lines.push(headerKey(entry));
    lines.push(entry.text);
  }
  return lines.join("\n");
}

async function main() {
  // Step 1: Read and parse both files.
  const originalContent = await readFile(ORIGINAL_FILE, "utf-8");
  const updatedContent = await readFile(UPDATED_FILE, "utf-8");

  const originalEntries = parseEntries(originalContent);
  const updatedEntries = parseEntries(updatedContent);

  // Step 2: Verify the set of entry headers match between both files.
  const originalKeys = new Set(originalEntries.map(headerKey));
  const updatedKeys = new Set(updatedEntries.map(headerKey));

  let headerMismatch = false;

  for (const key of originalKeys) {
    if (!updatedKeys.has(key)) {
      console.error(`Missing in updated file: ${key}`);
      headerMismatch = true;
    }
  }
  for (const key of updatedKeys) {
    if (!originalKeys.has(key)) {
      console.error(`Extra in updated file: ${key}`);
      headerMismatch = true;
    }
  }

  if (originalEntries.length !== updatedEntries.length) {
    console.error(
      `Entry count mismatch: original has ${originalEntries.length}, ` +
        `updated has ${updatedEntries.length}`
    );
    headerMismatch = true;
  }

  if (headerMismatch) {
    process.exit(1);
  }

  // Step 3: Check that every updated line is within its required length.
  const invalid = [];
  const valid = [];

  for (const entry of updatedEntries) {
    if (entry.text.length > entry.required) {
      invalid.push(entry);
    } else {
      valid.push(entry);
    }
  }

  if (invalid.length > 0) {
    console.error(
      `${invalid.length} entries still too long (${valid.length} valid):\n`
    );
    for (const entry of invalid) {
      console.error(
        `  ${entry.fileName} line ${entry.lineNum}: ` +
          `${entry.text.length} chars, max ${entry.required}`
      );
    }

    // Rewrite the updated file: invalid entries first, valid entries last.
    const reordered = [...invalid, ...valid];
    await writeFile(UPDATED_FILE, serializeEntries(reordered), "utf-8");

    console.error(
      `\nRewrote ${UPDATED_FILE} with ${invalid.length} invalid entries ` +
        `at the top. Fix those and re-run.`
    );
    process.exit(1);
  }

  // Step 4: Build a lookup from header key → updated text.
  const updatedByKey = new Map();
  for (const entry of updatedEntries) {
    updatedByKey.set(headerKey(entry), entry);
  }

  // Step 5: Group entries by file for batch patching (using original order).
  const patchesByFile = new Map();
  for (const orig of originalEntries) {
    const upd = updatedByKey.get(headerKey(orig));
    if (!patchesByFile.has(upd.fileName)) {
      patchesByFile.set(upd.fileName, []);
    }
    patchesByFile.get(upd.fileName).push(upd);
  }

  // Step 6: Apply patches to each inspection file.
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
