#!/usr/bin/env python3
"""Copy the Pokémon GO icons the site needs from PokeMiners' pogo_assets, shrunk to WebP.

For every Pokémon in data/rankings-*.js, finds its in-game icon (form-specific when the name has a
form, e.g. "Marowak (Alolan)" -> pm105.fALOLA.icon.png), writes img/pokemon/<stem>.webp at 128 px,
and writes data/images.js mapping species id -> image stem. Shadow forms share the normal icon.
Images are only re-downloaded when their source file changed upstream.

Needs git and Pillow (pip install pillow). Run after scripts/update_data.py:
    python3 scripts/update_images.py
"""
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request

from PIL import Image

REPO = "https://github.com/PokeMiners/pogo_assets"
RAW = "https://raw.githubusercontent.com/PokeMiners/pogo_assets/master/"
FOLDER = "Images/Pokemon - 256x256/Addressable Assets"
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "img", "pokemon")
SIZE = 128
# Bump when convert() changes, so every icon is regenerated once.
FORMAT = 2
LEAGUES = ("great", "ultra", "master", "fantasy")

# PvPoke id token -> Pokémon GO form name, where they differ.
ALIAS = {"alolan": "ALOLA", "galarian": "GALARIAN", "hisuian": "HISUIAN", "paldean": "PALDEA"}

# Image form for ids the general rule cannot work out: species whose only icons are per form
# (pick the default look), and forms Pokémon GO names differently. "" means the plain icon.
OVERRIDES = {
    "basculin": "RED_STRIPED", "deerling": "SPRING", "sawsbuck": "SPRING",
    "floette": "RED", "florges": "RED", "furfrou": "NATURAL",
    "shellos": "WEST_SEA", "gastrodon": "WEST_SEA", "genesect": "NORMAL", "kyurem": "NORMAL",
    "maushold": "FAMILY_OF_THREE", "mimikyu": "DISGUISED", "minior_core": "RED", "spinda": "00",
    "squawkabilly": "GREEN", "toxtricity": "AMPED", "unown": "UNOWN_F", "vivillon": "MEADOW",
    "meowstic": "", "mewtwo_armored": "A", "oricorio_pom_pom": "POMPOM",
    "tauros_aqua": "PALDEA_AQUA", "tauros_blaze": "PALDEA_BLAZE", "tauros_combat": "PALDEA_COMBAT",
    "wormadam_plant": "WORMADAM_PLANT", "wormadam_sandy": "WORMADAM_SANDY", "wormadam_trash": "WORMADAM_TRASH",
    "zygarde": "FIFTY_PERCENT", "zygarde_10": "TEN_PERCENT",
}


def load_js(name):
    """Reads one of our generated data/*.js files back into Python."""
    with open(os.path.join(DATA, name), encoding="utf-8") as f:
        text = f.read()
    return json.loads(text[text.index("=", text.index("raw[")) + 1:].rstrip().rstrip(";"))


def list_sources():
    """{icon file name: blob sha} for the 256 px Pokémon icons, without downloading any images."""
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["git", "clone", "--quiet", "--filter=blob:none", "--no-checkout", "--depth", "1", REPO, tmp],
                       check=True)
        out = subprocess.run(["git", "-C", tmp, "ls-tree", "-r", "HEAD", "--", FOLDER],
                             check=True, capture_output=True, text=True).stdout
    sources = {}
    for line in out.splitlines():
        meta, path = line.split("\t", 1)
        sources[path.rsplit("/", 1)[-1]] = meta.split()[2]
    return sources


def form_of(pokemon):
    """The form in a PvPoke name, e.g. "Alolan" in "Marowak (Alolan)"; None for the base form."""
    name = re.sub(r"\s*\(Shadow\)", "", pokemon["name"])
    m = re.search(r"\(([^)]*)\)", name)
    return m.group(1) if m else None


