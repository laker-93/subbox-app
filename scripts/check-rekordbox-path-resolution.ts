import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { extractPlaylists } from '../src/main/features/core/sync/rekordbox-xml';

// Regression check for the Windows drive-letter path bug: Rekordbox on Windows encodes
// track locations as file://localhost/C:/..., and parseTrack() must resolve that to a
// real Windows path rather than a bogus root-relative "C:" folder (see PR #54). Runs
// against a minimal synthetic Rekordbox XML fixture, not a real user's library export.
//
// Usage: pnpm run check:rekordbox-paths

const FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0">
    <COLLECTION Entries="2">
        <TRACK TrackID="1" Name="Chop it Up" Artist="Louis The Child &amp; Whethan" Album="Honey" TotalTime="180"
            Location="file://localhost/C:/Users/tdono/Desktop/Tracks/Louis%20The%20Child%20%26%20Whethan%20-%20Honey/01%20Chop%20it%20Up.m4a" />
        <TRACK TrackID="2" Name="Some Track" Artist="Test Artist" Album="" TotalTime="200"
            Location="file://localhost/Users/todo/Music/Some%20Track.mp3" />
    </COLLECTION>
    <PLAYLISTS>
        <NODE Type="0" Name="ROOT" Count="0"></NODE>
    </PLAYLISTS>
</DJ_PLAYLISTS>
`;

const fixturePath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'rb-xml-check-')),
    'fixture.xml',
);
fs.writeFileSync(fixturePath, FIXTURE_XML, 'utf8');

try {
    const { tracks } = extractPlaylists(fixturePath);

    const windowsTrack = tracks.find((t) => t.name === 'Chop it Up');
    const macTrack = tracks.find((t) => t.name === 'Some Track');

    assert(windowsTrack, 'expected the Windows-drive-letter track to be parsed');
    assert(macTrack, 'expected the Mac-style track to be parsed');

    // The whole point of the fix: resolve with path.win32 explicitly so this is correct
    // regardless of which OS this check runs on.
    const expectedWindowsLocation = path.win32.resolve(
        'C:/Users/tdono/Desktop/Tracks/Louis The Child & Whethan - Honey/01 Chop it Up.m4a',
    );
    assert.equal(
        windowsTrack!.location,
        expectedWindowsLocation,
        `Windows drive-letter path resolved incorrectly: ${windowsTrack!.location}`,
    );
    assert(
        !windowsTrack!.location.startsWith(`${path.sep}C:`) &&
            !windowsTrack!.location.startsWith('/C:'),
        `Windows drive-letter path regressed to the old broken "/C:/..." shape: ${windowsTrack!.location}`,
    );

    // Non-Windows paths should still resolve the same way they did before the fix
    // (host-platform path.resolve, untouched by the Windows-specific branch).
    const expectedMacLocation = path.resolve('/Users/todo/Music/Some Track.mp3');
    assert.equal(
        macTrack!.location,
        expectedMacLocation,
        `Mac-style path resolution regressed: ${macTrack!.location}`,
    );

    console.log('rekordbox path resolution check passed:');
    console.log(`  Windows drive-letter path -> ${windowsTrack!.location}`);
    console.log(`  Mac-style path            -> ${macTrack!.location}`);
} finally {
    fs.rmSync(path.dirname(fixturePath), { force: true, recursive: true });
}
