/**
 * Parse Gemini Translation JSON Files
 *
 * The `gemini-translation-json/` folder contains exported JSON files from
 * Gemini, each representing a full conversation thread used for translating
 * game scene scripts.
 *
 * Each JSON file is an array of message entries. Every entry has a "role"
 * field ("user" or "assistant") and a "contents" array of content blocks,
 * each with a "type" ("text" or "thinking") and a "content" string.
 *
 * This script:
 *   1. Reads each JSON file from `gemini-translation-json/`
 *   2. Keeps only entries where role === "assistant"
 *   3. From each assistant entry's contents, keeps only blocks where
 *      type === "text" (discarding "thinking" blocks)
 *   4. Joins the text blocks within an entry with a newline
 *   5. Separates each assistant reply with a line of 80 dashes
 *   6. Writes the result as a .txt file with the same base name into
 *      `gemini-translation-text/`
 *
 * Usage:
 *   node parse-gemini-translations.mjs
 */

import { glob } from "glob";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const INPUT_DIR = "gemini-translation-json";
const OUTPUT_DIR = "gemini-translation-text";

// 80 dashes used to visually separate each assistant reply in the output.
const SEPARATOR = "-".repeat(80);

async function main() {
  // Step 1: Discover all JSON files in the input directory.
  const files = await glob(`${INPUT_DIR}/*.json`);

  if (files.length === 0) {
    console.log(`No JSON files found in ${INPUT_DIR}/`);
    return;
  }

  // Step 2: Ensure the output directory exists.
  await mkdir(OUTPUT_DIR, { recursive: true });

  // Step 3: Process each JSON file.
  const sortedFiles = files.sort();

  for (const filePath of sortedFiles) {
    const baseName = path.basename(filePath, ".json");

    // Step 3a: Read and parse the JSON conversation array.
    const raw = await readFile(filePath, "utf-8");
    const entries = JSON.parse(raw);

    // Step 3b: Extract text content from each assistant reply.
    // Each assistant entry may contain multiple content blocks; we only want
    // blocks with type "text", ignoring "thinking" blocks.
    const replyTexts = entries
      .filter((entry) => entry.role === "assistant")
      .map((entry) => {
        const textBlocks = entry.contents
          .filter((block) => block.type === "text")
          .map((block) => block.content);

        return textBlocks.join("\n");
      })
      // Skip any assistant entries that had no text blocks at all.
      .filter((text) => text.length > 0);

    // Step 3c: Join all replies with the separator line so each reply is
    // clearly distinguished in the output file.
    const output = replyTexts.join(`\n${SEPARATOR}\n`);

    // Step 3d: Write the parsed text to the output file.
    const outputPath = path.join(OUTPUT_DIR, `${baseName}.txt`);
    await writeFile(outputPath, output, "utf-8");

    console.log(`${baseName}.txt — ${replyTexts.length} assistant replies written`);
  }

  console.log(
    `\nDone. ${sortedFiles.length} files processed, output written to ${OUTPUT_DIR}/`,
  );
}

main().catch(console.error);
