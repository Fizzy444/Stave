export interface LyricLine {
    time: number; // in seconds
    text: string;
}

export function parseLrc(lrc: string): LyricLine[] {
    const lines = lrc.split('\n');
    const result: LyricLine[] = [];
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

    for (const line of lines) {
        const match = timeRegex.exec(line);
        if (match) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            const millis = match[3].length === 2 ? parseInt(match[3], 10) * 10 : parseInt(match[3], 10);
            const time = minutes * 60 + seconds + millis / 1000;
            const text = line.replace(timeRegex, '').trim();
            
            result.push({ time, text });
        }
    }
    return result;
}
