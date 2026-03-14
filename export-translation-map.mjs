/**
 * Export Translation Map
 *
 * Builds a JSON mapping of every unique original line (from `original/`) to
 * its translated counterpart (from `translated-full/`).
 *
 * Speech source lines (＃) and their following content lines are merged into
 * a single entry:
 *
 *   Original: ＃藍           →  key:   "藍「まあ……」"
 *             「まあ……」      value: "Ai: Well..."
 *
 * Non-speech lines are mapped directly:
 *
 *   key:   "内部は外とは比べものにならないほど暖かかった。"
 *   value: "The interior was incomparably warmer than the outside."
 *
 * Empty lines are skipped. When the same original key appears multiple times
 * across files, only the first occurrence is kept.
 *
 * Output: `translation-map.json`
 *
 * Usage:
 *   node export-translation-map.mjs
 */

import { readFile, readdir, writeFile } from "fs/promises";
import path from "path";
import Encoding from "encoding-japanese";

const ORIGINAL_DIR = "original";
const TRANSLATED_FULL_DIR = "translated-full";
const OUTPUT_FILE = "translation-map.json";

const sjisDecoder = new TextDecoder("shift_jis");

const SPEAKER_MAP = new Map([
  ["主人公", "Satoshi"],
  ["なるみ", "Narumi"],
  ["想子", "Souko"],
  ["辻村", "Tsujimura"],
  ["高嶺", "Takamine"],
  ["紅緒", "Benio"],
  ["あかね", "Akane"],
  ["御巫", "Mikanagi"],
  ["摩夜", "Maya"],
  ["藍", "Ai"],
  ["詩音", "Shion"],
  ["六曜", "Rokuyou"],
  ["？？？", "???"],
  ["警官", "Police Officer"],
  ["御者", "Coachman"],
]);

// The game replaces 主人公 with the protagonist's actual name in speech lines.
const SPEAKER_KEY_MAP = new Map([
  ["主人公", "智士"],
]);

/**
 * Strip vertical-style prefixes from a line.
 * Vertical scripts may prefix lines with "　" (fullwidth space) or "　＄　".
 */
function stripVerticalPrefix(line) {
  if (line.startsWith("\u3000\uFF04\u3000")) return line.slice(3);
  if (line.startsWith("\u3000")) return line.slice(1);
  return line;
}

function readTranslatedFull(raw) {
  const detected = Encoding.detect(raw);
  if (detected === "SJIS") {
    return sjisDecoder.decode(raw);
  }
  return raw.toString("utf-8");
}

async function main() {
  const translatedFileNames = new Set(
    (await readdir(TRANSLATED_FULL_DIR))
      .filter((f) => f.endsWith(".txt"))
  );

  const originalFileNames = (await readdir(ORIGINAL_DIR))
    .filter((f) => f.endsWith(".txt") && translatedFileNames.has(f))
    .sort();

  const map = new Map();
  let totalPairs = 0;
  let duplicates = 0;
  let unknownSpeakers = new Set();

  for (const fileName of originalFileNames) {
    const origRaw = await readFile(path.join(ORIGINAL_DIR, fileName));
    const origText = sjisDecoder.decode(origRaw);
    const origLines = origText.split("\n");
    if (origLines.at(-1) === "") origLines.pop();

    const transRaw = await readFile(path.join(TRANSLATED_FULL_DIR, fileName));
    const transText = readTranslatedFull(transRaw);
    const transLines = transText.split("\n");
    if (transLines.at(-1) === "") transLines.pop();

    let i = 0;
    while (i < origLines.length && i < transLines.length) {
      const origRaw = origLines[i];
      const transLine = transLines[i];
      const origLine = stripVerticalPrefix(origRaw);

      if (origLine.length === 0) {
        i++;
        continue;
      }

      if (origLine.startsWith("\uFF03")) {
        const speakerJP = origLine.slice(1);
        const speakerEN = SPEAKER_MAP.get(speakerJP);

        if (!speakerEN) {
          unknownSpeakers.add(speakerJP);
        }

        if (i + 1 < origLines.length && i + 1 < transLines.length) {
          const contentOrig = stripVerticalPrefix(origLines[i + 1]);
          const contentTrans = transLines[i + 1];

          const speakerKey = SPEAKER_KEY_MAP.get(speakerJP) || speakerJP;
          const key = `${speakerKey}${contentOrig}`;
          const value = `${speakerEN || speakerJP}: "${contentTrans}"`;

          if (!map.has(key)) {
            map.set(key, value);
            totalPairs++;
          } else {
            duplicates++;
          }

          i += 2;
        } else {
          i++;
        }
        continue;
      }

      if (!map.has(origLine)) {
        map.set(origLine, transLine);
        totalPairs++;
      } else {
        duplicates++;
      }

      i++;
    }
  }

  const obj = Object.fromEntries(map);
  await writeFile(OUTPUT_FILE, JSON.stringify(obj, null, 2), "utf-8");

  console.log("— Summary —");
  console.log(`  Files processed:  ${originalFileNames.length}`);
  console.log(`  Unique entries:   ${totalPairs}`);
  console.log(`  Duplicates skip:  ${duplicates}`);
  console.log(`  Exported to:      ${OUTPUT_FILE}`);

  if (unknownSpeakers.size > 0) {
    console.log(`\n  Unknown speakers: ${[...unknownSpeakers].join(", ")}`);
  }
}

main().catch(console.error);
