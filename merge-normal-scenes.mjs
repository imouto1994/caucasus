/**
 * Merge Normal Scene Scripts
 *
 * Alongside the exploration scripts (prefixed with [A-Z][0-9][0-9]),
 * the `original/` folder contains "normal scene" scripts whose filenames
 * start with a digit:
 *
 *   {prefix}_{suffix}.txt   e.g. 01_1600.txt, 01z_2600.txt, 99a1_9999end1.txt
 *
 * The prefix is everything before the first underscore and always starts
 * with a digit (e.g. "00", "01", "01z", "02b1", "99a1"). Files sharing
 * a prefix belong to the same scene group.
 *
 * This script scans `original/`, groups normal scene files by prefix,
 * and produces one merged file per group under `merged-normal-scenes/`:
 *
 *   01_1600.txt
 *   ********************
 *   (content of 01_1600.txt)
 *   --------------------
 *   01_1700.txt
 *   ********************
 *   (content of 01_1700.txt)
 *   --------------------
 *   ...
 *
 * Usage:
 *   node merge-normal-scenes.mjs
 *
 * Note: The original script files are encoded in Shift-JIS. We use raw
 * Buffer I/O (no encoding parameter) so the bytes pass through untouched
 * and the merged output preserves the original encoding. The ASCII-only
 * separators and filenames are Shift-JIS-compatible, so no conversion is
 * needed.
 */

import { glob } from "glob";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const ORIGINAL_DIR = "original";
const OUTPUT_DIR = "merged-normal-scenes";

// Captures the shared prefix and per-scene suffix from filenames whose
// prefix starts with a digit, e.g. "01z_2600.txt" → prefix "01z",
// suffix "2600". Exploration files (prefix starting with an uppercase
// letter like "F01_map.txt") won't match because \d requires a leading
// digit.
const PREFIX_PATTERN = /^(\d\w*)_(.+)\.txt$/;

const SEPARATOR = Buffer.from("\n--------------------\n");

async function main() {
  // Step 1: Discover all .txt script files under the original/ directory.
  const files = await glob(`${ORIGINAL_DIR}/*.txt`);

  // Step 2: Group normal scene files by their shared prefix.
  // Only files whose name starts with a digit are normal scenes; exploration
  // files (starting with [A-Z]) and other files (e.g. "start.txt") are
  // skipped.
  // Result: { "01" => ["original/01_1600.txt", ...], "01z" => [...], ... }
  const groups = new Map();
  for (const filePath of files) {
    const filename = path.basename(filePath);
    const match = filename.match(PREFIX_PATTERN);
    if (!match) continue;

    const prefix = match[1];
    if (!groups.has(prefix)) {
      groups.set(prefix, []);
    }
    groups.get(prefix).push(filePath);
  }

  // Step 3: Ensure the output directory exists.
  await mkdir(OUTPUT_DIR, { recursive: true });

  // Step 4: For each prefix group, merge all scene files into a single
  // output file. Files within each group are sorted alphabetically so the
  // merged output has a deterministic order.
  const sortedPrefixes = [...groups.keys()].sort();

  for (const prefix of sortedPrefixes) {
    const filePaths = groups.get(prefix).sort();
    const buffers = [];

    // Step 4a: Build the merged content as a list of Buffers.
    // Header and content are kept as raw buffers to preserve the original
    // Shift-JIS encoding from the source files.
    for (let i = 0; i < filePaths.length; i++) {
      if (i > 0) buffers.push(SEPARATOR);

      const filename = path.basename(filePaths[i]);
      buffers.push(Buffer.from(`${filename}\n********************\n`));
      buffers.push(await readFile(filePaths[i]));
    }

    // Step 4b: Write the concatenated buffers to the output file.
    const outputPath = path.join(OUTPUT_DIR, `${prefix}.txt`);
    await writeFile(outputPath, Buffer.concat(buffers));

    console.log(`${prefix}.txt — ${filePaths.length} files merged`);
  }

  console.log(
    `\nDone. ${sortedPrefixes.length} merged files written to ${OUTPUT_DIR}/`,
  );
}

main().catch(console.error);
