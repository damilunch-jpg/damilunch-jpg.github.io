#!/usr/bin/env python3
"""Zip degli atti nuovi: documenti pubblici, indice e prompt.

Non scarica pagine che chiedono il login. Se il file non è pubblico,
nell'indice resta solo la riga.
"""

from __future__ import annotations

import csv
import io
import json
import re
import zipfile
from datetime import datetime
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sync_albo import Client, SourceError, abs_url, is_halley

ROOT = Path(__file__).resolve().parents[1]
ALBO_PATH = ROOT / "data" / "albo.json"
SNAPSHOT_PATH = ROOT / "data" / "albo-pacchetto.json"
DIST = ROOT / "dist"
ROME = ZoneInfo("Europe/Rome")
PROMPT = """Sei un primo filtro su atti pubblicati all'albo pretorio di comuni del Lazio.
Non sei un avvocato e questo non è una consulenza legale: segnala solo possibili criticità da far rileggere a una persona competente.

Nel file indice.csv trovi, per ogni atto: Comune, numero, data, oggetto, tipo e link originale.
I documenti scaricabili senza login sono nelle cartelle dei comuni. Il nome del file inizia con numero e data dell'atto. Se un atto è nell'indice ma non ha un file, il documento non era scaricabile senza autenticazione: in quel caso limita il controllo alle informazioni dell'indice e indicane il limite.

Controlla determine e delibere, una alla volta, su questi punti:
- competenza dell'organo che adotta l'atto (sindaco, giunta, consiglio, dirigente) rispetto all'oggetto;
- motivazione: deve spiegare perché l'atto è necessario e su quali fatti si basa;
- copertura finanziaria e pareri (contabile, tecnico, di regolarità) quando l'atto impegna spesa o approva un bilancio;
- Codice dei contratti pubblici (decreto legislativo 36/2023) se l'atto riguarda un affidamento, una gara, una proroga o una variante;
- trasparenza (decreto legislativo 33/2013): l'oggetto deve essere comprensibile e i riferimenti all'atto devono esserci;
- privacy e GDPR (regolamento UE 2016/679): segnala dati personali non necessari, in particolare dati sanitari, di minori o giudiziari.

Per ogni criticità scrivi il comune, il numero e la data dell'atto, il punto che non torna e il riferimento normativo. Se un controllo non è possibile perché manca il documento, dillo in modo esplicito. Chiudi ricordando che si tratta di un primo filtro, non di un parere legale.
"""


def chiave(slug: str, item: dict) -> str:
    numero = re.sub(r"\s+", "", item.get("numero") or "").lower()
    data = item.get("data") or ""
    if numero and data:
        return f"{slug}|{numero}|{data}"
    return f"{slug}|url|{item.get('url') or ''}"


def nome_file(testo: str) -> str:
    testo = re.sub(r'[<>:"/\\|?*\s]+', "_", testo or "").strip("._")
    return testo[:80] or "documento"


def links_documenti(client: Client, url: str) -> list[str]:
    if re.search(r"\.(pdf|p7m)(\?|$)", url, flags=re.I):
        return [url]
    try:
        html, final, _status = client.get(url)
    except SourceError:
        return []
    low = html.lower()
    if any(token in low for token in ("type=\"password\"", "name=\"password\"", "effettua il login", "autenticarsi")):
        if "fecore02.sto" not in low and ".pdf" not in low:
            return []
    trovati = []
    visti = set()
    for href in re.findall(r'href="([^"]+)"', html, flags=re.I):
        href_low = href.lower()
        if "p7m=s" in href_low:
            continue
        interessante = "fecore02.sto" in href_low or bool(re.search(r"\.(pdf|p7m)(\?|$)", href_low))
        if not interessante:
            continue
        pieno = abs_url(final, href.replace("&amp;", "&"))
        if pieno in visti:
            continue
        visti.add(pieno)
        trovati.append(pieno)
    return trovati


def scarica(client: Client, url: str):
    try:
        if is_halley(url):
            client._pause(url, 1)
        raw, ctype, nome, finale = client.get_bytes(url)
    except SourceError as exc:
        print(f"  documento non scaricato: {exc}", flush=True)
        return None
    if "html" in ctype or raw[:20].lstrip().lower().startswith(b"<!doctype") or raw[:6].lower().startswith(b"<html"):
        print("  pagina HTML, non un documento", flush=True)
        return None
    if not nome:
        path = finale.split("?")[0].rstrip("/").split("/")[-1]
        nome = urllib_unquote(path) if "." in path else "documento.pdf"
    if "." not in nome:
        if "pdf" in ctype or raw.startswith(b"%PDF"):
            nome += ".pdf"
        elif "zip" in ctype:
            nome += ".zip"
        else:
            nome += ".bin"
    return raw, nome_file(nome)


