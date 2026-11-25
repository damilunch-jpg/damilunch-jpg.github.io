#!/usr/bin/env python3
"""Prova su Sezze: atti in corso e Storico dal 1° settembre 2026, con Chrome.

Non tocca la Release albo-2026-11-25. Pubblica solo albo-sezze-test-2026-11-25.
"""

from __future__ import annotations

import csv
import io
import json
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
from halley_browser import BrowserHalley
from sync_albo import DATE_RE, abs_url, clean, halley_mc, iso_from_match

ROOT = Path(__file__).resolve().parents[1]
FONTE = (
    "https://www.halleyweb.com/c059028/mc/mc_gridev_messi.php"
    "?x=&servizio=&bck=https%3A%2F%2Fwww.comune.sezze.lt.it%2Fc059028%2Fhh%2Findex.php"
)
SOGLIA = "2026-09-01"
TAG = "albo-sezze-test-2026-11-25"
MC = "https://www.halleyweb.com/c059028/mc/"


def nome_file(testo: str) -> str:
    testo = re.sub(r'[<>:"/\\|?*\s]+', "_", testo or "").strip("._")
    return testo[:80] or "documento"


def date_iso(testo: str) -> list[str]:
    return [iso_from_match(match) for match in DATE_RE.finditer(testo or "")]


def data_pubblicazione(date: list[str], intestazioni: list[str] | None = None) -> str:
    """Data di inizio pubblicazione, se la griglia la distingue dalla data dell'atto."""
    if intestazioni and len(intestazioni) == 1:
        return date[0] if date else ""
    if intestazioni:
        for indice, nome in enumerate(intestazioni):
            low = nome.lower()
            if indice < len(date) and any(token in low for token in ("inizio", "dal", "pubblic")):
                if "fine" in low or low.strip() in {"al", "al "}:
                    continue
                return date[indice] if indice < len(date) else ""
    if len(date) >= 2:
        return date[1]
    return date[0] if date else ""


def righe_griglia(xml: str) -> list[dict]:
    righe = []
    for attrs, inner in re.findall(r"<row\b([^>]*)>(.*?)</row>", xml, flags=re.I | re.S):
        id_match = re.search(r'\bid="([^"]+)"', attrs)
        pub_id = id_match.group(1) if id_match else ""
        celle = [clean(c) for c in re.findall(r"<cell[^>]*>(.*?)</cell>", inner, flags=re.I | re.S)]
        testo = " ".join(celle)
        date = date_iso(testo)
        titolo = max((c for c in celle if len(c) > 12 and not DATE_RE.search(c)), key=len, default="")
        if not titolo and pub_id:
            titolo = f"Atto {pub_id}"
        righe.append({"id": pub_id, "titolo": titolo[:500], "celle": celle, "date": date, "testo": testo[:300]})
    return righe


def intestazioni(html: str) -> list[str]:
    match = re.search(r"setHeader\(\s*['\"]([^'\"]+)['\"]", html or "")
    if not match:
        return []
    return [clean(parte) for parte in match.group(1).split(",")]


def url_con(url: str, **nuovi) -> str:
    split = urlsplit(url)
    attuale = {chiave: valori[-1] for chiave, valori in parse_qs(split.query, keep_blank_values=True).items()}
    for chiave, valore in nuovi.items():
        attuale[chiave] = str(valore)
    return urlunsplit((split.scheme, split.netloc, split.path, urlencode(attuale), ""))


