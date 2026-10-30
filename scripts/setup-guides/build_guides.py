"""Build the six Sub-box onboarding guides plus a chooser page.

One per computer (Mac, Windows) × starting point: a quick start, dropping a few tracks
into the app (no DJ software needed), or a Rekordbox or Serato library.

Writes <out>/site/ (every page a full HTML document, ready for www.sub-box.net) and
<out>/artifact/ (the chooser as a bare body for the Artifact skeleton, the guides as
full documents published beside it). Both share img/.
"""
import shutil
import sys
from pathlib import Path

OUT = Path(sys.argv[1])
IMG = OUT / "img"
RELEASES = "https://github.com/laker-93/subbox-app/releases/latest"
# Release assets carry no version in their names (subbox-app#276), so these always
# fetch the newest build.
DOWNLOAD = RELEASES + "/download/"
DISCORD = "https://discord.gg/mqrRbex3hs"

# Where the chooser lives relative to a guide, and the guides relative to the chooser.
# On www.sub-box.net (the "app" target) the chooser is /setup.html and the guides sit
# in /setup/; elsewhere they all share one folder. Set per target below.
HOME = "index.html"
GUIDES = ""

OS_NAME = {"mac": "Mac", "windows": "Windows"}
SW_NAME = {"quick-start": "Quick start", "rekordbox": "Rekordbox", "serato": "Serato"}
SOFTWARE = ("quick-start", "rekordbox", "serato")

