/**
 * Merge Exploration Scene Scripts
 *
 * The game features "exploration occasions" where the player can choose
 * different locations to visit. Each location's script lives in a separate
 * file under `original/`, grouped by a shared prefix:
 *
 *   {prefix}_{suffix}.txt   e.g. F01_map.txt, F01_room.txt, F01_search.txt
 *
 * The prefix always matches the pattern [A-Z][0-9][0-9] (e.g. F01, L13).
 * Files that share a prefix belong to the same exploration occasion.
 *
 * This script scans `original/`, groups files by prefix, and produces one
 * merged file per group under `merged-exploration-scenes/`:
 *
 *   F01_map.txt
 *   ********************
 *   (content of F01_map.txt)
 *   --------------------
 *   F01_room.txt
 *   ********************
 *   (content of F01_room.txt)
 *   --------------------
 *   ...
 *
 * Usage:
 *   node merge-exploration-scenes.mjs
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
const OUTPUT_DIR = "merged-exploration-scenes";

// Captures the shared prefix (e.g. "F01") and the per-scene suffix from
// filenames like "F01_map.txt". Files not matching this pattern (e.g.
// "01_1600.txt", "start.txt") are regular story scripts and are skipped.
const PREFIX_PATTERN = /^([A-Z]\d{2})_(.+)\.txt$/;

const SEPARATOR = Buffer.from("\n--------------------\n");

async function main() {
  const files = await glob(`${ORIGINAL_DIR}/*.txt`);

  // Group exploration files by their shared prefix.
  // e.g. { "F01" => ["original/F01_map.txt", "original/F01_room.txt", ...] }
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

  await mkdir(OUTPUT_DIR, { recursive: true });

  const sortedPrefixes = [...groups.keys()].sort();

  for (const prefix of sortedPrefixes) {
    const filePaths = groups.get(prefix).sort();
    const buffers = [];

    for (let i = 0; i < filePaths.length; i++) {
      if (i > 0) buffers.push(SEPARATOR);

      const filename = path.basename(filePaths[i]);

      // Header and content are kept as raw buffers to preserve Shift-JIS
      // encoding from the source files.
      buffers.push(Buffer.from(`${filename}\n********************\n`));
      buffers.push(await readFile(filePaths[i]));
    }

    const outputPath = path.join(OUTPUT_DIR, `${prefix}.txt`);
    await writeFile(outputPath, Buffer.concat(buffers));

    console.log(`${prefix}.txt — ${filePaths.length} files merged`);
  }

  console.log(
    `\nDone. ${sortedPrefixes.length} merged files written to ${OUTPUT_DIR}/`,
  );
}

main().catch(console.error);
