/**
 * Validate Long Lines Fix for Exploration Scripts
 *
 * Reads the original export (`long_lines_exploration.txt`) and the manually
 * edited version (`long_lines_exploration_updated.txt`) and validates that:
 *
 *   1. The set of entry headers in both files match (order may differ).
 *   2. Every updated content line is at most requiredLength characters.
 *
 * If step 1 passes but step 2 fails, the script rewrites the updated file
 * with still-invalid entries at the top and valid entries at the bottom,
 * then exits with a non-zero code.
 *
 * This script does NOT modify any translated files. The validated overrides
 * are consumed by `pad-exploration.mjs` during the padding step.
 *
 * Both files use the same format (one entry = two lines):
 *
 *   {fileName} | {lineNumber} | {requiredLength}
 *   {lineContent}
 *
 * Usage:
 *   node validate-long-lines-fix-exploration.mjs
 */

import { readFile, writeFile } from "fs/promises";

const ORIGINAL_FILE = "long_lines_exploration.txt";
const UPDATED_FILE = "long_lines_exploration_updated.txt";

/**
 * Build a canonical header key for set comparison.
 */
function headerKey(entry) {
  return `${entry.fileName} | ${entry.lineNum} | ${entry.required}`;
}

/**
 * Parse the exploration long_lines format into an array of entries.
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

    const reordered = [...invalid, ...valid];
    await writeFile(UPDATED_FILE, serializeEntries(reordered), "utf-8");

    console.error(
      `\nRewrote ${UPDATED_FILE} with ${invalid.length} invalid entries ` +
        `at the top. Fix those and re-run.`
    );
    process.exit(1);
  }

  console.log("✓ All entries valid.");
  console.log(`  Total entries: ${updatedEntries.length}`);
}

main().catch(console.error);
