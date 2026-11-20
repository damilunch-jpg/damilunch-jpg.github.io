#!/usr/bin/env python3
"""Notizie ufficiali del Movimento 5 Stelle nazionale e del Lazio.

Legge solo i feed RSS (titolo, link, data, description/summary).
Non scarica le pagine degli articoli e non conserva il testo integrale.
"""

from __future__ import annotations

import html
import json
import os
import re
import ssl
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "m5s.json"
JS_PATH = ROOT / "js" / "m5s.js"

ROME = ZoneInfo("Europe/Rome")
ROME_HOURS = {9, 17}
GIORNI = 60
MAX_NUOVE = 3
ANTEPRIMA_MAX = 250
TIMEOUT = 25
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# Feed verificati sul sito ufficiale movimento5stelle.eu.
# Il tag Lazio è il feed indicato dalla pagina ufficiale «Lazio».
FEEDS = [
    {
        "id": "nazionale",
        "nome": "Movimento 5 Stelle",
        "etichetta": "Dal Nazionale",
        "url": "https://www.movimento5stelle.eu/feed/",
        "logo": "img/m5s/movimento5stelle.png",
    },
    {
        "id": "regionale",
        "nome": "Movimento 5 Stelle Lazio",
        "etichetta": "Dal Regionale",
        "url": "https://www.movimento5stelle.eu/tag/lazio/feed/",
        "logo": "img/m5s/movimento5stelle.png",
    },
]


def now_rome() -> datetime:
    return datetime.now(ROME)


def scheduled_should_run(schedule: str, offset_hours: float) -> bool:
    parts = (schedule or "").split()
    if len(parts) < 2:
        return False
    try:
        minute = int(parts[0])
        hour = int(parts[1])
    except ValueError:
        return False
    total = hour * 60 + minute + int(round(offset_hours * 60))
    total %= 24 * 60
    rome_hour, rome_minute = divmod(total, 60)
    return rome_minute == 0 and rome_hour in ROME_HOURS


def should_run() -> bool:
    event = os.environ.get("GITHUB_EVENT_NAME", "")
    if event != "schedule":
        return True
    offset = now_rome().utcoffset().total_seconds() / 3600
    return scheduled_should_run(os.environ.get("M5S_SCHEDULE", ""), offset)


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def fetch(url: str) -> bytes:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": UA, "Accept": "application/rss+xml, application/xml, text/xml"},
    )
    ctx = ssl.create_default_context()
    last = None
    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx) as resp:
                raw = resp.read(2_000_000)
            head = raw[:250].lstrip().lower()
            if not (head.startswith(b"<?xml") or head.startswith(b"<rss") or b"<rss" in head[:300]):
                raise ValueError("la risposta non è un feed RSS")
            return raw
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            last = exc
            time.sleep(2 + attempt * 3)
    raise RuntimeError(str(last))


def child_text(node: ET.Element, names: set[str]) -> str:
    for el in list(node):
        if local_name(el.tag) in names:
            return "".join(el.itertext()).strip()
    return ""


def parse_when(value: str):
    value = (value or "").strip()
    if not value:
        return None
    try:
        dt = parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        dt = None
    if dt is None:
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(ROME)


def clean_text(raw: str) -> str:
    text = html.unescape(raw or "")
    text = re.sub(r"(?is)<(script|style)\b[^>]*>.*?</\1>", " ", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = text.replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s*(leggi tutto|continua a leggere|read more)\.?$", "", text, flags=re.I)
    text = re.sub(r"\s*L'articolo\s.+?\sproviene da\s.+$", "", text, flags=re.I)
    return text.strip()


def anteprima(raw: str) -> str:
    text = clean_text(raw)
    troncata = bool(re.search(r"(?:\[\s*(?:\.\.\.|…)\s*\]|…)\s*$", text))
    text = re.sub(r"\s*\[\s*(?:\.\.\.|…)\s*\]\s*$", "", text).strip()
    if len(text) <= ANTEPRIMA_MAX and not troncata:
        return text
    if len(text) <= ANTEPRIMA_MAX - 1:
        if text and text[-1].isalpha():
            space = text.rfind(" ")
            if space >= 40:
                text = text[:space]
        return text.rstrip(" ,;:.-–—") + "…"
    cut = text[: ANTEPRIMA_MAX - 1]
    space = cut.rfind(" ")
    if space >= 180:
        cut = cut[:space]
    return cut.rstrip(" ,;:.-–—") + "…"


def normalizza_url(url: str) -> str:
    parts = urlsplit((url or "").strip())
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not k.lower().startswith("utm_")]
    path = parts.path.rstrip("/") or "/"
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, "&".join(f"{k}={v}" for k, v in query), ""))