HEAD = """<title>{title}</title>
<meta name="description" content="{desc}">
{viewport_meta}<style>
/* Layout: one reading column, a sticky bar that switches between the four guides,
   three parts in order, each a numbered list of steps with the app's own screens. */
:root {
  --bg: #f5f6f8; --surface: #ffffff; --line: #dcdfe5; --fg: #14161a; --muted: #5b6372;
  --accent: #2b5cf0; --accent-fg: #ffffff; --accent-soft: #e6ecfe; --note: #fff6e0; --note-line: #f0d48a;
  --shot-bg: #0c0d0f;
  /* System fonts only: a font CDN would send every visitor's IP to a third party
     that sub-box.net's privacy notice doesn't name. */
  --display: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --body: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0c0d0f; --surface: #15171b; --line: #272b33; --fg: #eceef2; --muted: #9aa2b0;
  --accent: #4772ff; --accent-fg: #ffffff; --accent-soft: #18213d; --note: #241f12; --note-line: #5a4a1f;
  color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #0c0d0f; --surface: #15171b; --line: #272b33; --fg: #eceef2; --muted: #9aa2b0;
  --accent: #4772ff; --accent-fg: #ffffff; --accent-soft: #18213d; --note: #241f12; --note-line: #5a4a1f;
  color-scheme: dark; }

* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 400 17px/1.6 var(--body); -webkit-font-smoothing: antialiased; }
a { color: var(--accent); text-underline-offset: 3px; }
a:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 6px; }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--bg); }

.bar { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); }
.bar-in, .wrap { max-width: 780px; margin: 0 auto; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.bar-in { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding-block: 10px; }
.mark { display: flex; align-items: center; gap: 8px; font: 700 18px/1 var(--display); color: var(--fg); text-decoration: none; margin-right: auto; }
.mark svg { width: 22px; height: 22px; }
.seg { display: inline-flex; padding: 3px; gap: 2px; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; }
.seg a { padding: 4px 11px; border-radius: 6px; font-size: 14px; font-weight: 500; color: var(--muted); text-decoration: none; }
.seg a[aria-current="page"] { background: var(--accent-soft); color: var(--fg); }
.seg a:hover { color: var(--fg); }

.wrap { padding-block: 40px 72px; display: grid; gap: 48px; }
header.hero { display: grid; gap: 14px; }
.eyebrow { font: 600 12px/1 var(--body); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
h1 { font: 700 clamp(30px, 6vw, 42px)/1.12 var(--display); letter-spacing: -.01em; margin: 0; text-wrap: balance; }
h2 { font: 700 24px/1.25 var(--display); margin: 0; text-wrap: balance; }
.lede { margin: 0; color: var(--muted); max-width: 62ch; }

section.part { display: grid; gap: 20px; }
.part-head { display: grid; gap: 4px; padding-top: 4px; border-top: 1px solid var(--line); }
.part-head .eyebrow { padding-top: 22px; }
ol.steps { list-style: none; margin: 0; padding: 0; counter-reset: step; display: grid; gap: 26px; }
ol.steps > li { counter-increment: step; display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 0 14px; }
ol.steps > li::before { content: counter(step); grid-row: 1 / span 20; width: 30px; height: 30px; border-radius: 50%;
  display: grid; place-items: center; background: var(--accent); color: var(--accent-fg); font: 600 15px/1 var(--body); font-variant-numeric: tabular-nums; margin-top: 1px; }
ol.steps > li > * { grid-column: 2; min-width: 0; }
ol.steps p { margin: 0 0 8px; max-width: 64ch; }
ol.steps p:last-child { margin-bottom: 0; }
ol.steps ul { margin: 4px 0 8px; padding-left: 20px; display: grid; gap: 4px; }

.ui { display: inline-block; padding: 0 7px; border-radius: 5px; background: var(--accent); color: var(--accent-fg); font-weight: 600; font-size: .92em; line-height: 1.6; white-space: nowrap; }
.menu { font-family: var(--mono); font-size: .86em; padding: 1px 6px; border: 1px solid var(--line); border-radius: 5px; background: var(--surface); white-space: normal; }
.menu i { font-style: normal; color: var(--muted); padding: 0 2px; }
code, .file { font-family: var(--mono); font-size: .86em; background: var(--surface); border: 1px solid var(--line); border-radius: 5px; padding: 1px 5px; overflow-wrap: anywhere; }
.quote { font-weight: 600; }

figure { margin: 12px 0 4px; display: grid; gap: 8px; }
figure img { display: block; width: 100%; height: auto; border-radius: 10px; border: 1px solid var(--line); background: var(--shot-bg); }
figure.narrow img { max-width: 360px; }
figure.mid img { max-width: 540px; }
figcaption { font-size: 14px; color: var(--muted); }

.note { margin: 10px 0 2px; padding: 12px 14px; border-radius: 10px; background: var(--note); border: 1px solid var(--note-line); font-size: 15.5px; display: grid; gap: 6px; }
.note p { margin: 0; }
.note strong { font-weight: 600; }
.cmd { display: flex; gap: 8px; align-items: stretch; flex-wrap: wrap; }
.cmd code { flex: 1 1 240px; padding: 8px 10px; font-size: 14px; }
.cmd button { font: 600 14px/1 var(--body); padding: 0 14px; min-height: 36px; border-radius: 6px; border: 1px solid var(--line); background: var(--surface); color: var(--fg); cursor: pointer; }
.btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 8px; background: var(--accent); color: var(--accent-fg); font-weight: 600; text-decoration: none; margin: 4px 0 8px; }
.btn:hover { filter: brightness(1.08); }
.btn.alt { background: var(--surface); color: var(--fg); border: 1px solid var(--line); }
p:has(> .btn) { display: flex; flex-wrap: wrap; gap: 0 10px; }
/* Matches the numbered amber outlines drawn on the screenshots. */
.n { display: inline-grid; place-items: center; width: 1.35em; height: 1.35em; border-radius: 50%; background: #ffb020; color: #14161a; font-weight: 700; font-size: .8em; vertical-align: .1em; }

details { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); padding: 0 16px; }
details + details { margin-top: 10px; }
summary { cursor: pointer; padding: 13px 0; font-weight: 600; }
details p { margin: 0 0 14px; max-width: 64ch; }
footer { color: var(--muted); font-size: 15px; border-top: 1px solid var(--line); padding-top: 22px; }

/* Chooser */
.choose { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.card { display: grid; gap: 6px; padding: 20px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); color: var(--fg); text-decoration: none; }
.card:hover { border-color: var(--accent); }
.card b { font: 700 19px/1.3 var(--display); }
.card span { color: var(--muted); font-size: 15px; }
@media (max-width: 560px) { .choose { grid-template-columns: minmax(0, 1fr); } body { font-size: 16px; } }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
</style>"""