class ProvaSezze(BrowserHalley):
    def testo(self, url: str) -> str:
        from playwright.sync_api import TimeoutError as PWTimeout

        try:
            risposta = self.page.goto(url, wait_until="domcontentloaded", timeout=45000)
        except Exception as exc:
            if not self._e_reset(exc):
                print(f"  elenco non letto: {type(exc).__name__}: {exc}", flush=True)
                return ""
            print(f"  connessione chiusa sull'elenco {url[:90]}", flush=True)
            self._attesa_dopo_reset()
            try:
                risposta = self.page.goto(url, wait_until="domcontentloaded", timeout=45000)
            except Exception as secondo:
                if self._e_reset(secondo):
                    self.spento = True
                print(f"  elenco non letto: {type(secondo).__name__}", flush=True)
                return ""
        self.page.wait_for_timeout(800)
        if risposta is not None:
            try:
                return risposta.text()
            except Exception:
                pass
        try:
            return self.page.content()
        except PWTimeout:
            return ""

    def griglia_completa(self, url_griglia: str, html_pagina: str) -> list[dict]:
        colonne = intestazioni(html_pagina)
        if colonne:
            print("  colonne: " + " | ".join(colonne), flush=True)
        raccolte = []
        visti = set()
        pos = 0
        while pos < 5000 and not self.spento:
            pagina = url_con(url_griglia, posStart=pos, count=40)
            if pos:
                self._pausa(3, 6, "tra una pagina dell'elenco")
            xml = self.testo(pagina)
            righe = righe_griglia(xml)
            nuove = [riga for riga in righe if riga["id"] and riga["id"] not in visti]
            print(f"  griglia pos {pos}: {len(righe)} righe, nuove {len(nuove)}", flush=True)
            if righe and pos == 0:
                for esempio in righe[:2]:
                    print("  esempio: " + " || ".join(esempio["celle"])[:240], flush=True)
            if not nuove:
                break
            for riga in nuove:
                visti.add(riga["id"])
                riga["data"] = data_pubblicazione(riga["date"], colonne or None)
                raccolte.append(riga)
            if len(righe) < 40:
                break
            pos += 40
        return raccolte

    def trova_griglie(self, html: str, base: str) -> list[str]:
        trovate = []
        for match in re.findall(r"mc_gridev_messi_datigrid\.php[^\"'\s<]*", html or "", flags=re.I):
            pieno = abs_url(base, match.replace("&amp;", "&"))
            if pieno not in trovate:
                trovate.append(pieno)
        return trovate

    def clicca_storico(self) -> str:
        self._pausa(8, 15, "prima di aprire Storico")
        self._gesto_umano()
        selettori = [
            self.page.locator("a").filter(has_text=re.compile(r"storico", re.I)),
            self.page.get_by_text(re.compile(r"^\s*storico\s*$", re.I)),
        ]
        for locator in selettori:
            try:
                if locator.count() == 0:
                    continue
                locator.first.click(timeout=8000)
                self.page.wait_for_timeout(1500)
                print(f"  aperto Storico: {self.page.url[:140]}", flush=True)
                return self.page.url
            except Exception as exc:
                print(f"  clic su Storico non riuscito: {type(exc).__name__}", flush=True)
        return ""


def atti_da_griglie(prova: ProvaSezze, pagine: list[str], html: str, origine: str) -> list[dict]:
    atti = []
    if not pagine:
        pagine = [abs_url(MC, "mc_gridev_messi_datigrid.php?x=&posStart=0&count=40")]
        print(f"  nessuna griglia esplicita in {origine}, provo l'indirizzo standard", flush=True)
    for url in pagine:
        print(f"  leggo {origine}: {url[:140]}", flush=True)
        for riga in prova.griglia_completa(url, html):
            riga["origine"] = origine
            riga["url"] = abs_url(MC, f"mc_p_dettaglio.php?id_pubbl={riga['id']}")
            atti.append(riga)
    return atti


def filtra(atti: list[dict], origine: str) -> list[dict]:
    tenuti = []
    for atto in atti:
        if atto.get("origine") != origine:
            continue
        data = atto.get("data") or ""
        if origine == "storico" and data and data < SOGLIA:
            continue
        if origine == "storico" and not data:
            continue
        tenuti.append(atto)
    return tenuti


