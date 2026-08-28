import https from 'https';

// HTTP against the local dev stack from plain Node.
//
// `fetch()` can't reach it: the stack is addressed by Traefik host rules on
// *.docker.localhost, and Node's getaddrinfo does not resolve `.localhost`
// subdomains (Chromium does, per the spec, which is why the app itself is fine and
// only Node drivers hit this). So dial 127.0.0.1 explicitly and carry the real
// hostname in the Host header and the TLS SNI — Traefik routes on the former, the
// self-signed cert matches on the latter.
//
// Local dev only: it pins the connection to loopback and skips certificate
// verification, both of which would be wrong anywhere else. `devRequest` refuses
// any host that isn't *.docker.localhost so that can't happen by accident.

const LOOPBACK = '127.0.0.1';

/**
 * @param {string} urlString  e.g. https://pymix.docker.localhost/user/library_size
 * @param {{ body?: string, headers?: Record<string,string>, method?: string }} [opts]
 * @returns {Promise<{ body: string, headers: import('http').IncomingHttpHeaders,
 *   json: () => any, status: number }>}
 */
export function devRequest(urlString, opts = {}) {
    const url = new URL(urlString);
    if (!/\.docker\.localhost$/.test(url.hostname)) {
        throw new Error(
            `devRequest refuses ${url.hostname} — it is for the local dev stack ` +
                '(*.docker.localhost) only.',
        );
    }
    const { body, headers = {}, method = 'GET' } = opts;
    // node:https does not add Content-Length for us, and FastAPI reads a body-less
    // DELETE as a missing field (422) rather than as an empty body — so set it here
    // for every method rather than only the ones where it is conventional.
    const bodyHeaders = body ? { 'Content-Length': Buffer.byteLength(body) } : {};

    return new Promise((resolve, reject) => {
        const req = https.request(
            {
                headers: { Host: url.hostname, ...bodyHeaders, ...headers },
                host: LOOPBACK,
                method,
                path: `${url.pathname}${url.search}`,
                port: url.port || 443,
                rejectUnauthorized: false,
                servername: url.hostname,
            },
            (res) => {
                let text = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => {
                    text += chunk;
                });
                res.on('end', () =>
                    resolve({
                        body: text,
                        headers: res.headers,
                        json: () => JSON.parse(text),
                        status: res.statusCode,
                    }),
                );
            },
        );
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

/** Log into pymix and return the Cookie header value for subsequent calls. */
export async function pymixLogin(pymixUrl, username, password) {
    const res = await devRequest(`${pymixUrl}/user/login`, {
        body: JSON.stringify({ password, session_id: 'none', username }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
    });
    if (res.status !== 200) {
        throw new Error(`pymix login failed for ${username}: ${res.status} ${res.body}`);
    }
    const setCookie = res.headers['set-cookie'] ?? [];
    return setCookie.map((c) => c.split(';')[0]).join('; ');
}

/** Call a Subsonic method on a user's own Navidrome container. */
export async function subsonic(username, password, method, params = {}) {
    const qs = new URLSearchParams({
        c: 'subbox-qa',
        f: 'json',
        p: password,
        u: username,
        v: '1.16.1',
        ...params,
    });
    const res = await devRequest(
        `https://navidrome${username}.docker.localhost/rest/${method}.view?${qs}`,
    );
    const payload = res.json()['subsonic-response'];
    if (!payload || payload.status !== 'ok') {
        throw new Error(`${method} failed: ${JSON.stringify(payload?.error ?? payload)}`);
    }
    return payload;
}