LOGO = ('<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="4" fill="currentColor" opacity=".12"/>'
        '<g stroke="currentColor" stroke-width="1.8" stroke-linecap="round">'
        '<path d="M5 10v4M8 7v10M11 9v6M14 5v14M17 8v8M20 11v2"/></g></svg>')

COPY_JS = """<script>
document.querySelectorAll('[data-copy]').forEach(function (b) {
  b.addEventListener('click', function () {
    var code = document.getElementById(b.getAttribute('data-copy'));
    var done = function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1600); };
    var select = function () { var r = document.createRange(); r.selectNodeContents(code); var s = getSelection(); s.removeAllRanges(); s.addRange(r); };
    try { navigator.clipboard.writeText(code.textContent).then(done, select); } catch (e) { select(); }
  });
});
</script>"""


def page_name(os_, sw):
    return f"{os_}-{sw}.html"


def bar(os_=None, sw=None):
    def seg(items, current, link):
        here = ' aria-current="page"'
        return '<nav class="seg" aria-label="{}">{}</nav>'.format(
            items[0][2],
            "".join(f'<a href="{link(k)}"{here if k == current else ""}>{label}</a>'
                    for k, label, _ in items))
    inner = f'<a class="mark" href="{HOME if os_ else ""}">{LOGO}Sub-box</a>'
    if os_:
        inner += seg([("mac", "Mac", "Computer"), ("windows", "Windows", "Computer")], os_,
                     lambda k: page_name(k, sw))
        inner += seg([(k, SW_NAME[k], "Starting point") for k in SOFTWARE], sw,
                     lambda k: page_name(os_, k))
    return f'<div class="bar"><div class="bar-in">{inner}</div></div>'


def fig(src, alt, caption=None, size=""):
    cls = f' class="{size}"' if size else ""
    cap = f"<figcaption>{caption}</figcaption>" if caption else ""
    return f'<figure{cls}><img src="img/{src}.png" alt="{alt}" loading="lazy">{cap}</figure>'


def ui(text):
    return f'<span class="ui">{text}</span>'


def menu(*parts):
    return '<span class="menu">' + "<i>›</i>".join(parts) + "</span>"


def install_mac():
    return f"""
<li><p><strong>Download Sub-box.</strong> Click the button for your Mac:</p>
<p><a class="btn" href="{DOWNLOAD}Subbox-mac-arm64.dmg">Download for Apple silicon (M1 or later)</a>
<a class="btn alt" href="{DOWNLOAD}Subbox-mac-x64.dmg">Download for Intel Mac</a></p>
<details><summary>Not sure which Mac you have?</summary>
<p>Click the Apple menu, then {menu("About This Mac")}. <span class="quote">Chip: Apple M1</span> (or M2, M3, M4…) means Apple silicon. <span class="quote">Processor: Intel</span> means Intel.</p></details></li>

<li><p><strong>Install it.</strong> Open the <span class="file">.dmg</span> you downloaded and drag <span class="quote">Subbox</span> onto the <span class="quote">Applications</span> folder in the same window.</p></li>

<li><p><strong>Open it once.</strong> Double-click <span class="quote">Subbox</span> in your Applications folder. Your Mac stops it with a message that starts <span class="quote">“Subbox” Not Opened</span> or <span class="quote">Apple could not verify…</span>. Click <span class="quote">Done</span>, not Move to Trash.</p></li>

<li><p><strong>Allow it.</strong> Open {menu("System Settings", "Privacy & Security")} and scroll down. Next to <span class="quote">“Subbox” was blocked</span>, click <span class="quote">Open Anyway</span>, enter your Mac password, then click <span class="quote">Open Anyway</span> again. Sub-box opens.</p>
<div class="note"><p><strong>Why?</strong> Sub-box isn’t from the App Store yet, so macOS asks you to confirm you trust it. You only do this once.</p></div>
<details><summary>Still not working?</summary>
<p>Open Terminal (Applications › Utilities), paste this line, press Return, then open Sub-box again:</p>
<div class="cmd"><code id="xattr">xattr -cr /Applications/Subbox.app</code><button type="button" data-copy="xattr">Copy</button></div>
<p></p></details></li>"""


