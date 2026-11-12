/**
 * `fetch` for an image, retried with backoff when the server sheds load.
 *
 * Subbox's Navidrome pools serve one artwork request at a time
 * (`ND_DEVARTWORKMAXREQUESTS=1`, which bounds the pool's memory) and answer
 * the overflow with 429. That's worst right after an upload, when an album
 * grid asks for a dozen uncached covers at once. Before this, a 429 put the
 * image in its error state for good, so it showed the placeholder until the
 * component remounted (subbox-app#321).
 *
 * Only 429 and 503 are retried. Any other failure is final, as before.
 */

const RETRYABLE_STATUSES = new Set([429, 503]);

export const IMAGE_FETCH_MAX_ATTEMPTS = 6;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8000;

/** Delay before retry number `attempt` (1-based): exponential with jitter, or
 * the server's `Retry-After` seconds when it sends one. Capped either way. */
export const imageRetryDelayMs = (
    attempt: number,
    retryAfter: null | string,
    random: () => number = Math.random,
): number => {
    const retryAfterSeconds = retryAfter === null ? NaN : Number(retryAfter);
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
        return Math.min(retryAfterSeconds * 1000, MAX_DELAY_MS);
    }

    const exponential = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
    // Jitter spreads a grid's worth of retries out, so they don't all come back
    // at the same moment and get refused together again.
    return exponential * (0.5 + random() / 2);
};

const delay = (ms: number, signal?: AbortSignal | null) =>
    new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }

        const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });

export async function fetchImage(
    url: string,
    init: RequestInit,
    maxAttempts: number = IMAGE_FETCH_MAX_ATTEMPTS,
): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
        const response = await fetch(url, init);

        if (response.ok || !RETRYABLE_STATUSES.has(response.status) || attempt >= maxAttempts) {
            return response;
        }

        // Rejects if the component unmounts or the request changes meanwhile.
        await delay(imageRetryDelayMs(attempt, response.headers.get('Retry-After')), init.signal);
    }
}