def main() -> int:
    prova = ProvaSezze()
    try:
        html = prova.testo(FONTE)
        if prova.spento or not html:
            print("Elenco di Sezze non aperto", flush=True)
            atti = []
        else:
            correnti = atti_da_griglie(prova, prova.trova_griglie(html, FONTE), html, "corrente")
            storici = []
            if not prova.spento:
                prova.testo(FONTE)
                storico_url = prova.clicca_storico()
                if storico_url:
                    html_storico = prova.page.content()
                    griglie = prova.trova_griglie(html_storico, prova.page.url)
                    if not griglie:
                        for href in re.findall(r'href="([^"]+)"', html_storico, flags=re.I):
                            if re.search(r"storico|archivio|datagrid", href, flags=re.I):
                                griglie.append(abs_url(prova.page.url, href))
                    storici = atti_da_griglie(prova, griglie, html_storico, "storico")
                else:
                    print("  sezione Storico non trovata nella pagina", flush=True)
            visti = set()
            atti = []
            for atto in correnti + filtra(storici, "storico"):
                if not atto.get("id") or atto["id"] in visti:
                    continue
                if atto["origine"] == "corrente" and atto.get("data") and atto["data"] < SOGLIA:
                    # In corso ma iniziati prima di settembre: restano, sono ancora pubblicati.
                    pass
                visti.add(atto["id"])
                atti.append(atto)
        print(f"ATTI individuati {len(atti)}", flush=True)
        scaricati = 0
        file_n = 0
        date = []
        righe = []
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archivio:
            archivio.writestr(
                "LEGGIMI.txt",
                "Prova Sezze del 25/11/2026. Atti in corso e, se presente, sezione Storico, "
                "con pubblicazione dal 01/09/2026. Non sostituisce albo-2026-11-25.\n",
            )
            for indice, atto in enumerate(atti, start=1):
                if prova.spento:
                    print("Stop: il resto degli atti resta solo in indice.", flush=True)
                    for restante in atti[indice - 1 :]:
                        righe.append(riga_indice(restante, 0))
                    break
                print(
                    f"ATTO {indice}/{len(atti)} | {atto.get('data') or '-'} | {atto['origine']} | {atto['titolo'][:80]}",
                    flush=True,
                )
                files, _letta, _errore = prova.scarica_atto(
                    {"url": atto["url"], "numero": "", "data": atto.get("data") or "", "titolo": atto["titolo"]},
                    FONTE,
                )
                if files:
                    scaricati += 1
                if atto.get("data"):
                    date.append(atto["data"])
                base = nome_file((atto["id"] or "atto") + "_" + (atto.get("data") or "senza-data"))
                usati = set()
                for raw, fname in files:
                    destinazione = f"Sezze/{base}_{nome_file(fname)}"
                    if destinazione in usati:
                        destinazione = f"Sezze/{base}_{file_n}_{nome_file(fname)}"
                    usati.add(destinazione)
                    archivio.writestr(destinazione, raw)
                    file_n += 1
                righe.append(riga_indice(atto, len(files)))
            csv_buf = io.StringIO()
            writer = csv.writer(csv_buf)
            writer.writerow(["sezione", "id", "data", "oggetto", "file", "link"])
            writer.writerows(righe)
            archivio.writestr("indice.csv", csv_buf.getvalue())
        dist = ROOT / "dist"
        dist.mkdir(parents=True, exist_ok=True)
        zip_path = dist / f"{TAG}.zip"
        zip_path.write_bytes(buffer.getvalue())
        dal = min(date) if date else ""
        al = max(date) if date else ""
        print(
            f"ESITO atti={len(atti)} scaricati={scaricati} file={file_n} dal={dal} al={al} byte={zip_path.stat().st_size}",
            flush=True,
        )
        (dist / "sezze-esito.json").write_text(
            json.dumps(
                {
                    "atti": len(atti),
                    "scaricati": scaricati,
                    "file": file_n,
                    "dal": dal,
                    "al": al,
                    "byte": zip_path.stat().st_size,
                    "zip": str(zip_path),
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        return pubblica(zip_path)
    finally:
        prova.close()


def riga_indice(atto: dict, file: int) -> list[str]:
    return [atto.get("origine") or "", atto.get("id") or "", atto.get("data") or "", atto.get("titolo") or "", str(file), atto.get("url") or ""]


def pubblica(zip_path: Path) -> int:
    repo = os.environ.get("GITHUB_REPOSITORY") or ""
    note = "Prova Sezze: atti in corso e Storico dal 01/09/2026. Non sostituisce albo-2026-11-25."
    creato = subprocess.run(
        [
            "gh",
            "release",
            "create",
            TAG,
            str(zip_path),
            "--title",
            "Prova albo Sezze 2026-11-25",
            "--notes",
            note,
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if creato.returncode != 0:
        print((creato.stderr or creato.stdout).strip(), flush=True)
        return creato.returncode
    if repo:
        print(f"https://github.com/{repo}/releases/tag/{TAG}", flush=True)
        print(f"https://github.com/{repo}/releases/download/{TAG}/{zip_path.name}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
