"""Build the onboarding-guide screenshot fixtures from the CC demo library.

Rekordbox: <root>/rb/Music/... + <root>/rb/rekordbox.xml
Serato:    <root>/serato/Music/... + <root>/serato/_Serato_/SubCrates/*.crate
Folder:    <root>/folder/Music/... (plain files, for the Watch guide)
Copies are made, and their SUBBOX_ID tags stripped, so the originals are untouched
and each upload is a fresh track.
"""
import json
import shutil
import sys
from pathlib import Path

from mutagen.id3 import ID3
from pyrekordbox.rbxml import RekordboxXml
from pyserato.builder import Builder
from pyserato.encoders.v2_encoder import V2Encoder
from pyserato.model.crate import Crate
from pyserato.model.hot_cue import HotCue
from pyserato.model.hot_cue_type import HotCueType
from pyserato.model.serato_color import SeratoColor
from pyserato.model.track import Track

SRC = Path.home() / "Music/SubboxProdDemoLibrary"
ROOT = Path(sys.argv[1])

RB = {
    ("Gigs", "Warm Up"): ["Full Moon", "A lo largo", "Malk and Starjam (ft. Faib) - Sweet",
                          "Slow motion", "6. Voodoo"],
    ("Gigs", "Peak Time"): ["Afterworld", "Circuit Shaker - Elektron Acid", "Infinity",
                            "No More Silence (Original Mix)", "Afx 303"],
    (None, "New Finds"): ["Tribal Roadtrip", "Polar Motion", "Between Two Dots"],
}
SERATO = {
    ("Gigs", "Warm Up"): ["Sunset", "Winter Is Coming", "Some soft n mellow fellow",
                          "Behind the line"],
    ("Gigs", "Peak Time"): ["Daunting Scandal", "Circuit Shaker - Number 8 (Deeper Mix)",
                            "The Power of Nature", "Tamale Wally"],
    (None, "New Finds"): ["Fruisty", "Outer Self", "Tribal Afterglitch"],
}

# Three hot cues on every track, so the library's Cues column shows them arriving.
CUES = [("Intro", 1.0, SeratoColor.RED), ("Drop", 32.0, SeratoColor.GREEN), ("Outro", 90.0, SeratoColor.SKY_BLUE)]

manifest = json.load(open(SRC / "manifest.json"))
by_title = {t["title"]: t for t in manifest["tracks"]}


def copy(title: str, dest_root: Path) -> tuple[Path, dict]:
    meta = by_title[title]
    src = SRC / "files" / meta["relativePath"]
    dst = dest_root / "Music" / meta["artist"].replace("*", "") / src.name
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    tags = ID3(dst)
    for key in [k for k in tags.keys() if "SUBBOX" in k.upper()]:
        del tags[key]
    tags.save(dst)
    return dst, meta


def build_rekordbox() -> None:
    root = ROOT / "rb"
    xml = RekordboxXml()
    ids: dict[str, str] = {}
    folders = {}
    for (folder, name), titles in RB.items():
        parent = xml
        if folder:
            if folder not in folders:
                folders[folder] = xml.add_playlist_folder(folder)
            parent = folders[folder]
        playlist = parent.add_playlist(name)
        for title in titles:
            if title not in ids:
                path, meta = copy(title, root)
                track = xml.add_track(
                    location=str(path), Name=meta["title"], Artist=meta["artist"],
                    Album=meta["album"], Genre=meta["genre"], Kind="MP3 File",
                    Size=path.stat().st_size, TotalTime=int(meta["durationSeconds"] or 0),
                    AverageBpm=float(meta["bpm"] or 0),
                )
                for num, (name, start, _) in enumerate(CUES):
                    track.add_mark(Name=name, Type="cue", Start=start, Num=num)
                ids[title] = track.TrackID
            playlist.add_track(ids[title])
    xml.save(root / "rekordbox.xml")
    print("rekordbox:", root / "rekordbox.xml", len(ids), "tracks")


def build_serato() -> None:
    root = ROOT / "serato"
    serato = root / "_Serato_"
    (serato / "SubCrates").mkdir(parents=True, exist_ok=True)
    tracks: dict[str, Track] = {}
    parents: dict[str, Crate] = {}
    tops: list[Crate] = []
    for (folder, name), titles in SERATO.items():
        crate = Crate(name)
        for title in titles:
            if title not in tracks:
                path, meta = copy(title, root)
                tracks[title] = Track.from_path(path)
                for index, (name, start, colour) in enumerate(CUES):
                    tracks[title].add_hot_cue(HotCue(name=name, type=HotCueType.CUE, start=int(start * 1000),
                                                     index=index, color=colour))
                # Written per track: Builder's encoder pass misses a sub-crate's tracks.
                V2Encoder().write(tracks[title])
            crate.add_track(tracks[title])
        if folder:
            if folder not in parents:
                parents[folder] = Crate(folder)
                tops.append(parents[folder])
            parents[folder].children[name] = crate
        else:
            tops.append(crate)
    for crate in tops:
        Builder().save(crate, save_path=serato, overwrite=True)
    print("serato:", sorted(p.name for p in (serato / "SubCrates").iterdir()))


# Tracks neither DJ fixture uses, so the folder guide's library looks different.
FOLDER = ["Across The Fields", "Nature", "To The Moon", "Soul In Pills", "Nearfield - Weekend",
          "Baldych - Lunar Path", "Ambient Flight (Electro Vocal Mix)", "Bassballah-Warriors"]


def build_folder() -> None:
    root = ROOT / "folder"
    for title in FOLDER:
        copy(title, root)
    print("folder:", root / "Music", len(FOLDER), "tracks")


build_rekordbox()
build_serato()
build_folder()
