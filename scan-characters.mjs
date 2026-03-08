/**
 * Scan Unique Non-Alphanumeric Characters
 *
 * Reads every .txt file in `translated/` and `translated-inspection/`, decoding
 * from Shift-JIS (or UTF-8
 * if detected), and prints all unique characters that are not ASCII
 * alphanumeric (a-z, A-Z, 0-9).
 *
 * Usage:
 *   node scan-characters.mjs
 */

import { readFile, readdir } from "fs/promises";
import path from "path";
import Encoding from "encoding-japanese";

const DIRS = ["translated", "translated-inspection", "translated-question"];
const sjisDecoder = new TextDecoder("shift_jis");

async function main() {
  const charSet = new Set();
  let totalFiles = 0;

  for (const dir of DIRS) {
    let fileNames;
    try {
      fileNames = (await readdir(dir)).filter((f) => f.endsWith(".txt")).sort();
    } catch {
      continue;
    }

    for (const fileName of fileNames) {
      const raw = await readFile(path.join(dir, fileName));
      const detected = Encoding.detect(raw);
      const text =
        detected === "SJIS" ? sjisDecoder.decode(raw) : raw.toString("utf-8");

      for (const ch of text) {
        if (!/[a-zA-Z0-9]/.test(ch)) {
          charSet.add(ch);
        }
      }
      totalFiles++;
    }
  }

  const chars = [...charSet].sort(
    (a, b) => a.codePointAt(0) - b.codePointAt(0)
  );

  console.log(`Unique non-alphanumeric characters (${chars.length} total):\n`);
  for (const ch of chars) {
    const code = ch.codePointAt(0);
    const hex = "U+" + code.toString(16).toUpperCase().padStart(4, "0");
    const display =
      ch === "\n"
        ? "\\n"
        : ch === "\r"
        ? "\\r"
        : ch === "\t"
        ? "\\t"
        : ch === " "
        ? "(space)"
        : ch;
    console.log(`${hex}  ${display}  (codepoint: ${code})`);
  }

  console.log(`\nScanned ${totalFiles} files across ${DIRS.join(", ")}`);
}

main().catch(console.error);
