#!/usr/bin/env python3
"""Scarica i PDF Halley con Chrome, perché il sito chiude il TLS di Python e curl.

Un solo browser e un solo contesto. Si apre l'elenco del comune, poi la scheda
di ogni atto, e si prendono il documento principale (versione non firmata, se
c'è) e gli allegati.
"""

from __future__ import annotations

import random
import re
import tempfile
import time
import urllib.parse
from pathlib import Path

from sync_albo import abs_url

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
SLUG = {
    "sezze",
    "sermoneta",
    "priverno",
    "norma",
    "cisterna-di-latina",
    "rocca-massima",
}


def _pezzi(html: str) -> list[tuple[int, str, str]]:
    """Priorità, url relativo o assoluto, testo del link."""
    trovati = []
    for match in re.finditer(r"<a\b([^>]*)>(.*?)</a>", html, flags=re.I | re.S):
        attrs, inner = match.group(1), match.group(2)
        href = ""
        href_m = re.search(r'href\s*=\s*"([^"]*)"', attrs, flags=re.I)
        if href_m:
            href = href_m.group(1).replace("&amp;", "&")
        onclick = ""
        on_m = re.search(r'onclick\s*=\s*"([^"]*)"', attrs, flags=re.I)
        if on_m:
            onclick = on_m.group(1).replace("&amp;", "&")
        testo = re.sub(r"<[^>]+>", " ", inner)
        testo = re.sub(r"\s+", " ", testo).strip()
        candidati = [href]
        candidati.extend(re.findall(r"(?:mc_attachment|allegat\w*)\.php\?[^'\"\s>]+", onclick, flags=re.I))
        candidati.extend(re.findall(r"(?:mc_attachment|allegat\w*)\.php\?mc=\d+", attrs, flags=re.I))
        basso = (testo + " " + onclick).lower()
        for candidato in candidati:
            low = (candidato or "").lower()
            if not low or low.startswith("javascript:"):
                continue
            if "p7m=s" in low and "non firmato" not in basso:
                continue
            utile = (
                "non firmato" in basso
                or "mc_attachment.php" in low
                or bool(re.search(r"\.(pdf|p7m)(\?|$)", low))
            )
            if not utile:
                continue
            if "non firmato" in basso:
                priorita = 0
            elif "allegat" in basso:
                priorita = 1
            else:
                priorita = 2
            trovati.append((priorita, candidato, testo))
    trovati.sort(key=lambda item: item[0])
    return trovati


def _dedup(html: str, base: str) -> list[str]:
    visti = set()
    ordinati = []
    for _priorita, candidato, _testo in _pezzi(html):
        pieno = abs_url(base, candidato)
        chiave = re.search(r"[?&]mc=(\d+)", pieno)
        firma = chiave.group(1) if chiave else pieno
        if firma in visti:
            continue
        visti.add(firma)
        ordinati.append(pieno)
    return ordinati


def _scheda_valida(html: str) -> bool:
    low = html.lower()
    return "dettaglio" in low or "oggetto" in low or "mc_attachment" in low or "scarica file" in low


class BrowserHalley:
    def __init__(self):
        from playwright.sync_api import sync_playwright

        self._pw = sync_playwright().start()
        self.browser = self._avvia()
        self.context = self.browser.new_context(
            accept_downloads=True,
            locale="it-IT",
            user_agent=UA,
            viewport={"width": 1280, "height": 900},
        )
        self.page = self.context.new_page()
        self.liste = set()
        self.fallimenti = 0
        self.spento = False

    def _avvia(self):
        argomenti = ["--no-sandbox", "--disable-dev-shm-usage"]
        try:
            return self._pw.chromium.launch(channel="chrome", headless=True, args=argomenti)
        except Exception as exc:
            print(f"Chrome di sistema non avviato ({exc}); uso Chromium di Playwright", flush=True)
            return self._pw.chromium.launch(headless=True, args=argomenti)

    def close(self):
        try:
            self.context.close()
        except Exception:
            pass
        try:
            self.browser.close()
        except Exception:
            pass
        self._pw.stop()

    def _pausa(self, minimo: float = 2.0, massimo: float = 4.0):
        time.sleep(random.uniform(minimo, massimo))

    def _goto(self, url: str, timeout: int = 50000):
        self.page.goto(url, wait_until="domcontentloaded", timeout=timeout)
        self.page.wait_for_timeout(900)

    def apri_lista(self, fonte: str):
        if not fonte or fonte in self.liste:
            return
        print(f"  elenco {fonte[:110]}", flush=True)
        self._goto(fonte, timeout=60000)
        self.liste.add(fonte)
        self._pausa(1.5, 2.5)

    def _file(self, url: str):
        """Naviga col browser: se parte un download, ne legge i byte."""
        from playwright.sync_api import TimeoutError as PWTimeout

        self._pausa(0.8, 1.6)
        try:
            with self.page.expect_download(timeout=35000) as atteso:
                try:
                    self.page.goto(url, wait_until="commit", timeout=35000)
                except Exception as exc:
                    messaggio = str(exc)
                    if "Download is starting" not in messaggio and "ERR_ABORTED" not in messaggio:
                        raise
            download = atteso.value
            destinazione = Path(tempfile.mkdtemp()) / (download.suggested_filename or "documento.bin")
            download.save_as(destinazione)
            raw = destinazione.read_bytes()
            nome = download.suggested_filename or destinazione.name
        except PWTimeout as exc:
            print(f"  file non scaricato: {exc}", flush=True)
            return None
        except Exception as exc:
            print(f"  file non scaricato: {exc}", flush=True)
            return None
        if not raw or raw[:20].lstrip().lower().startswith(b"<!doctype") or raw[:6].lower().startswith(b"<html"):
            print("  pagina HTML, non un documento", flush=True)
            return None
        return raw, nome

    def scarica_atto(self, item: dict, fonte: str):
        """Ritorna (file, pagina_letta, errore_rete)."""
        if self.spento:
            return [], False, True
        url = item.get("url") or ""
        try:
            self.apri_lista(fonte)
            self._pausa()
            self._goto(url)
            html = self.page.content()
        except Exception as exc:
            print(f"  scheda non aperta: {type(exc).__name__}: {exc}", flush=True)
            self.fallimenti += 1
            if self.fallimenti >= 3:
                self.spento = True
                print("Halley chiude la connessione al browser: gli atti rimasti restano in coda", flush=True)
            return [], False, True
        if not _scheda_valida(html):
            print("  scheda senza dettaglio", flush=True)
            self.fallimenti += 1
            if self.fallimenti >= 3:
                self.spento = True
                print("Halley chiude la connessione al browser: gli atti rimasti restano in coda", flush=True)
            return [], False, True
        self.fallimenti = 0
        base = self.page.url
        ordinati = _dedup(html, base)
        files = []
        for link in ordinati:
            preso = self._file(link)
            if not preso:
                continue
            files.append(preso)
            print(f"  documento {preso[1]} | {len(preso[0])} byte", flush=True)
        return files, True, bool(ordinati) and not files
