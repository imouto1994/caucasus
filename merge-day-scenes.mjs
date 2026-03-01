/**
 * Merge Normal Scene Scripts by Day
 *
 * The `original/` folder contains "normal scene" scripts whose filenames
 * start with a digit:
 *
 *   {prefix}_{suffix}.txt   e.g. 01_1600.txt, 01z_2600.txt, 02a_1640h.txt
 *
 * This script groups them by the first two digits of the filename, which
 * represent a "day" in the game (e.g. "01", "02", "03"). All variants
 * under the same day (01, 01z, 02a, 02b1, etc.) are merged into a single
 * file under `merged-day-scenes/`:
 *
 *   01_1600.txt
 *   ********************
 *   (content of 01_1600.txt)
 *   --------------------
 *   01z_2600.txt
 *   ********************
 *   (content of 01z_2600.txt)
 *   --------------------
 *   ...
 *
 * Usage:
 *   node merge-day-scenes.mjs
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
const OUTPUT_DIR = "merged-day-scenes";

// Matches normal scene filenames starting with a digit and captures the
// first two digits as the day group. For example "02a_1640h.txt" matches
// with day "02", and "99a1_9999end1.txt" matches with day "99".
// Exploration files (starting with [A-Z]) won't match.
const DAY_PATTERN = /^(\d{2})\w*_.+\.txt$/;

const SEPARATOR = Buffer.from("\n--------------------\n");

async function main() {
  // Step 1: Discover all .txt script files under the original/ directory.
  const files = await glob(`${ORIGINAL_DIR}/*.txt`);

  // Step 2: Group normal scene files by their 2-digit day prefix.
  // e.g. { "01" => ["original/01_1600.txt", "original/01z_2600.txt", ...],
  //        "02" => ["original/02_0700.txt", "original/02a_1640h.txt", ...] }
  const groups = new Map();
  for (const filePath of files) {
    const filename = path.basename(filePath);
    const match = filename.match(DAY_PATTERN);
    if (!match) continue;

    const day = match[1];
    if (!groups.has(day)) {
      groups.set(day, []);
    }
    groups.get(day).push(filePath);
  }

  // Step 3: Ensure the output directory exists.
  await mkdir(OUTPUT_DIR, { recursive: true });

  // Step 4: For each day group, merge all scene files into a single output
  // file. Files within each group are sorted alphabetically so the merged
  // output has a deterministic order.
  const sortedDays = [...groups.keys()].sort();

  for (const day of sortedDays) {
    const filePaths = groups.get(day).sort();
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
    const outputPath = path.join(OUTPUT_DIR, `${day}.txt`);
    await writeFile(outputPath, Buffer.concat(buffers));

    console.log(`${day}.txt — ${filePaths.length} files merged`);
  }

  console.log(
    `\nDone. ${sortedDays.length} merged files written to ${OUTPUT_DIR}/`
  );
}

main().catch(console.error);