def urllib_unquote(value: str) -> str:
    from urllib.parse import unquote
    return unquote(value)


def main() -> int:
    if not ALBO_PATH.exists():
        print("Nessun albo salvato")
        return 0
    albo = json.loads(ALBO_PATH.read_text(encoding="utf-8"))
    snapshot = {}
    if SNAPSHOT_PATH.exists():
        try:
            snapshot = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            snapshot = {}
    gia = set(snapshot.get("chiavi") or [])
    primo = not SNAPSHOT_PATH.exists()
    nuovi = []
    for slug, info in (albo.get("comuni") or {}).items():
        for item in info.get("atti") or []:
            key = chiave(slug, item)
            if primo or key not in gia:
                nuovi.append((slug, item, key))
    oggi = datetime.now(ROME).date().isoformat()
    DIST.mkdir(parents=True, exist_ok=True)
    riepilogo = DIST / "riepilogo.json"
    if not nuovi:
        print("Nessun atto nuovo rispetto al giorno precedente")
        riepilogo.write_text(json.dumps({"zip": "", "atti": 0, "documenti": 0, "tag": ""}, indent=2), encoding="utf-8")
        return 0

    client = Client()
    client.fast = True
    client.max_attempts = 1
    client.timeout = 15
    client.label = "documenti"
    cartelle = {}
    comuni = json.loads((ROOT / "data" / "comuni.json").read_text(encoding="utf-8"))
    nomi = {item["slug"]: item["nome"] for item in comuni}
    righe = []
    documenti = 0
    senza_file = 0
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archivio:
        archivio.writestr("PROMPT.txt", PROMPT)
        for slug, item, key in nuovi:
            nome = nomi.get(slug, slug)
            cartella = nome_file(nome)
            usati = cartelle.setdefault(cartella, set())
            base = nome_file((item.get("numero") or "atto") + "_" + (item.get("data") or "senza-data"))
            scaricati = 0
            client.label = nome
            for link in links_documenti(client, item.get("url") or ""):
                preso = scarica(client, link)
                if not preso:
                    continue
                raw, fname = preso
                destinazione = f"{cartella}/{base}_{fname}" if scaricati else f"{cartella}/{base}_{fname}"
                if destinazione in usati:
                    destinazione = f"{cartella}/{base}_{scaricati + 1}_{fname}"
                usati.add(destinazione)
                archivio.writestr(destinazione, raw)
                scaricati += 1
                documenti += 1
            righe.append([nome, item.get("numero") or "", item.get("data") or "", item.get("titolo") or "", item.get("tipo") or "", item.get("url") or ""])
            if scaricati == 0:
                senza_file += 1
            print(f"{nome} | {item.get('numero') or '-'} | file {scaricati}", flush=True)
        csv_buf = io.StringIO()
        writer = csv.writer(csv_buf)
        writer.writerow(["Comune", "numero", "data", "oggetto", "tipo", "link originale"])
        writer.writerows(righe)
        archivio.writestr("indice.csv", csv_buf.getvalue())

    zip_name = f"albo-{oggi}.zip"
    zip_path = DIST / zip_name
    zip_path.write_bytes(buffer.getvalue())
    chiavi = set(gia)
    chiavi.update(key for _slug, _item, key in nuovi)
    # Lo snapshot tiene tutte le chiavi viste, così il giorno dopo si scaricano solo i nuovi.
    for slug, info in (albo.get("comuni") or {}).items():
        for item in info.get("atti") or []:
            chiavi.add(chiave(slug, item))
    SNAPSHOT_PATH.write_text(
        json.dumps({"giorno": oggi, "chiavi": sorted(chiavi)}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    riepilogo.write_text(json.dumps({
        "zip": str(zip_path.relative_to(ROOT)),
        "tag": f"albo-{oggi}",
        "bytes": zip_path.stat().st_size,
        "atti": len(righe),
        "documenti": documenti,
        "senza_file": senza_file,
    }, indent=2) + "\n", encoding="utf-8")
    print(f"ZIP {zip_name} | atti={len(righe)} | documenti={documenti} | byte={zip_path.stat().st_size}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
