#!/usr/bin/env python3
"""Rigenera js/articles.js dai file Markdown in content/articoli/.

Il sito statico legge solo questo file: chi visita le pagine non esegue alcuna build.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTENT = ROOT / "content" / "articoli"
COMUNI = ROOT / "data" / "comuni.json"
OUT = ROOT / "js" / "articles.js"

PUBLIC_KEYS = ("slug", "nome", "alboUrl", "alboVerificato", "sitoIstituzionale")


def parse_scalar(raw: str):
    value = raw.strip()
    if not value:
        return ""
    if value.lower() == "true":
        return True
    if value.lower() == "false":
        return False
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        body = value[1:-1]
        return body.replace('\\"', '"').replace("\\n", "\n")
    return value


def parse_front_matter(text: str):
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if not text.startswith("---\n"):
        raise ValueError("manca il front matter iniziale")
    end = text.find("\n---", 4)
    if end == -1:
        raise ValueError("front matter non chiuso")
    raw = text[4:end]
    body = text[end + 4 :].lstrip("\n")
    data = {}
    for line in raw.split("\n"):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if ":" not in line:
            continue
        key, val = line.split(":", 1)
        data[key.strip()] = parse_scalar(val)
    return data, body


def image_path(value) -> str:
    if value is None or value is False:
        return ""
    if isinstance(value, list):
        return image_path(value[0]) if value else ""
    if isinstance(value, dict):
        for key in ("src", "path", "url", "immagine"):
            if value.get(key):
                return str(value[key])
        return ""
    return str(value).strip()


def load_articles():
    articles = []
    if not CONTENT.is_dir():
        return articles
    for path in sorted(CONTENT.glob("*.md")):
        meta, body = parse_front_matter(path.read_text(encoding="utf-8"))
        titolo = str(meta.get("titolo") or "").strip()
        if not titolo:
            raise SystemExit(f"{path.name}: manca il titolo")
        data = str(meta.get("data") or "").strip()
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", data):
            raise SystemExit(f"{path.name}: data non valida ({data!r}), usare AAAA-MM-GG")
        comune = str(meta.get("comune") or "").strip()
        if not comune:
            raise SystemExit(f"{path.name}: manca il comune")
        estratto = str(meta.get("estratto") or "").strip()
        testo = body.strip()
        if not estratto:
            estratto = re.sub(r"\s+", " ", testo)[:180]
        article = {
            "id": path.stem,
            "titolo": titolo,
            "data": data,
            "comune": comune,
            "estratto": estratto,
            "testo": testo,
        }
        if meta.get("esempio") is True:
            article["esempio"] = True
        immagine = image_path(meta.get("immagine"))
        if immagine:
            article["immagine"] = immagine
        articles.append(article)
    articles.sort(key=lambda a: (a["data"], a["id"]), reverse=True)
    return articles


def main():
    comuni_raw = json.loads(COMUNI.read_text(encoding="utf-8"))
    comuni = [{key: item[key] for key in PUBLIC_KEYS} for item in comuni_raw]
    payload = {
        "gruppo": "Movimento 5 Stelle – Gruppo Territoriale Lepini Ausoni",
        "gruppoBreve": "GT Lepini Ausoni",
        "territorio": "Provincia di Latina, Lazio",
        "comuni": comuni,
        "articles": load_articles(),
    }
    encoded = json.dumps(payload, ensure_ascii=False, indent=2)
    encoded = encoded.replace("<", "\\u003c")
    text = (
        "/* Generato da scripts/build_index.py. Non modificare a mano:\n"
        "   gli articoli si scrivono in content/articoli/ (anche da Pages CMS). */\n"
        "window.M5S_DATA = "
        + encoded
        + ";\n"
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text, encoding="utf-8")
    print(f"Scritti {len(payload['articles'])} articoli in {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