def install_windows():
    return f"""
<li><p><strong>Download Sub-box.</strong> This one file works on every Windows PC.</p>
<p><a class="btn" href="{DOWNLOAD}Subbox-win.exe">Download for Windows</a></p>
<p>If your browser says the file isn’t commonly downloaded, choose <span class="quote">Keep</span>. In Edge, that’s the <span class="quote">…</span> menu, then <span class="quote">Keep</span>, <span class="quote">Show more</span>, <span class="quote">Keep anyway</span>.</p></li>

<li><p><strong>Run it.</strong> Open the file you downloaded. Windows shows a blue box, <span class="quote">Windows protected your PC</span>. Click <span class="quote">More info</span>, then <span class="quote">Run anyway</span>.</p>
<div class="note"><p><strong>Why?</strong> Sub-box isn’t signed with a Microsoft certificate yet, so Windows asks you to confirm you trust it. You only see this when installing.</p></div></li>

<li><p><strong>Finish installing.</strong> Keep the default choices and click through to <span class="quote">Finish</span>. Sub-box opens, and there’s a shortcut on your desktop.</p></li>"""


def sign_in():
    return f"""
<li><p><strong>Click {ui("Login")}</strong></p>
{fig("landing", "The Sub-box start screen, with the Login button outlined")}</li>
<li><p><strong>Enter your username and password</strong> and click {ui("Login")}. Leave <span class="quote">Remember me</span> ticked so you stay signed in.</p>
{fig("login", "The login box, with the Login button outlined", size="narrow")}</li>"""


def mac_allow(folders):
    return ("<div class=\"note\"><p>If your Mac asks whether Sub-box can access your " + folders + " folder, click "
            "<span class=\"quote\">Allow</span>.</p></div>")


def upload_rekordbox(os_):
    allow = mac_allow("Documents or Music") if os_ == "mac" else ""
    # Taken by hand in Rekordbox on a Mac (#281); there's no Windows one.
    export = (fig("rb-export", "Rekordbox on a Mac with the File menu open and Export Collection in xml format highlighted") + "\n"
              if os_ == "mac" else "")
    return f"""
<li><p><strong>Export your collection from Rekordbox.</strong> In Rekordbox, choose {menu("File", "Export Collection in xml format")} and save the file in your Documents folder.</p>
{export}<div class="note"><p>Sub-box finds each track where Rekordbox says it is, so don’t move or rename music files before you upload.</p></div></li>

<li><p><strong>Pick the file in Sub-box.</strong> Click <span class="quote">Sync</span> at the top right <span class="n">1</span>, choose <span class="quote">Rekordbox</span> <span class="n">2</span>, then click {ui("Select XML File")} <span class="n">3</span> and pick the file you just saved.</p>
{fig("rb-start", "The Sync screen: Sync, Rekordbox and Select XML File outlined and numbered 1 to 3")}{allow}</li>

<li><p><strong>Click {ui("Upload")}.</strong> Every playlist is ticked. Untick any you don’t want to send. Leave <span class="quote">Import metadata only</span> unticked.</p>
{fig("rb-preview", "Preview Changes: three playlists ticked, 13 tracks, with the Upload button outlined")}</li>

<li><p><strong>Wait for <span class="quote">Upload Complete</span>.</strong> Keep Sub-box open while it works. A big library can take a while.</p>
{fig("rb-done", "Upload Complete: 13 tracks uploaded and imported", size="mid")}</li>

<li><p><strong>Find your playlists.</strong> Click <span class="quote">Library</span> at the top right. Your playlists are in the sidebar, in the same folders as in Rekordbox, with their cue points.</p>
{fig("rb-playlist", "The Warm Up playlist open inside the Gigs folder, each track showing 3 cues")}</li>"""


