#!/usr/bin/env node
/**
 * Build the music-attribution data the About tab renders, from the demo-library
 * manifest produced by subbox-workspace's `resolve_jamendo_provenance.py`.
 *
 * Every Creative Commons licence except CC0 requires attribution: the work's
 * title, its creator, a link to the source, and the licence name plus a link
 * to its deed (the "TASL" model). The demo library is public — anyone can log
 * in as `demo` and browse or download it — so that attribution has to be
 * visible somewhere in the product, not just recorded in a TSV on a laptop.
 *
 * The manifest is derived from the *live* library rather than from a fetch log:
 * Jamendo embeds each track's CC deed URL in the file's `copyright` frame, so
 * the snapshot reads back what prod actually serves. That is what keeps this
 * page honest — a fetch log can drift from the library, the files cannot.
 *
 * Usage:
 *
 *     node scripts/build-credits.mjs <manifest.tsv> [--out <path>]
 *
 * The default output is checked in, so the app builds without needing the
 * manifest present. Re-run this whenever the demo library changes —
 * a stale credits page is an attribution failure, not a cosmetic bug.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = resolve(HERE, '../src/renderer/features/settings/credits/music-credits.json');

/**
 * Licence family slugs mapped to the name each licence asks to be called by.
 *
 * The version is NOT baked in here — the live library mixes 2.0, 2.5 and 3.0,
 * and naming the wrong one is itself a defective attribution. It comes from the
 * licence URL, which is the authoritative record of what was granted.
 *
 * NC variants are deliberately absent. Subbox is a commercial product, so an
 * NC-licensed track in a public demo library is a breach, and the right
 * response to finding one is a hard build failure rather than a credit line.
 */
const LICENCES = {
    by: 'CC BY',
    'by-nd': 'CC BY-ND',
    'by-sa': 'CC BY-SA',
    'publicdomain-mark': 'Public Domain Mark',
    'publicdomain-zero': 'CC0',
};

/** Read the licence family from either manifest spelling.
 *
 *  The current resolver emits `licence` holding a bare family (`by-sa`); the
 *  older fetch-time manifest emitted `license` holding a `cc-` prefixed slug
 *  (`cc-by-sa`). Accept both so an older manifest still builds rather than
 *  failing as if its licences were unrecognised.
 */
function licenceFamily(row) {
    const raw = (row.licence || row.license || '').trim().toLowerCase();
    return raw.startsWith('cc-') ? raw.slice(3) : raw;
}

const licenceUrlOf = (row) => row.licence_url || row.license_url || '';

/** Pull the licence version ("3.0", "2.5", "1.0") out of a canonical CC deed URL. */
function licenceVersion(url) {
    const match = /\/(?:licenses|publicdomain)\/[a-z0-9-]+\/(\d+\.\d+)\//.exec(url ?? '');
    return match ? match[1] : null;
}

function main() {
    const args = process.argv.slice(2);
    const outFlag = args.indexOf('--out');
    const out = outFlag === -1 ? DEFAULT_OUT : resolve(args[outFlag + 1]);
    const manifestPath = args.find(
        (arg, index) => !arg.startsWith('--') && args[index - 1] !== '--out',
    );

    if (!manifestPath) {
        console.error('usage: node scripts/build-credits.mjs <manifest.tsv> [--out <path>]');
        process.exit(1);
    }

    const rows = parseTsv(readFileSync(resolve(manifestPath), 'utf8'));

    const unknown = new Set();
    const unversioned = [];
    const unlinked = [];
    const tracks = rows
        .map((row) => {
            const licence = LICENCES[licenceFamily(row)];
            if (!licence) {
                unknown.add(licenceFamily(row) || '(blank)');
                return null;
            }

            const url = licenceUrlOf(row);
            const version = licenceVersion(url);
            if (!version) {
                unversioned.push(`${row.artist} — ${row.title} (${url || 'no url'})`);
                return null;
            }

            // CC asks for a link to the work, and Jamendo's API terms require a
            // direct backlink to each track's page. A credit without one is
            // incomplete, so refuse rather than quietly emitting a dead entry.
            const sourceUrl = row.listen_url || row.source_url;
            if (!sourceUrl) {
                unlinked.push(`${row.artist} — ${row.title}`);
                return null;
            }

            return {
                artist: row.artist,
                licence: `${licence} ${version}`,
                licenceUrl: url,
                sourceUrl,
                title: row.title,
            };
        })
        .filter(Boolean)
        // Group a creator's tracks together, so the page reads as a credits
        // list rather than the fetch order.
        .sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));

    if (unknown.size > 0) {
        console.error(
            `refusing to build: manifest contains ${unknown.size} unrecognised licence value(s): ` +
                `${[...unknown].join(', ')}.\nEvery track in the demo library must have a known, ` +
                `attribution-cleared licence — add it to LICENCES here only if it genuinely is one.`,
        );
        process.exit(1);
    }

    if (unversioned.length > 0) {
        console.error(
            `refusing to build: ${unversioned.length} track(s) have a licence URL with no ` +
                `parseable version, so the credit cannot name the licence correctly:\n  ` +
                `${unversioned.join('\n  ')}`,
        );
        process.exit(1);
    }

    if (unlinked.length > 0) {
        console.error(
            `refusing to build: ${unlinked.length} track(s) have no source URL, so they cannot ` +
                `be linked back to the artist's release:\n  ${unlinked.join('\n  ')}`,
        );
        process.exit(1);
    }

    if (tracks.length === 0) {
        console.error('refusing to build: manifest produced no tracks');
        process.exit(1);
    }

    const payload = {
        _comment:
            'Generated by scripts/build-credits.mjs from the demo-library manifest. Do not edit by hand; ' +
            'regenerate after every reseed.',
        generatedAt: new Date().toISOString().slice(0, 10),
        source: {
            name: 'Jamendo',
            url: 'https://www.jamendo.com/',
        },
        tracks,
    };

    if (!existsSync(dirname(out))) {
        mkdirSync(dirname(out), { recursive: true });
    }
    writeFileSync(out, `${JSON.stringify(payload, null, 4)}\n`);

    const byLicence = tracks.reduce((acc, track) => {
        acc[track.licence] = (acc[track.licence] ?? 0) + 1;
        return acc;
    }, {});
    console.log(`wrote ${tracks.length} tracks to ${out}`);
    for (const [licence, count] of Object.entries(byLicence).sort()) {
        console.log(`  ${licence.padEnd(22)} ${count}`);
    }
}

function parseTsv(raw) {
    const lines = raw.split('\n').filter((line) => line.trim() !== '');
    if (lines.length === 0) {
        throw new Error('manifest is empty');
    }

    const header = lines[0].split('\t');
    return lines.slice(1).map((line) => {
        const cells = line.split('\t');
        return Object.fromEntries(header.map((key, index) => [key, cells[index] ?? '']));
    });
}

main();
