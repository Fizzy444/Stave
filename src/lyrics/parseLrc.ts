export interface LyricLine {
  time: number; // in seconds
  text: string;
}

export function parseLrc(lrc: string): LyricLine[] {
  if (!lrc || typeof lrc !== 'string') return [];

  const rawLines = lrc.split(/\r?\n/);

  interface ParsedEntry {
    time: number;
    text: string;
    isEmptyTag: boolean;
  }

  const entries: ParsedEntry[] = [];
  const timeRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{2,3}))?\]/g;

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Skip standard LRC metadata tags like [ar:...], [ti:...], [al:...], etc.
    if (/^\[(ar|ti|al|by|offset|length|re|ve):/i.test(trimmed)) {
      continue;
    }

    const matches = Array.from(trimmed.matchAll(timeRegex));
    if (matches.length > 0) {
      // Strip all [mm:ss.xx] timestamp tags
      let cleanText = trimmed.replace(timeRegex, '');
      // Strip all word-level enhanced timestamp tags like <00:19.16>, <00:19.160>, <19.16>
      cleanText = cleanText.replace(/<[^>]+>/g, '');
      // Strip any QRC word duration tags like (0,500)
      cleanText = cleanText.replace(/\(\d+,\d+\)/g, '');
      cleanText = cleanText.trim();

      const isEmptyTag = cleanText.length === 0;

      for (const match of matches) {
        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        const millisRaw = match[3] || '0';
        const millis =
          millisRaw.length === 2
            ? parseInt(millisRaw, 10) * 10
            : parseInt(millisRaw.padEnd(3, '0').slice(0, 3), 10);
        const time = minutes * 60 + seconds + millis / 1000;

        entries.push({ time, text: cleanText, isEmptyTag });
      }
    }
  }

  if (entries.length === 0) return [];

  // Sort chronologically
  entries.sort((a, b) => a.time - b.time);

  // Check if this file is formatted as word-by-word streaming (e.g. from lrc.red / syrics dumps)
  // In word-by-word dumps, the vast majority of non-empty lines are single words
  const nonEmptyEntries = entries.filter((e) => !e.isEmptyTag);
  const singleWordCount = nonEmptyEntries.filter((e) => !e.text.includes(' ')).length;
  const isWordByWord =
    nonEmptyEntries.length >= 8 &&
    singleWordCount / nonEmptyEntries.length >= 0.65;

  if (isWordByWord) {
    const grouped: LyricLine[] = [];
    let currentWords: string[] = [];
    let lineStartTime = 0;
    let lastWordTime = 0;

    const flush = () => {
      if (currentWords.length > 0) {
        grouped.push({
          time: lineStartTime,
          text: currentWords.join(' '),
        });
        currentWords = [];
      }
    };

    for (const entry of entries) {
      if (entry.isEmptyTag) {
        // An empty timestamp line (e.g. [00:22.63]<00:22.63>) marks end of line/sentence
        flush();
        continue;
      }

      // If there is a natural pause (> 1.25s) between words, group as new sentence
      const timeSinceLast = entry.time - lastWordTime;
      if (currentWords.length > 0 && timeSinceLast > 1.25) {
        flush();
      }

      if (currentWords.length === 0) {
        lineStartTime = entry.time;
      }

      currentWords.push(entry.text);
      lastWordTime = entry.time;
    }

    flush();

    if (grouped.length > 0) {
      return grouped;
    }
  }

  // Standard line-by-line LRC (or single-line Enhanced LRC where tags were stripped):
  // Filter out any entries that became empty after tag removal
  return entries
    .filter((e) => !e.isEmptyTag)
    .map((e) => ({ time: e.time, text: e.text }));
}
