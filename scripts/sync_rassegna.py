#!/usr/bin/env python3
"""Rassegna stampa locale.

Legge solo i feed RSS delle testate (titolo, link, data, description/summary).
Non scarica le pagine degli articoli e non conserva il testo integrale:
l'anteprima è il riassunto del feed, ripulito dall'HTML e troncato.
"""

from __future__ import annotations

import html
import json
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
DATA_PATH = ROOT / "data" / "rassegna.json"
JS_PATH = ROOT / "js" / "rassegna.js"
COMUNI_PATH = ROOT / "data" / "comuni.json"

ROME = ZoneInfo("Europe/Rome")
GIORNI = 60
ANTEPRIMA_MAX = 250
TIMEOUT = 25
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# Feed verificati: rispondono con XML RSS. I loghi sono già nel repository.
FEEDS = [
    {
        "id": "latinatoday",
        "nome": "Latina Today",
        "url": "https://www.latinatoday.it/rss",
        "logo": "img/testate/latinatoday.png",
    },
    {
        "id": "latinacorriere",
        "nome": "Latina Corriere",
        "url": "https://www.latinacorriere.it/feed/",
        "logo": "img/testate/latinacorriere.png",
    },
    {
        "id": "ilcaffe",
        "nome": "Il Caffè",
        "url": "https://ilcaffe.tv/feed",
        "logo": "img/testate/ilcaffe.png",
    },
    {
        "id": "h24notizie",
        "nome": "H24 Notizie",
        "url": "https://www.h24notizie.com/feed/",
        "logo": "img/testate/h24notizie.ico",
    },
    {
        "id": "frosinonetoday",
        "nome": "Frosinone Today",
        "url": "https://www.frosinonetoday.it/rss",
        "logo": "img/testate/frosinonetoday.png",
    },
]

# Nomi interi, senza ambiguità di maiuscole. Cori, Norma, Fondi e Cisterna
# sono trattati a parte più sotto.
NOMI_SICURI = [
    ("sezze", r"sezze"),
    ("priverno", r"priverno"),
    ("lenola", r"lenola"),
    ("sermoneta", r"sermoneta"),
    ("terracina", r"terracina"),
    ("ceccano", r"ceccano"),
    ("sonnino", r"sonnino"),
    ("bassiano", r"bassiano"),
    ("roccagorga", r"roccagorga"),
    ("monte-san-biagio", r"monte\s+san\s+biagio"),
    ("roccasecca-dei-volsci", r"roccasecca\s+dei\s+volsci"),
    ("rocca-massima", r"rocca\s+massima"),
]


def now_rome() -> datetime:
    return datetime.now(ROME)


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/rss+xml, application/xml, text/xml"})
    ctx = ssl.create_default_context()
    last = None
    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx) as resp:
                raw = resp.read(2_000_000)
                ctype = (resp.headers.get("Content-Type") or "").lower()
            head = raw[:200].lstrip().lower()
            if not (head.startswith(b"<?xml") or head.startswith(b"<rss") or head.startswith(b"<feed") or b"<rss" in head[:300]):
                raise ValueError("la risposta non è un feed RSS (" + ctype + ")")
            return raw
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            last = exc
            time.sleep(2 + attempt * 3)
    raise RuntimeError(str(last))


def child_text(node: ET.Element, names: set[str]) -> str:
    for el in list(node):
        if local_name(el.tag) in names:
            # Solo description/summary (o title, link, data). Mai content:encoded.
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
        # Il feed aveva già tagliato il riassunto, a volte a metà parola.
        if text and text[-1].isalpha():
            space = text.rfind(" ")
            if space >= 40:
                text = text[:space]
        return text.rstrip(" ,;:.-–—") + "…"
    cut = text[: ANTEPRIMA_MAX - 1]
    space = cut.rfind(" ")
    if space >= 180:
        cut = cut[:space]
    cut = cut.rstrip(" ,;:.-–—")
    return cut + "…"


def normalizza_url(url: str) -> str:
    parts = urlsplit((url or "").strip())
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not k.lower().startswith("utm_")]
    path = parts.path.rstrip("/") or "/"
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, "&".join(f"{k}={v}" for k, v in query), ""))


def _intorno(text: str, start: int, end: int, prima: int = 24, dopo: int = 28):
    return text[max(0, start - prima) : start], text[end : end + dopo]