def upload_serato(os_):
    path = "/Users/<i>you</i>/Music/_Serato_" if os_ == "mac" else r"C:\Users\<i>you</i>\Music\_Serato_"
    allow = mac_allow("Music") if os_ == "mac" else ""
    return f"""
<li><p><strong>Quit Serato DJ.</strong> Serato saves your crates when it closes, so Sub-box then reads your latest changes.</p></li>

<li><p><strong>Read your library in Sub-box.</strong> Click <span class="quote">Sync</span> at the top right <span class="n">1</span>, choose <span class="quote">Serato</span> <span class="n">2</span>, then click {ui("Read Library")} <span class="n">3</span>. Sub-box finds your Serato folder by itself, usually <span class="file">{path}</span>. Nothing is uploaded yet.</p>
{fig("se-start", "The Sync screen: Sync, Serato and Read Library outlined and numbered 1 to 3")}{allow}
<details><summary>It says “No Serato library found”, or my library is on an external drive</summary>
<p>Click the gear next to <span class="quote">Sync From Serato</span>, then <span class="quote">Change Serato Folder</span>, and pick your <span class="file">_Serato_</span> folder. On an external drive it’s at the top level of the drive.</p>
{fig("se-settings", "Upload Settings with Change Serato Folder outlined", size="mid")}</details></li>

<li><p><strong>Click {ui("Upload")}.</strong> Every crate is ticked. Untick any you don’t want to send. Leave <span class="quote">Playlists only</span> unticked.</p>
{fig("se-preview", "Preview Changes: three crates ticked, 11 tracks, with the Upload button outlined")}</li>

<li><p><strong>Wait for <span class="quote">Import Complete</span>.</strong> Keep Sub-box open while it works. A big library can take a while.</p>
{fig("se-done", "Import Complete: 11 tracks uploaded and imported", size="mid")}</li>

<li><p><strong>Find your crates.</strong> Click <span class="quote">Library</span> at the top right. Each crate is now a playlist in the sidebar, subcrates sit inside folders, and your hot cues come with them.</p>
{fig("se-playlist", "The Warm Up playlist open inside the Gigs folder, each track showing 3 cues")}</li>"""


def upload_drop(os_):
    return f"""
<li><p><strong>Open the drop box.</strong> Click <span class="quote">Sync</span> at the top right <span class="n">1</span>, then <span class="quote">Watch</span> <span class="n">2</span>. Under the folder watcher there’s a box that says <span class="quote">Drop audio files or a folder here</span> <span class="n">3</span>.</p>
{fig("dz-start", "The Sync screen: Sync, Watch and the Drop Files box outlined and numbered 1 to 3")}
<div class="note"><p>Using Sub-box in a web browser instead? The same box is under {menu("Sync", "Add Files")}.</p></div></li>

<li><p><strong>Drag a few tracks onto the box.</strong> A handful of favourites is enough to try Sub-box. You can also drop a whole folder, or click {ui("Choose Files")} or {ui("Choose Folder")} instead of dragging.</p>
<div class="note"><p>Your files stay as they are. Sub-box uploads a copy and doesn’t change the files on your computer.</p></div></li>

<li><p><strong>Wait for <span class="quote">tracks added to your library</span>.</strong> It shows <span class="quote">Uploading</span>, then <span class="quote">Importing</span> while Sub-box sorts the tracks into your library. Keep Sub-box open until it finishes.</p>
{fig("dz-done", "The Drop Files box with the message 4 tracks added to your library")}</li>

<li><p><strong>Find your tracks.</strong> Click <span class="quote">Library</span> at the top right, then <span class="quote">Tracks</span> in the sidebar. Click one to play it.</p>
{fig("dz-library", "The Tracks page listing the 4 dropped tracks, with Tracks outlined in the sidebar")}</li>"""


