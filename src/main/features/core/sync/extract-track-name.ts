export function extractTrackName(
    fullString: string,
    artist: string,
    album?: string,
): string | null {
    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const artistEscaped = escapeRegex(artist);
    const sep = '(?:\\s*[-,\\s]\\s*)';
    let pattern: string;

    if (album) {
        const albumEscaped = escapeRegex(album);
        pattern = `${artistEscaped}${sep}${albumEscaped}|${albumEscaped}${sep}${artistEscaped}`;
    } else {
        pattern = artistEscaped;
    }

    const regex = new RegExp(pattern, 'i');
    let cleaned = fullString.replace(regex, '').trim();

    cleaned = cleaned.replace(/^[\s,.-]+|[\s,.-]+$/g, '');
    cleaned = cleaned.replace(/\s{2,}/g, ' ');

    return cleaned.trim() !== '' ? cleaned.trim() : null;
}