def menziona_fondi(text: str) -> bool:
    """Fondi è il comune. «fondi» minuscolo o «Fondi per / europei» sono soldi."""
    for match in re.finditer(r"\bFondi\b", text):
        before, after = _intorno(text, match.start(), match.end())
        before_l = before.lower()
        after_l = after.lower()
        if re.search(r"\b(i|dei|ai|sui|coi|quei|alcuni|pochi|molti|nuovi|altri|tali|nessun|suoi|uso)\s+$", before_l):
            continue
        if re.match(r"\s+(per|europei|europee|regionali|statali|pnrr|pubblici|pubbliche|strutturali|nazionali|comunali|destinati|stanziati)\b", after_l):
            continue
        if re.match(r"\s*[,:;]", after) or re.search(r"\(\s*lt\s*\)", after_l):
            return True
        if re.search(r"\b(a|ad|da|in|nel|verso|presso|di)\s+$", before_l):
            return True
        if re.search(r"\bcomune\s+di\s+$", before_l):
            return True
    for match in re.finditer(r"\bFONDI\b", text):
        before, after = _intorno(text, match.start(), match.end(), 16, 12)
        if re.search(r"\b(I|DEI|AI|USO)\s+$", before):
            continue
        if re.match(r"\s+(PER|EUROPEI|PNRR)\b", after):
            continue
        if re.match(r"\s*[,:;]", after) or re.search(r"\b(A|AD|DA|IN|DI|NEL)\s+$", before):
            return True
    return False


def menziona_norma(text: str) -> bool:
    """Norma è il comune. «di norma», «la norma», «una norma» non lo sono."""
    for match in re.finditer(r"\bNorma\b", text):
        before, _after = _intorno(text, match.start(), match.end(), 28, 8)
        before_l = before.lower()
        if re.search(r"\bcomune\s+di\s+$", before_l):
            return True
        if re.search(r"\b(di|la|in|una|della|alla|sulla|questa|quella|ogni|tale|nuova|vecchia)\s+$", before_l):
            continue
        return True
    for match in re.finditer(r"\bNORMA\b", text):
        before, _after = _intorno(text, match.start(), match.end(), 20, 8)
        if re.search(r"\bCOMUNE\s+DI\s+$", before):
            return True
        if re.search(r"\b(DI|LA|IN|UNA|DELLA|ALLA)\s+$", before):
            continue
        return True
    return False


def menziona_cori(text: str) -> bool:
    """Cori con l'iniziale maiuscola, oppure «Comune di Cori». Non «coriaceo»."""
    if re.search(r"\bCori\b", text) or re.search(r"\bCORI\b", text):
        return True
    return bool(re.search(r"\bcomune\s+di\s+cori\b", text, re.I))


def menziona_cisterna(text: str) -> bool:
    if re.search(r"\bcisterna\s+di\s+latina\b", text, re.I):
        return True
    # «cisterna» minuscolo da solo è un serbatoio.
    return bool(re.search(r"\bCisterna\b", text) or re.search(r"\bCISTERNA\b", text))


def comuni_citati(text: str) -> list[str]:
    trovati = []
    for slug, pattern in NOMI_SICURI:
        if re.search(r"\b" + pattern + r"\b", text, re.I):
            trovati.append(slug)
    if menziona_fondi(text):
        trovati.append("fondi")
    if menziona_cisterna(text):
        trovati.append("cisterna-di-latina")
    if menziona_cori(text):
        trovati.append("cori")
    if menziona_norma(text):
        trovati.append("norma")
    ordine = [c["slug"] for c in json.loads(COMUNI_PATH.read_text(encoding="utf-8"))]
    return [slug for slug in ordine if slug in trovati]


def parse_feed(raw: bytes, feed: dict) -> list[dict]:
    root = ET.fromstring(raw)
    nodes = [el for el in root.iter() if local_name(el.tag) in {"item", "entry"}]
    out = []
    for node in nodes:
        titolo = clean_text(child_text(node, {"title"}))
        link = child_text(node, {"link"}).strip()
        if not link:
            for el in list(node):
                if local_name(el.tag) == "link" and el.get("href"):
                    link = el.get("href", "").strip()
                    break
        if not link:
            link = child_text(node, {"guid"}).strip()
        # description/summary soltanto: niente content:encoded.
        descrizione = child_text(node, {"description", "summary"})
        when = parse_when(child_text(node, {"pubDate", "date", "published", "updated"}))
        if not titolo or not link or when is None:
            continue
        testo = titolo + " " + clean_text(descrizione)
        slugs = comuni_citati(testo)
        if not slugs:
            continue
        url = normalizza_url(link)
        out.append(
            {
                "url": url,
                "titolo": titolo,
                "anteprima": anteprima(descrizione),
                "data": when.date().isoformat(),
                "testata": feed["id"],
                "testataNome": feed["nome"],
                "logo": feed["logo"],
                "comuni": slugs,
            }
        )
    return out


