import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { extractPlaylists } from '../src/main/features/core/sync/rekordbox-xml';

// Regression check for subbox-app#142: playlist and folder names must come out of the
// parser exactly as Rekordbox wrote them. pymix matches the selected playlists against
// the raw names in the uploaded XML, so a name rewritten by sanitizeName (e.g. ':' -> '-')
// matched nothing and the playlist was silently never created. Runs against a minimal
// synthetic Rekordbox XML fixture, not a real user's library export.
//
// Usage: pnpm run check:rekordbox-playlist-names

const ODD_FOLDER = 'Sets: 2024 / "Live"';
const ODD_PLAYLIST = 'Weird: Chars % & "Quotes" <a|b> ?*\\';
const ODD_TOP_LEVEL = 'Melodic House / Techno';

const FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0">
    <COLLECTION Entries="1">
        <TRACK TrackID="1" Name="Some Track" Artist="Test Artist" Album="" TotalTime="200"
            Location="file://localhost/Users/todo/Music/Some%20Track.mp3" />
    </COLLECTION>
    <PLAYLISTS>
        <NODE Type="0" Name="ROOT" Count="2">
            <NODE Type="1" Name="Melodic House / Techno" KeyType="0" Entries="1">
                <TRACK Key="1" />
            </NODE>
            <NODE Type="0" Name="Sets: 2024 / &quot;Live&quot;" Count="1">
                <NODE Type="1" Name="Weird: Chars % &amp; &quot;Quotes&quot; &lt;a|b&gt; ?*\\" KeyType="0" Entries="1">
                    <TRACK Key="1" />
                </NODE>
            </NODE>
        </NODE>
    </PLAYLISTS>
</DJ_PLAYLISTS>
`;

const fixturePath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'rb-xml-names-check-')),
    'fixture.xml',
);
fs.writeFileSync(fixturePath, FIXTURE_XML, 'utf8');

try {
    const { folders, playlists } = extractPlaylists(fixturePath);

    assert.deepEqual(
        playlists.map((p) => p.name),
        [ODD_TOP_LEVEL],
        'top-level playlist name was rewritten',
    );
    assert.equal(folders.length, 1, 'expected one folder');
    assert.equal(folders[0].name, ODD_FOLDER, 'folder name was rewritten');
    assert.deepEqual(
        folders[0].playlists.map((p) => p.name),
        [ODD_PLAYLIST],
        'nested playlist name was rewritten',
    );
    assert.equal(folders[0].playlists[0].trackCount, 1, 'nested playlist lost its track');

    console.log('rekordbox playlist name check passed:');
    console.log(`  top-level playlist -> ${playlists[0].name}`);
    console.log(`  folder             -> ${folders[0].name}`);
    console.log(`  nested playlist    -> ${folders[0].playlists[0].name}`);
} finally {
    fs.rmSync(path.dirname(fixturePath), { force: true, recursive: true });
}