def parse_feed(raw: bytes, feed: dict, limite: datetime) -> list[dict]:
    root = ET.fromstring(raw)
    out = []
    for node in root.iter():
        if local_name(node.tag) not in {"item", "entry"}:
            continue
        titolo = clean_text(child_text(node, {"title"}))
        link = child_text(node, {"link"}).strip()
        if not link:
            for el in list(node):
                if local_name(el.tag) == "link" and el.get("href"):
                    link = el.get("href", "").strip()
                    break
        descrizione = child_text(node, {"description", "summary"})
        when = parse_when(child_text(node, {"pubDate", "date", "published", "updated"}))
        if not titolo or not link or when is None:
            continue
        if when < limite:
            continue
        out.append(
            {
                "url": normalizza_url(link),
                "titolo": titolo,
                "anteprima": anteprima(descrizione),
                "data": when.date().isoformat(),
                "fonte": feed["id"],
                "fonteNome": feed["nome"],
                "etichetta": feed["etichetta"],
                "logo": feed["logo"],
            }
        )
    out.sort(key=lambda item: (item["data"], item["titolo"]), reverse=True)
    return out


def carica() -> dict:
    if not DATA_PATH.exists():
        return {"aggiornato": "", "fonti": [], "voci": []}
    return json.loads(DATA_PATH.read_text(encoding="utf-8"))


def entro_finestra(item: dict, limite: datetime) -> bool:
    try:
        giorno = datetime.fromisoformat(item["data"]).replace(tzinfo=ROME)
    except (KeyError, ValueError):
        return False
    return giorno >= limite.replace(hour=0, minute=0, second=0, microsecond=0)


def firma(voci: list[dict]) -> str:
    chiave = [
        {k: n.get(k) for k in ("url", "titolo", "anteprima", "data", "fonte", "etichetta")}
        for n in voci
    ]
    return json.dumps(chiave, ensure_ascii=False, sort_keys=True)


def scrivi(payload: dict) -> None:
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    DATA_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    js = (
        "/* Generato da scripts/sync_m5s.py. Anteprime prese solo dal campo description/summary del feed. */\n"
        "window.M5S_UFFICIALE = "
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + ";\n"
    )
    JS_PATH.write_text(js, encoding="utf-8")


def controlla() -> None:
    lungo = anteprima("<p>" + ("parola " * 80) + "</p>")
    if len(lungo) > ANTEPRIMA_MAX or not lungo.endswith("…"):
        raise SystemExit("Anteprima fuori misura")
    if anteprima("<b>Testo breve</b>") != "Testo breve":
        raise SystemExit("Pulizia HTML non riuscita")


def main() -> int:
    controlla()
    if not should_run():
        print("FUORI ORARIO | questo cron non è le 09:00 o le 17:00 a Roma")
        return 0

    precedente = carica()
    by_url = {}
    for item in precedente.get("voci") or []:
        url = normalizza_url(item.get("url", ""))
        if url:
            item = dict(item)
            item["url"] = url
            by_url[url] = item

    limite = now_rome() - timedelta(days=GIORNI)
    fonti = []
    for feed in FEEDS:
        print(f"FONTE {feed['nome']} | {feed['url']}", flush=True)
        try:
            raw = fetch(feed["url"])
            trovate = parse_feed(raw, feed, limite)
        except Exception as exc:
            print(f"RISULTATO {feed['nome']} | errore | {exc}", flush=True)
            fonti.append({"id": feed["id"], "nome": feed["nome"], "esito": "errore", "nuove": 0})
            time.sleep(1)
            continue
        nuove = [item for item in trovate if item["url"] not in by_url][:MAX_NUOVE]
        for item in nuove:
            by_url[item["url"]] = item
        print(f"RISULTATO {feed['nome']} | ok | nel feed {len(trovate)} | nuove {len(nuove)}", flush=True)
        fonti.append({"id": feed["id"], "nome": feed["nome"], "esito": "ok", "nuove": len(nuove)})
        time.sleep(1)

    voci = [item for item in by_url.values() if entro_finestra(item, limite)]
    voci.sort(key=lambda item: (item.get("data", ""), item.get("titolo", "")), reverse=True)
    if firma(voci) == firma(precedente.get("voci") or []):
        print(f"NESSUNA NOVITÀ | {len(voci)} voci già in archivio", flush=True)
        return 0

    scrivi(
        {
            "aggiornato": now_rome().isoformat(timespec="seconds"),
            "giorni": GIORNI,
            "fonti": fonti,
            "voci": voci,
        }
    )
    print(f"AGGIORNATO | {len(voci)} voci degli ultimi {GIORNI} giorni", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