def carica() -> dict:
    if not DATA_PATH.exists():
        return {"aggiornato": "", "fonti": [], "notizie": []}
    return json.loads(DATA_PATH.read_text(encoding="utf-8"))


def entro_finestra(item: dict, limite: datetime) -> bool:
    try:
        giorno = datetime.fromisoformat(item["data"]).replace(tzinfo=ROME)
    except (KeyError, ValueError):
        return False
    return giorno >= limite.replace(hour=0, minute=0, second=0, microsecond=0)


def firma(notizie: list[dict]) -> str:
    chiave = [
        {k: n.get(k) for k in ("url", "titolo", "anteprima", "data", "testata", "comuni")}
        for n in notizie
    ]
    return json.dumps(chiave, ensure_ascii=False, sort_keys=True)


def scrivi(payload: dict) -> None:
    DATA_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    js = (
        "/* Generato da scripts/sync_rassegna.py. Anteprime prese solo dal campo description/summary del feed. */\n"
        "window.M5S_RASSEGNA = "
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + ";\n"
    )
    JS_PATH.write_text(js, encoding="utf-8")


def controlla_filtri() -> None:
    casi = [
        ("un problema coriaceo a Latina", []),
        ("Incidente a Cori sulla via Appia", ["cori"]),
        ("Di norma il consiglio si riunisce", []),
        ("la norma regionale è stata approvata", []),
        ("Mercato a Norma nel centro storico", ["norma"]),
        ("Il Comune di Norma pubblica l'avviso", ["norma"]),
        ("Arrivano i fondi europei per le scuole", []),
        ("Fondi per il Pnrr a Latina", []),
        ("Fondi, chiusa la strada per il mercato", ["fondi"]),
        ("Il sindaco di Fondi ha firmato", ["fondi"]),
        ("A Roccasecca un incendio", []),
        ("A Roccasecca dei Volsci un incendio", ["roccasecca-dei-volsci"]),
        ("una cisterna piena d'acqua", []),
        ("Cisterna, mercato del sabato", ["cisterna-di-latina"]),
        ("Cisterna di Latina, ordinanza del sindaco", ["cisterna-di-latina"]),
        ("Sezze e Priverno insieme", ["sezze", "priverno"]),
    ]
    for testo, attesi in casi:
        ottenuti = comuni_citati(testo)
        if ottenuti != attesi:
            raise SystemExit(f"Filtro errato su {testo!r}: {ottenuti} invece di {attesi}")
    lungo = "a" * 300
    tagliata = anteprima("<p>Parola " + lungo + "</p>")
    if len(tagliata) > ANTEPRIMA_MAX or not tagliata.endswith("…"):
        raise SystemExit("Anteprima fuori misura")
    corta = anteprima("<b>Testo breve</b> senza taglio")
    if corta != "Testo breve senza taglio":
        raise SystemExit("Pulizia HTML non riuscita: " + corta)


def main() -> int:
    controlla_filtri()
    precedente = carica()
    by_url = {}
    for item in precedente.get("notizie") or []:
        url = normalizza_url(item.get("url", ""))
        if url:
            item = dict(item)
            item["url"] = url
            by_url[url] = item

    fonti = []
    limite = now_rome() - timedelta(days=GIORNI)
    for feed in FEEDS:
        print(f"FONTE {feed['nome']} | {feed['url']}")
        try:
            raw = fetch(feed["url"])
            nuovi = parse_feed(raw, feed)
        except Exception as exc:  # rete o XML: si tengono le notizie già raccolte
            print(f"RISULTATO {feed['nome']} | errore | {exc}")
            fonti.append({"id": feed["id"], "nome": feed["nome"], "esito": "errore", "nuove": 0})
            time.sleep(1)
            continue
        for item in nuovi:
            by_url[item["url"]] = item
        print(f"RISULTATO {feed['nome']} | ok | {len(nuovi)} notizie sui comuni")
        fonti.append({"id": feed["id"], "nome": feed["nome"], "esito": "ok", "nuove": len(nuovi)})
        time.sleep(1)

    notizie = [item for item in by_url.values() if entro_finestra(item, limite)]
    notizie.sort(key=lambda item: (item.get("data", ""), item.get("titolo", "")), reverse=True)

    if firma(notizie) == firma(precedente.get("notizie") or []):
        print(f"NESSUNA NOVITÀ | {len(notizie)} notizie già in archivio, nessun file aggiornato")
        return 0

    payload = {
        "aggiornato": now_rome().isoformat(timespec="seconds"),
        "giorni": GIORNI,
        "fonti": fonti,
        "notizie": notizie,
    }
    scrivi(payload)
    print(f"AGGIORNATO | {len(notizie)} notizie degli ultimi {GIORNI} giorni")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