def watch_folder(os_):
    allow = mac_allow("Music, Downloads or Documents") if os_ == "mac" else ""
    return f"""
<section class="part" aria-labelledby="p3b"><div class="part-head"><div class="eyebrow">Optional</div><h2 id="p3b">Upload new music automatically</h2></div>
<p class="lede">If you save new tracks into one folder, Sub-box can watch it and upload anything that lands there.</p>
<ol class="steps">
<li><p><strong>Pick the folder.</strong> On the same <span class="quote">Watch</span> screen, click {ui("Select Directory")} <span class="n">1</span> and choose the folder (the button then reads <span class="quote">Change Directory</span>). Folders inside it are included. Then click {ui("Start Watching")} <span class="n">2</span>.</p>
{fig("wa-ready", "The Watch screen with the chosen folder, Change Directory and Start Watching outlined and numbered 1 and 2")}{allow}
<div class="note"><p>Sub-box uploads every track already in the folder, then each new one you save there, for as long as the app is open. It doesn’t move, rename or convert them, but it does add a small ID tag to each file so it can recognise the track later. Click <span class="quote">Stop Watching</span> to turn it off.</p></div></li>
</ol></section>"""


def troubleshooting_drop():
    return f"""
<details><summary>Some files were “skipped”</summary>
<p>Sub-box uploads MP3, FLAC, WAV, AAC, M4A, OGG, Opus and WMA files. Anything else, empty files and folders whose name starts with a dot are skipped, and the list says why. Everything else uploads normally.</p></details>
<details><summary>Some tracks “have not reached your library”</summary>
<p>They uploaded, but Sub-box couldn’t add them to your library, usually because the file is damaged. Take a screenshot and send it to us on <a href="{DISCORD}" target="_blank" rel="noopener">Discord</a>.</p></details>
<details><summary>It says “Storage Limit Reached”</summary>
<p>What you dropped adds up to more than the space left on your account. Nothing was uploaded. Drop fewer tracks and try again.</p></details>
<details><summary>A track shows up twice after I uploaded my Rekordbox or Serato library</summary>
<p>Sub-box tags the copy it keeps, not the file on your computer, so it can’t tell that a dropped track and the same track from your DJ library are one track. If you plan to upload your library later, try Sub-box with tracks that aren’t in it, or delete the dropped copies afterwards.</p></details>"""


def next_steps(os_):
    links = " or ".join(f'<a href="{page_name(os_, s)}">{SW_NAME[s]}</a>' for s in ("rekordbox", "serato"))
    return f"""
<section class="part" aria-labelledby="p5"><div class="part-head"><div class="eyebrow">When you’re ready</div><h2 id="p5">Bring in your playlists and cue points</h2></div>
<p class="lede">Dropping files brings in tracks. If you use {links}, upload your library from there and Sub-box adds your playlists, folders, cue points and beatgrids.</p></section>"""