def icon_for(pokemon, files):
    """Icon file name for this Pokémon, or None. Never falls back to a different form's icon."""
    base_id = pokemon["id"][:-len("_shadow")] if pokemon["id"].endswith("_shadow") else pokemon["id"]
    dex = pokemon["dex"]
    if base_id in OVERRIDES:
        form = OVERRIDES[base_id]
        name = "pm%d.f%s.icon.png" % (dex, form) if form else "pm%d.icon.png" % dex
        return name if name in files else None
    if not form_of(pokemon):
        name = "pm%d.icon.png" % dex
        return name if name in files else None
    # The id is "<species tokens>_<form tokens>"; species names can contain "_" (tapu_koko), so
    # try each split, longest form first.
    tokens = base_id.split("_")
    for k in range(1, len(tokens)):
        form = "_".join(ALIAS.get(t, t.upper()) for t in tokens[k:])
        name = "pm%d.f%s.icon.png" % (dex, form)
        if name in files:
            return name
    return None


def convert(png_bytes, path):
    """Trims the icon's transparent padding (the game pads small Pokémon heavily), centres it on a
    square canvas with a small margin, and shrinks it to SIZE px WebP."""
    img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    box = img.getchannel("A").getbbox()
    if box:
        img = img.crop(box)
    side = int(max(img.size) * 1.08) + 2
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
    canvas = canvas.resize((SIZE, SIZE), Image.LANCZOS)
    canvas.save(path, "WEBP", quality=82, method=6)


def main():
    gm = load_js("gamemaster.js")
    by_id = {p["id"]: p for p in gm["pokemon"]}
    ranked = sorted({r["id"] for league in LEAGUES for r in load_js("rankings-%s.js" % league)})

    sources = list_sources()
    if len(sources) < 1000:
        sys.exit("pogo_assets listing looks wrong: %d icons" % len(sources))

    try:
        previous = load_js("images.js")
    except (FileNotFoundError, ValueError):
        previous = {"map": {}, "sources": {}}
    if previous.get("format") != FORMAT:
        previous["sources"] = {}

    mapping, used, missing = {}, {}, []
    for pid in ranked:
        icon = icon_for(by_id[pid], sources)
        if not icon:
            missing.append("%s (%s)" % (pid, by_id[pid]["name"]))
            continue
        stem = icon[:-len(".icon.png")]
        mapping[pid] = stem
        used[stem] = icon

    os.makedirs(OUT, exist_ok=True)
    fetched = 0
    for stem, icon in sorted(used.items()):
        path = os.path.join(OUT, stem + ".webp")
        if previous["sources"].get(stem) == sources[icon] and os.path.exists(path):
            continue
        url = RAW + urllib.parse.quote(FOLDER + "/" + icon)
        with urllib.request.urlopen(url, timeout=60) as resp:
            convert(resp.read(), path)
        fetched += 1

    # Remove icons no ranked Pokémon uses any more.
    removed = 0
    for name in os.listdir(OUT):
        if name.endswith(".webp") and name[:-len(".webp")] not in used:
            os.remove(os.path.join(OUT, name))
            removed += 1

    manifest = {"format": FORMAT, "map": mapping, "sources": {stem: sources[icon] for stem, icon in sorted(used.items())}}
    with open(os.path.join(DATA, "images.js"), "w", encoding="utf-8") as f:
        f.write("// Generated by scripts/update_images.py. Icons from Pokémon GO via PokeMiners/pogo_assets;"
                " (c) Niantic and The Pokémon Company. Do not edit.\n")
        f.write("window.PvpData=window.PvpData||{raw:{}};window.PvpData.raw[\"images\"]=%s;\n"
                % json.dumps(manifest, separators=(",", ":"), sort_keys=True))

    total = sum(os.path.getsize(os.path.join(OUT, n)) for n in os.listdir(OUT))
    print("%d ranked Pokémon, %d with an icon, %d icons (%d fetched, %d removed), %d KB"
          % (len(ranked), len(mapping), len(used), fetched, removed, total // 1024))
    if missing:
        print("No icon found (shown without an image; add to OVERRIDES if the icon exists):")
        for m in missing:
            print("  " + m)


if __name__ == "__main__":
    main()
