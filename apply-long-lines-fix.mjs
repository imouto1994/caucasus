/**
 * Apply Long Lines Fix
 *
 * Reads the original export (`long_lines.txt`) and the manually edited
 * version (`long_lines_updated.txt`), verifies structural consistency,
 * then patches each corresponding line in the translated files.
 *
 * Both files use the same format (one entry = two lines):
 *
 *   {filePath} | {lineNumber}
 *   {lineContent}
 *
 * Verification steps:
 *   1. Both files have the same number of entries.
 *   2. Each entry's header (filePath + lineNumber) matches between the
 *      original and updated files.
 *   3. Every updated content line is at most MAX_LENGTH characters.
 *
 * If all checks pass, each translated file is patched in place. Files are
 * Shift-JIS encoded.
 *
 * Usage:
 *   node apply-long-lines-fix.mjs
 */

import { readFile, writeFile } from "fs/promises";
import Encoding from "encoding-japanese";

const ORIGINAL_FILE = "long_lines.txt";
const UPDATED_FILE = "long_lines_updated.txt";
const MAX_LENGTH = 120;

const sjisDecoder = new TextDecoder("shift_jis");

// Unicode characters that have no Shift-JIS representation → safe replacements.
const CHAR_REPLACEMENTS = new Map([
  ["\u2014", "\u2015"], // — (em dash) → ― (horizontal bar)
  ["\u00B7", "\u30FB"], // · (middle dot) → ・ (katakana middle dot)
  ["\u00E9", "e"],      // é (e-acute) → e
]);

/**
 * Encode a Unicode string to a Shift-JIS Buffer, replacing characters that
 * cannot be represented in Shift-JIS first.
 */
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
 * Parse the long_lines format into an array of { file, lineNum, text }.
 * Every two lines form one entry: header then content.
 */
function parseEntries(content) {
  const lines = content.split("\n");
  const entries = [];

  for (let i = 0; i + 1 < lines.length; i += 2) {
    const header = lines[i];
    const text = lines[i + 1];

    const sepIdx = header.lastIndexOf(" | ");
    if (sepIdx === -1) {
      throw new Error(`Invalid header at line ${i + 1}: ${header}`);
    }

    const file = header.slice(0, sepIdx);
    const lineNum = parseInt(header.slice(sepIdx + 3), 10);

    if (isNaN(lineNum)) {
      throw new Error(
        `Invalid line number in header at line ${i + 1}: ${header}`
      );
    }

    entries.push({ file, lineNum, text });
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
      `Entry count mismatch: original has ${originalEntries.length}, updated has ${updatedEntries.length}`
    );
    process.exit(1);
  }

  // Step 3: Verify headers match and updated lines are within the limit.
  let hasErrors = false;

  for (let i = 0; i < originalEntries.length; i++) {
    const orig = originalEntries[i];
    const upd = updatedEntries[i];

    if (orig.file !== upd.file || orig.lineNum !== upd.lineNum) {
      console.error(
        `Entry ${i + 1}: header mismatch — ` +
          `original "${orig.file} | ${orig.lineNum}" vs ` +
          `updated "${upd.file} | ${upd.lineNum}"`
      );
      hasErrors = true;
    }

    if (upd.text.length > MAX_LENGTH) {
      console.error(
        `Entry ${i + 1} (${upd.file} line ${upd.lineNum}): ` +
          `still too long (${upd.text.length} chars, max ${MAX_LENGTH})`
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
    if (!patchesByFile.has(entry.file)) {
      patchesByFile.set(entry.file, []);
    }
    patchesByFile.get(entry.file).push(entry);
  }

  // Step 5: Apply patches to each translated file.
  let patchedFiles = 0;
  let patchedLines = 0;

  for (const [filePath, patches] of patchesByFile) {
    const raw = await readFile(filePath);
    const text = sjisDecoder.decode(raw);
    const lines = text.split("\n");

    for (const patch of patches) {
      const idx = patch.lineNum - 1;
      if (idx < 0 || idx >= lines.length) {
        console.error(
          `${filePath}: line ${patch.lineNum} out of range (file has ${lines.length} lines)`
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