def troubleshooting(sw):
    container = "playlist" if sw == "rekordbox" else "crate"
    if sw == "rekordbox":
        # The Rekordbox screen's own words (sync-rekordbox.tsx), which differ from Serato's (#283).
        skipped = """<details><summary>Some tracks are “skipped (file not found, or already uploaded)”</summary>
<p>This covers two different things: a file that was moved or deleted after Rekordbox last saw it, or a track you already uploaded in an earlier sync (harmless). Everything else uploaded normally. If you think a track is missing, check Rekordbox for a warning icon on it, export the collection again, then put the fixed tracks in a new playlist and upload just that one.</p></details>"""
    else:
        skipped = f"""<details><summary>Some tracks “could not be read from this computer”</summary>
<p>Those files were moved or deleted after Serato last saw them. Everything else uploaded normally. In Serato, use <span class="quote">Relocate Lost Files</span> to find them. Then put the fixed tracks in a new crate and upload just that one.</p></details>"""
    return f"""
<details><summary>It says “Storage Limit Reached”</summary>
<p>The playlists you ticked add up to more than the space on your account. Nothing was uploaded. Go back, untick some {container}s and try again.</p></details>
{skipped}
<details><summary>The upload failed</summary>
<p>Click <span class="quote">Copy details</span> on the error screen and paste it to us on <a href="{DISCORD}" target="_blank" rel="noopener">Discord</a>. Your library isn’t changed by a failed upload, so it’s safe to click <span class="quote">Retry</span>.</p></details>
<details><summary>I want to add more music later</summary>
<p>Do the upload part again and tick only the new {container}s. Tracks you add to {SW_NAME[sw]} later need a new upload to appear in Sub-box.</p></details>"""


def guide(os_, sw):
    install = install_mac() if os_ == "mac" else install_windows()
    if sw == "quick-start":
        title = f"Try Sub-box on {OS_NAME[os_]}"
        desc = f"Install the Sub-box desktop app on a {OS_NAME[os_]} and drag in a few tracks to try it. No DJ software needed."
        eyebrow = f"{OS_NAME[os_]} · Quick start"
        h1 = "Try Sub-box with a few tracks"
        part3 = "Drop in a few tracks"
        upload, trouble = upload_drop(os_), troubleshooting_drop()
        extra, after = watch_folder(os_), next_steps(os_)
    else:
        thing = "playlists" if sw == "rekordbox" else "crates"
        title = f"Sub-box for {SW_NAME[sw]} on {OS_NAME[os_]}"
        desc = f"Install the Sub-box desktop app on a {OS_NAME[os_]} and upload your {SW_NAME[sw]} playlists."
        eyebrow = f"{OS_NAME[os_]} · {SW_NAME[sw]}"
        h1 = f"Export from {SW_NAME[sw]} to Sub-box"
        part3 = f"Upload your {SW_NAME[sw]} {thing}"
        upload = upload_rekordbox(os_) if sw == "rekordbox" else upload_serato(os_)
        trouble, extra, after = troubleshooting(sw), "", ""
    update = ("When a new version comes out, Sub-box tells you. Get it with the same download button and repeat steps 2 to 4."
              if os_ == "mac" else "Sub-box checks for new versions when it starts.")
    body = f"""{bar(os_, sw)}
<main class="wrap">
<header class="hero">
<div class="eyebrow">Getting started · {eyebrow}</div>
<h1>{h1}</h1>
</header>

<section class="part" aria-labelledby="p1"><div class="part-head"><div class="eyebrow">Part 1 of 3</div><h2 id="p1">Install Sub-box</h2></div>
<ol class="steps">{install}</ol>
<p class="lede">{update}</p></section>

<section class="part" aria-labelledby="p2"><div class="part-head"><div class="eyebrow">Part 2 of 3</div><h2 id="p2">Sign in</h2></div>
<ol class="steps">{sign_in()}</ol></section>

<section class="part" aria-labelledby="p3"><div class="part-head"><div class="eyebrow">Part 3 of 3</div><h2 id="p3">{part3}</h2></div>
<ol class="steps">{upload}</ol></section>
{extra}

<section class="part" aria-labelledby="p4"><div class="part-head"><div class="eyebrow">If something goes wrong</div><h2 id="p4">Common problems</h2></div>
<div>{trouble}</div></section>
{after}
<footer>Stuck? Ask on the Sub-box <a href="{DISCORD}" target="_blank" rel="noopener">Discord</a>. Starting from somewhere else, or on a different computer? Switch guide at the top of the page.</footer>
</main>
{COPY_JS}"""
    return HEAD.replace("{title}", title).replace("{desc}", desc), body


def chooser():
    def on(o):
        return "a Mac" if o == "mac" else "Windows"
    start = "".join(
        f'<a class="card" href="{GUIDES}{page_name(o, "quick-start")}"><b>Quick start on {OS_NAME[o]}</b>'
        f'<span>Install on {on(o)}, then drag a few tracks into the app to try it. No DJ software needed.</span></a>'
        for o in ("mac", "windows"))
    dj = "".join(
        f'<a class="card" href="{GUIDES}{page_name(o, s)}"><b>{SW_NAME[s]} on {OS_NAME[o]}</b>'
        f'<span>Install on {on(o)}, then upload your {SW_NAME[s]} '
        f'{"playlists" if s == "rekordbox" else "crates"} with their cue points.</span></a>'
        for s in ("rekordbox", "serato") for o in ("mac", "windows"))
    body = f"""{bar()}
<main class="wrap">
<header class="hero">
<div class="eyebrow">Getting started</div>
<h1>Get your music onto Sub-box</h1>
<p class="lede">Two ways in: drag a few tracks into the app to try it, or go straight to your Rekordbox or Serato library and bring its playlists and cue points with it. Each guide takes you from downloading the app to hearing your music in Sub-box, in about ten minutes plus upload time.</p>
</header>
<section class="part" aria-labelledby="c1"><div class="part-head"><div class="eyebrow">Try it first</div><h2 id="c1">Drop in a few tracks</h2></div>
<div class="choose">{start}</div></section>
<section class="part" aria-labelledby="c2"><div class="part-head"><div class="eyebrow">Use Rekordbox or Serato?</div><h2 id="c2">Bring your playlists and cue points</h2></div>
<div class="choose">{dj}</div></section>
<footer>Stuck? Ask on the Sub-box <a href="{DISCORD}" target="_blank" rel="noopener">Discord</a>.</footer>
</main>"""
    return HEAD.replace("{title}", "Sub-box Getting Started").replace("{desc}", "Install Sub-box and drag in a few tracks to try it, or upload your Rekordbox or Serato library."), body


def full_doc(head, body):
    return f'<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n{head}\n</head>\n<body>\n{body}\n</body>\n</html>\n'


USED = ({"landing", "login"} | {f"{p}-{n}" for p in ("rb", "se") for n in ("start", "preview", "done", "playlist")}
        | {"rb-export", "se-settings", "wa-ready"} | {f"dz-{n}" for n in ("start", "done", "library")})

VIEWPORT_META = '<meta name="claude:viewport-fit-sides" content="cover">\n'


def write(target, chooser_path, guide_dir):
    """Write the chooser to <target>/<chooser_path> and the guides plus img/ to <target>/<guide_dir>."""
    global HOME, GUIDES
    d = OUT / target
    g = d / guide_dir
    (g / "img").mkdir(parents=True, exist_ok=True)
    for png in IMG.glob("*.png"):
        if png.stem in USED:
            shutil.copy2(png, g / "img" / png.name)
    HOME = "../" + chooser_path if guide_dir else chooser_path
    GUIDES = guide_dir + "/" if guide_dir else ""
    meta = VIEWPORT_META if target == "artifact" else ""
    head, body = chooser()
    head = head.replace("{viewport_meta}", meta)
    (d / chooser_path).write_text(full_doc(head, body) if target != "artifact" else f"{head}\n{body}\n")
    for o in ("mac", "windows"):
        for s in SOFTWARE:
            head, body = guide(o, s)
            (g / page_name(o, s)).write_text(full_doc(head.replace("{viewport_meta}", meta), body))


write("site", "index.html", "")
write("artifact", "index.html", "")
# www.sub-box.net: copy app/ into subbox-app's src/renderer/public/ (setup.html + setup/).
write("app", "setup.html", "setup")
print("built", OUT)
