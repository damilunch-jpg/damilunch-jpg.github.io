#!/usr/bin/env python3
"""Legge gli albi pretori dei comuni e aggiorna data/albo.json e js/albo.js.

Un errore su un comune non interrompe gli altri. Le richieste sono una alla volta,
con una pausa e ritentativi, perché Halley chiude i collegamenti troppo ravvicinati.
A mezzanotte si leggono tutti i comuni; alle 01:00, 02:30 e 04:00 (ora di Roma)
si ritentano solo quelli falliti o rimasti vuoti. Un elenco già riuscito non viene
sostituito con una risposta vuota. I PDF restano sul sito del Comune.
"""

from __future__ import annotations

import http.cookiejar
import json
import os
import random
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from html import unescape
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
COMUNI_PATH = ROOT / "data" / "comuni.json"
ALBO_PATH = ROOT / "data" / "albo.json"
JS_PATH = ROOT / "js" / "albo.js"

LIMIT = 30
TIMEOUT = 80
MAX_ATTEMPTS = 4
# Browser normale: alcuni portali (Halley) chiudono le richieste che sembrano di un bot.
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
ROME = ZoneInfo("Europe/Rome")
# Orari di Roma coperti dai cron UTC. Il primo è la lettura completa,
# gli altri ritentano solo i comuni falliti o rimasti vuoti.
ROME_SLOTS = {
    (0, 0): "full",
    (1, 0): "retry",
    (2, 30): "retry",
    (4, 0): "retry",
}

DATE_RE = re.compile(r"\b(\d{2})[./-](\d{2})[./-](\d{4})\b")


class SourceError(Exception):
    """La fonte di un comune non ha restituito un elenco utilizzabile."""


def now_iso() -> str:
    return datetime.now(ROME).isoformat(timespec="seconds")


def scheduled_mode(schedule: str, offset_hours: float):
    """Traduce il cron UTC nell'orario di Roma con l'offset attuale (CET/CEST).

    Ritorna "full", "retry" oppure None se questo cron, con l'ora legale di
    oggi, non corrisponde a uno degli orari previsti.
    """
    parts = (schedule or "").split()
    if len(parts) < 2:
        return None
    try:
        minute = int(parts[0])
        hour = int(parts[1])
    except ValueError:
        return None
    total = hour * 60 + minute + int(round(offset_hours * 60))
    total %= 24 * 60
    return ROME_SLOTS.get(divmod(total, 60))


def run_plan() -> str | None:
    """full = tutti i comuni; retry = solo i falliti o vuoti di stanotte; None = non eseguire."""
    event = os.environ.get("GITHUB_EVENT_NAME", "")
    if event != "schedule":
        return "full"
    offset = datetime.now(ROME).utcoffset().total_seconds() / 3600
    return scheduled_mode(os.environ.get("ALBO_SCHEDULE", ""), offset)


def midnight_today(now: datetime) -> datetime:
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def parse_stamp(value: str):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def succeeded_tonight(record: dict, now: datetime) -> bool:
    """Elenco non vuoto ottenuto dopo la mezzanotte di Roma."""
    if not record or not record.get("atti"):
        return False
    esito = record.get("esito")
    if esito is None:
        esito = "atti" if record.get("ok") else "errore"
    if esito != "atti":
        return False
    stamp = parse_stamp(record.get("aggiornato") or "")
    if stamp is None:
        return False
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=ROME)
    return stamp >= midnight_today(now)


def clean(text: str) -> str:
    text = unescape(text or "")
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def iso_from_match(match) -> str:
    day, month, year = match.group(1), match.group(2), match.group(3)
    return f"{year}-{month}-{day}"


def first_date(text: str) -> str:
    match = DATE_RE.search(text or "")
    return iso_from_match(match) if match else ""


def abs_url(base: str, href: str) -> str:
    return urllib.parse.urljoin(base, href.replace("&amp;", "&"))


def origin_of(url: str) -> str:
    parts = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, "", "", ""))


def is_halley(url: str) -> bool:
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    return "halleyweb" in host or host.endswith("halley.it")


def halley_mc(url: str) -> str:
    """Cartella /mc/ dello stesso ente, anche se il link di partenza è index.php."""
    parts = urllib.parse.urlsplit(url)
    path = parts.path or "/"
    if "/mc/" in path:
        base = path.split("/mc/")[0] + "/mc/"
    else:
        match = re.search(r"(/c\d+/)", path)
        base = (match.group(1) + "mc/") if match else "/mc/"
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, base, "", ""))


class Client:
    """Una richiesta alla volta, con pausa e ritentativi. Nessun parallelismo."""

    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.ssl = ssl.create_default_context()
        try:
            self.ssl.set_ciphers("DEFAULT@SECLEVEL=1")
        except ssl.SSLError:
            pass
        self.extra_ca = None
        self.label = ""
        self.request_count = 0
        self.last_status = "-"
        self._started = False
        self.fast = False
        self.max_attempts = MAX_ATTEMPTS
        self.timeout = TIMEOUT

    def start_comune(self, nome: str):
        self.label = nome
        self.request_count = 0
        self.last_status = "-"

    def _opener(self):
        return urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar),
            urllib.request.HTTPSHandler(context=self.ssl),
        )

    def _pause(self, url: str, attempt: int):
        """Pausa fra una richiesta e l'altra. I ritentativi allungano l'attesa."""
        host = urllib.parse.urlsplit(url).hostname or url
        if attempt == 1:
            if not self._started:
                self._started = True
                return
            if self.fast:
                low, high = (1.5, 3.0) if is_halley(url) else (0.4, 1.0)
            else:
                low, high = (8.0, 15.0) if is_halley(url) else (5.0, 12.0)
            delay = random.uniform(low, high)
        else:
            delay = min(120.0, 15.0 * (2 ** (attempt - 2))) + random.uniform(0, 8)
        print(f"  {self.label}: attesa {delay:.0f}s prima di {host} (tentativo {attempt}/{MAX_ATTEMPTS})", flush=True)
        time.sleep(delay)

    def _retryable(self, exc: SourceError) -> bool:
        message = str(exc).lower()
        if "http 404" in message or "manutenzione" in message:
            return False
        return any(
            token in message
            for token in (
                "tempo scaduto",
                "timed out",
                "connessione",
                "tls",
                "ssl",
                "eof",
                "reset",
                "http 403",
                "http 408",
                "http 425",
                "http 429",
                "http 500",
                "http 502",
                "http 503",
                "http 504",
            )
        )

    def _once(self, url: str, data=None, headers=None, _cert_retry=False):
        hdrs = {
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
        }
        if headers:
            hdrs.update(headers)
        body = None
        if data is not None:
            body = urllib.parse.urlencode(data).encode("utf-8")
            hdrs.setdefault("Content-Type", "application/x-www-form-urlencoded")
        req = urllib.request.Request(url, data=body, headers=hdrs)
        try:
            with self._opener().open(req, timeout=self.timeout) as res:
                raw = res.read(2_000_000)
                charset = res.headers.get_content_charset() or "utf-8"
                text = raw.decode(charset, "replace")
                return text, res.geturl(), getattr(res, "status", 200)
        except urllib.error.HTTPError as exc:
            detail = exc.read(400).decode("utf-8", "replace")
            raise SourceError(f"HTTP {exc.code}" + (f" ({clean(detail)[:80]})" if detail else "")) from exc
        except urllib.error.URLError as exc:
            reason = getattr(exc, "reason", exc)
            message = str(reason)
            if not _cert_retry and ("CERTIFICATE_VERIFY_FAILED" in message or "certificate verify failed" in message):
                self._trust_peer(url)
                return self._once(url, data=data, headers=headers, _cert_retry=True)
            raise SourceError(f"Connessione non riuscita: {message}") from exc
        except TimeoutError as exc:
            raise SourceError("Tempo scaduto in attesa della fonte") from exc
        except ssl.SSLError as exc:
            raise SourceError(f"Errore TLS: {exc}") from exc

    def _call(self, url: str, data=None, headers=None):
        host = urllib.parse.urlsplit(url).hostname or url
        method = "POST" if data is not None else "GET"
        last = None
        for attempt in range(1, self.max_attempts + 1):
            self._pause(url, attempt)
            self.request_count += 1
            try:
                text, final, status = self._once(url, data=data, headers=headers)
            except SourceError as exc:
                last = exc
                self.last_status = str(exc).split(" (")[0][:80]
                print(
                    f"  {self.label}: {method} {host} tentativo {attempt}/{self.max_attempts} -> {self.last_status}",
                    flush=True,
                )
                if attempt == self.max_attempts or not self._retryable(exc):
                    raise
                continue
            self.last_status = f"HTTP {status}"
            print(
                f"  {self.label}: {method} {host} tentativo {attempt}/{self.max_attempts} -> HTTP {status}",
                flush=True,
            )
            return text, final, status
        raise last or SourceError("Richiesta non riuscita")

    def _request(self, url: str, data=None, headers=None, _retried=False):
        return self._call(url, data=data, headers=headers)

    def _trust_peer(self, url: str):
        """Alcuni portali pubblici (Gazzetta Amministrativa) non inviano
        il certificato intermedio. Lo scarichiamo dall'indirizzo indicato
        nel certificato e lo aggiungiamo al trust store di sistema."""
        if self.extra_ca:
            return
        parts = urllib.parse.urlsplit(url)
        host = parts.hostname
        insecure = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        insecure.check_hostname = False
        insecure.verify_mode = ssl.CERT_NONE
        try:
            insecure.set_ciphers("DEFAULT@SECLEVEL=1")
        except ssl.SSLError:
            pass
        import socket

        with socket.create_connection((host, 443), timeout=TIMEOUT) as sock:
            with insecure.wrap_socket(sock, server_hostname=host) as tls:
                der = tls.getpeercert(binary_form=True)
        import tempfile

        pem_path = Path(tempfile.gettempdir()) / "albo-extra-ca.pem"
        # OpenSSL sul runner sa mostrare l'URI del CA issuer.
        leaf = Path(tempfile.gettempdir()) / "albo-leaf.pem"
        import subprocess

        proc = subprocess.run(
            ["openssl", "x509", "-inform", "DER", "-out", str(leaf)],
            input=der,
            capture_output=True,
            check=False,
        )
        if proc.returncode != 0:
            raise SourceError("Certificato della fonte non verificabile")
        text = subprocess.run(
            ["openssl", "x509", "-in", str(leaf), "-noout", "-text"],
            capture_output=True,
            text=True,
            check=False,
        ).stdout
        match = re.search(r"CA Issuers - URI:(\S+)", text)
        if not match:
            raise SourceError("Certificato della fonte non verificabile (manca l'emittente)")
        issuer_url = match.group(1)
        try:
            with urllib.request.urlopen(issuer_url, timeout=TIMEOUT) as res:
                issuer = res.read()
        except Exception as exc:
            raise SourceError("Certificato della fonte non verificabile") from exc
        pem = subprocess.run(
            ["openssl", "x509", "-inform", "DER"],
            input=issuer,
            capture_output=True,
            check=False,
        )
        if pem.returncode != 0:
            pem = subprocess.run(["openssl", "x509", "-inform", "PEM"], input=issuer, capture_output=True, check=False)
        if pem.returncode != 0:
            raise SourceError("Certificato intermedio non leggibile")
        system = Path(ssl.get_default_verify_paths().openssl_cafile or "/etc/ssl/certs/ca-certificates.crt")
        pem_path.write_bytes(system.read_bytes() + b"\n" + pem.stdout)
        ctx = ssl.create_default_context(cafile=str(pem_path))
        try:
            ctx.set_ciphers("DEFAULT@SECLEVEL=1")
        except ssl.SSLError:
            pass
        self.ssl = ctx
        self.extra_ca = str(pem_path)

    def get(self, url: str, headers=None):
        return self._request(url, headers=headers)

    def post(self, url: str, fields: dict):
        return self._request(url, data=fields)

    def get_bytes(self, url: str, limit: int = 12_000_000, _cert_retry: bool = False):
        """Scarica un file pubblico. Ritorna byte, content-type, filename, url finale."""
        hdrs = {
            "User-Agent": UA,
            "Accept": "*/*",
            "Accept-Language": "it-IT,it;q=0.9",
        }
        req = urllib.request.Request(url, headers=hdrs)
        try:
            with self._opener().open(req, timeout=self.timeout) as res:
                raw = res.read(limit + 1)
                ctype = (res.headers.get("Content-Type") or "").split(";")[0].strip().lower()
                disp = res.headers.get("Content-Disposition") or ""
                name = ""
                match = re.search(r"filename\*=UTF-8''([^;]+)", disp, flags=re.I)
                if match:
                    name = urllib.parse.unquote(match.group(1)).strip().strip('"')
                else:
                    match = re.search(r'filename="?([^";]+)"?', disp, flags=re.I)
                    if match:
                        name = match.group(1).strip()
                if len(raw) > limit:
                    raise SourceError("Documento troppo grande")
                return raw, ctype, name, res.geturl()
        except urllib.error.HTTPError as exc:
            raise SourceError(f"HTTP {exc.code}") from exc
        except urllib.error.URLError as exc:
            message = str(getattr(exc, "reason", exc))
            if not _cert_retry and ("CERTIFICATE_VERIFY_FAILED" in message or "certificate verify failed" in message):
                self._trust_peer(url)
                return self.get_bytes(url, limit=limit, _cert_retry=True)
            raise SourceError(f"Connessione non riuscita: {message}") from exc
        except TimeoutError as exc:
            raise SourceError("Tempo scaduto in attesa della fonte") from exc


def act(titolo, data, tipo, numero, url):
    titolo = clean(titolo)[:500]
    if not titolo or not url:
        return None
    return {
        "titolo": titolo,
        "data": data or "",
        "tipo": clean(tipo)[:120],
        "numero": clean(numero)[:80],
        "url": url,
    }


def parse_urbi(html: str, page_url: str, db_name: str):
    base = page_url.split("?")[0]
    acts = []
    seen = set()
    for match in re.finditer(r"IdMePubblica=(\d+)", html):
        pub_id = match.group(1)
        if pub_id in seen:
            continue
        seen.add(pub_id)
        start = html.rfind("<tr", 0, match.start())
        end = html.find("</tr>", match.end())
        chunk = html[start:end] if start >= 0 and end > start else html[max(0, match.start() - 1800) : match.end()]
        text = clean(chunk)
        strongs = [clean(s) for s in re.findall(r"<strong>(.*?)</strong>", chunk, flags=re.I | re.S)]
        strongs = [s for s in strongs if s]
        title = ""
        tipo = ""
        for strong in strongs:
            if "/" in strong and ("ALBO" in strong.upper() or len(strong) < 80):
                tipo = strong.split("/")[-1].strip()
            elif len(strong) > len(title):
                title = strong
        if not title:
            title = text[:240]
        date_match = re.search(r"dal\s+(\d{2})-(\d{2})-(\d{4})", text, flags=re.I)
        data = iso_from_match(date_match) if date_match else first_date(text)
        numero = ""
        reg = re.search(r"reg\.\s*([0-9]+\s*/\s*[0-9]{4})", text, flags=re.I)
        if reg:
            numero = re.sub(r"\s+", "", reg.group(1))
        else:
            code = re.search(r"\(([A-Z][A-Z .]*/\d{4}/\d+)", title)
            if code:
                numero = code.group(1)
        if tipo.isupper():
            tipo = tipo.capitalize()
        url = f"{base}?DB_NAME={urllib.parse.quote(db_name)}&w3cbt=S&StwEvent=91000302&IdMePubblica={pub_id}"
        item = act(title, data, tipo, numero, url)
        if item:
            acts.append(item)
    return acts


def scrape_urbi(client: Client, url: str):
    html, final, _status = client.get(url)
    lowered = html.lower()
    if "in manutenzione" in lowered or "in manutenzione" in unescape(html).lower():
        raise SourceError("Il portale dell'albo segnala una manutenzione in corso")
    db_match = re.search(r'__DB_NAME__\s*=\s*"([^"]+)"', html)
    query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
    db_name = (db_match.group(1) if db_match else "") or (query.get("DB_NAME") or [""])[0]
    if not db_name:
        raise SourceError("Pagina URBI senza codice ente")
    base = final.split("?")[0]
    search = {
        "OpenTree": "",
        "OpenTreeText": "",
        "Archivio": "",
        "Tipologia": "",
        "EnteMittente": "",
        "DaData": "",
        "AData": "",
        "OggettoType": "",
        "Oggetto": "",
        "RifAttoAnno": "",
        "RifAttoNumero": "",
        "Stepper_StepAttivo": "1",
        "Stepper_StepAttivoNome": "",
        "Stepper_NextStep": "2",
        "Stepper_NextStepNome": "",
        "DB_NAME": db_name,
        "w3cbt": "S",
        "BootstrapItalia_Home": "/urbi/bootstrap-italia/2.3.8",
        "Stepper_Idx": "1",
        "Form_Idx": "1",
        "TreeView_Idx": "1",
        "Collapse_Idx": "1",
        "Contenitore_Idx": "1",
    }
    listed, listed_url, _status = client.post(f"{base}?DB_NAME={urllib.parse.quote(db_name)}&StwEvent=910001&w3cbt=S", search)
    page_url = (
        f"{base}?DB_NAME={urllib.parse.quote(db_name)}&w3cbt=S&StwEvent=9100030"
        "&ElencoPubblicazioni_DimensionePagina=30&ElencoPubblicazioni_PaginaCorrente=1"
    )
    try:
        wider, _wider_url, _status = client.post(page_url, {"Form_Id": "idForm2", "DB_NAME": db_name, "w3cbt": "S"})
    except SourceError:
        wider = ""
    chosen = wider if wider.count("IdMePubblica=") > listed.count("IdMePubblica=") else listed
    if "in manutenzione" in chosen.lower():
        raise SourceError("Il portale dell'albo segnala una manutenzione in corso")
    acts = parse_urbi(chosen, listed_url or final, db_name)
    if not acts:
        raise SourceError("La risposta dell'albo URBI non contiene atti riconoscibili")
    return acts, final


def parse_grid(xml_text: str, page_url: str):
    rows = re.findall(r'<row\b([^>]*)>(.*?)</row>', xml_text, flags=re.I | re.S)
    if not rows and "<row" not in xml_text.lower():
        return None
    mc = page_url
    if "/mc/" in page_url:
        mc = page_url.split("/mc/")[0] + "/mc/"
    else:
        mc = page_url.rsplit("/", 1)[0] + "/"
    acts = []
    for attrs, inner in rows:
        id_match = re.search(r'\bid="([^"]+)"', attrs)
        pub_id = id_match.group(1) if id_match else ""
        cells = [clean(c) for c in re.findall(r"<cell[^>]*>(.*?)</cell>", inner, flags=re.I | re.S)]
        cells = [c for c in cells if c and c not in {"-", "0"}]
        if not cells and not pub_id:
            continue
        dates = []
        words = []
        numbers = []
        for cell in cells:
            if DATE_RE.fullmatch(cell) or (DATE_RE.search(cell) and len(cell) <= 10):
                dates.append(first_date(cell))
            elif re.fullmatch(r"\d{1,6}(?:/\d{4})?", cell):
                numbers.append(cell)
            else:
                words.append(cell)
        title = max(words, key=len) if words else ""
        tipo = ""
        for word in words:
            if word != title:
                tipo = word
                break
        numero = numbers[0] if numbers else ""
        data = dates[0] if dates else first_date(" ".join(cells))
        url = abs_url(mc, f"mc_gridev_dettaglio.php?id_pubbl={urllib.parse.quote(pub_id)}") if pub_id else ""
        if not title and pub_id:
            title = f"Atto {pub_id}"
        item = act(title, data, tipo, numero, url)
        if item:
            acts.append(item)
    return acts


def enrich_halley_details(client: Client, acts, page_url: str):
    """Legge la scheda dell'atto per tipo, numero e data. Non scarica i PDF."""
    weak = [
        a
        for a in acts
        if "dettaglio" in a.get("url", "")
        and (not a.get("tipo") or a["titolo"].startswith("Atto ") or len(a["titolo"]) < 12)
    ]
    if not weak:
        return acts
    mc = page_url.split("/mc/")[0] + "/mc/" if "/mc/" in page_url else page_url.rsplit("/", 1)[0] + "/"
    for item in weak[:LIMIT]:
        try:
            html, _final, _status = client.get(item["url"])
        except SourceError:
            continue
        pairs = {}
        cells = [clean(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", html, flags=re.I | re.S)]
        for i in range(0, len(cells) - 1, 2):
            pairs[cells[i].rstrip(":")] = cells[i + 1]
        title = pairs.get("Oggetto Atto") or pairs.get("Oggetto") or ""
        if title:
            item["titolo"] = clean(title)[:500]
        tipo = pairs.get("Tipo Atto") or pairs.get("Tipologia") or ""
        if tipo:
            item["tipo"] = clean(tipo)[:120]
        numero = pairs.get("Numero Atto") or ""
        if not numero and pairs.get("Numero Pubblicazione"):
            anno = pairs.get("Anno di Pubblicazione") or ""
            numero = pairs["Numero Pubblicazione"] + (f"/{anno}" if anno else "")
        if numero and numero not in {"0", "0/"}:
            item["numero"] = clean(numero)[:80]
        data = first_date(pairs.get("Data Inizio Pubblicazione") or pairs.get("Data Atto") or "")
        if data:
            item["data"] = data
        doc = re.search(r'href="([^"]+\.(?:pdf|p7m)[^"]*)"', html, flags=re.I)
        if doc:
            item["url"] = abs_url(mc, doc.group(1))
    return [a for a in acts if a.get("titolo") and not a["titolo"].startswith("Atto ")] or acts


def acts_from_html(html: str, page_url: str):
    acts = []
    seen = set()
    for match in re.finditer(r'<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>', html, flags=re.I | re.S):
        href, label = match.group(1), clean(match.group(2))
        href_l = href.lower()
        interesting = any(token in href_l for token in ("dettaglio", "id_pubbl", "idmepubblica", "pratica_", ".pdf", ".p7m"))
        if not interesting or len(label) < 8:
            continue
        url = abs_url(page_url, href)
        if url in seen:
            continue
        seen.add(url)
        window = clean(html[max(0, match.start() - 400) : match.end() + 400])
        item = act(label, first_date(window), "", "", url)
        if item:
            acts.append(item)
    if acts:
        return acts
    # Righe di tabella senza un link "dettaglio" esplicito, ma con una data e un testo lungo.
    for row in re.findall(r"<tr\b[^>]*>(.*?)</tr>", html, flags=re.I | re.S):
        text = clean(row)
        if len(text) < 25 or not DATE_RE.search(text):
            continue
        link = re.search(r'href="([^"]+)"', row, flags=re.I)
        if not link:
            continue
        url = abs_url(page_url, link.group(1))
        if url in seen:
            continue
        seen.add(url)
        title = clean(re.sub(r"<[^>]+>", " ", row))
        item = act(title[:300], first_date(text), "", "", url)
        if item:
            acts.append(item)
    return acts


def scrape_halley(client: Client, url: str):
    errors = []
    candidates = [url]
    mc = halley_mc(url)
    grid = abs_url(mc, "mc_gridev_messi_datigrid.php?x=&posStart=0&count=40")
    if grid not in candidates:
        candidates.append(grid)
    ricerca = abs_url(mc, "mc_p_ricerca.php")
    query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
    multi = (query.get("multiente") or [""])[0]
    if not multi:
        code = re.search(r"/c(\d{6})/", urllib.parse.urlsplit(url).path)
        if code:
            multi = "c" + code.group(1)
    if multi:
        ricerca = abs_url(mc, f"mc_p_ricerca.php?noHeaderFooter=1&multiente={urllib.parse.quote(multi)}")
    if ricerca not in candidates and "mc_p_ricerca" not in url:
        candidates.append(ricerca)

    reachable_empty = False
    for candidate in candidates:
        try:
            if "datigrid.php" in candidate:
                body, final, _status = client.get(candidate)
                parsed = parse_grid(body, final)
                if parsed is None:
                    errors.append("griglia non in formato atteso")
                    print(f"  griglia non XML ({len(body)} byte): {clean(body)[:160]}")
                    continue
                if not parsed:
                    total = re.search(r'total_count="(\d+)"', body)
                    print(f"  griglia senza righe utili ({len(body)} byte, total={total.group(1) if total else '?'})")
                    reachable_empty = True
                    continue
                return enrich_halley_details(client, parsed, final), final
            body, final, _status = client.get(candidate)
            if "in manutenzione" in body.lower():
                raise SourceError("Il portale dell'albo segnala una manutenzione in corso")
            found = acts_from_html(body, final)
            if not found and "mc_p_ricerca" in final:
                posted, post_url, _status = client.post(
                    final.split("?")[0],
                    {"multiente": multi, "oggetto": "", "cerca": "Cerca", "tipo": ""},
                )
                found = acts_from_html(posted, post_url)
            grid_in_page = re.search(r'(mc_gridev_messi_datigrid\.php[^"\']*)', body)
            if not found and grid_in_page:
                grid_url = abs_url(final, grid_in_page.group(1))
                grid_body, grid_final, _status = client.get(grid_url)
                parsed = parse_grid(grid_body, grid_final)
                if parsed:
                    parsed = enrich_halley_details(client, parsed, grid_final)
                    return parsed, grid_final
            if found:
                return enrich_halley_details(client, found, final), final
            reachable_empty = True
        except SourceError as exc:
            errors.append(str(exc))
    if reachable_empty and not errors:
        return [], url
    detail = "; ".join(errors[:3]) if errors else "pagina senza elenco di atti"
    raise SourceError(f"Albo Halley non utilizzabile ({detail})")


def scrape_mycity(client: Client, url: str):
    html, final, _status = client.get(url)
    load = re.search(r'load-url="([^"]+)"', html)
    sort = re.search(r'sort-name="([^"]+)"', html)
    kind = re.search(r'menu-type="([^"]+)"', html)
    if not load:
        raise SourceError("Pagina del Comune senza elenco documenti")
    api = load.group(1)
    params = urllib.parse.urlencode(
        {
            "page": "1",
            "search": "",
            "sort": sort.group(1) if sort else "personalizzato",
            "type": kind.group(1) if kind else "0",
        }
    )
    body, api_final, _status = client.get(
        api + ("&" if "?" in api else "?") + params,
        headers={"Accept": "application/json", "X-Requested-With": "XMLHttpRequest"},
    )
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise SourceError("Risposta dell'elenco documenti non valida") from exc
    rows = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise SourceError("Elenco documenti in formato inatteso")
    acts = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        title = row.get("title") or row.get("titolo") or row.get("name") or ""
        data = first_date(
            str(row.get("published_at") or row.get("date") or row.get("data") or row.get("created_at") or "")
        )
        tipo = str(row.get("type") or row.get("tipologia") or row.get("category") or "")
        numero = str(row.get("number") or row.get("numero") or "")
        link = row.get("url") or row.get("link") or row.get("href") or ""
        if not link and row.get("slug"):
            link = urllib.parse.urljoin(final, "/" + str(row["slug"]).lstrip("/"))
        item = act(str(title), data, tipo, numero, str(link))
        if item:
            acts.append(item)
    return acts, api_final


def service_access_url(html: str, page_url: str) -> str:
    match = re.search(
        r'<a\b[^>]*id="btnCompDig"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*id="btnCompDig"',
        html,
        flags=re.I,
    )
    if not match:
        match = re.search(r'href="([^"]+)"[^>]*data-element="service-online-access"', html, flags=re.I)
    if not match:
        return ""
    href = next(g for g in match.groups() if g)
    if href.startswith("#"):
        return ""
    return abs_url(page_url, href)


def scrape_servizionline(client: Client, url: str, fallbacks):
    errors = []
    targets = []
    try:
        html, final, _status = client.get(url)
        access = service_access_url(html, final)
        if access:
            targets.append(access)
        else:
            errors.append("la scheda servizio non indica il collegamento all'elenco")
    except SourceError as exc:
        errors.append(str(exc))
    for extra in fallbacks:
        if extra not in targets:
            targets.append(extra)
    for target in targets:
        try:
            if any(token in target for token in ("halleyweb", "/mc/", "mc_p_", "mc_gridev")):
                return scrape_halley(client, target)
            html, final, _status = client.get(target)
            found = acts_from_html(html, final)
            if found:
                return found, final
            errors.append("pagina senza atti riconoscibili")
        except SourceError as exc:
            errors.append(str(exc))
    raise SourceError("Fonte non raggiungibile" + (f": {errors[0]}" if errors else ""))


def scrape_gazzetta(client: Client, url: str):
    html, final, _status = client.get(url)
    path = urllib.parse.urlsplit(final).path
    if not path.endswith("/"):
        path += "/"
    categories = []
    for href in re.findall(r'href="([^"]+)"', html):
        full = abs_url(origin_of(final), href)
        cpath = urllib.parse.urlsplit(full).path
        if not cpath.startswith(path) or cpath == path:
            continue
        rest = cpath[len(path) :].strip("/")
        if rest and "/" not in rest:
            categories.append(full if full.endswith("/") else full + "/")
    # ordine stabile, senza duplicati
    seen = set()
    ordered = []
    for cat in categories:
        if cat not in seen:
            seen.add(cat)
            ordered.append(cat)
    if not ordered:
        raise SourceError("Indice dell'albo senza sezioni")
    acts = []
    loaded = 0
    for cat in ordered:
        try:
            page, page_url, _status = client.get(cat)
        except SourceError:
            continue
        loaded += 1
        section = urllib.parse.unquote(urllib.parse.urlsplit(cat).path.rstrip("/").split("/")[-1])
        section = section.replace("_", " ").capitalize()
        blocks = re.findall(
            r'<h4[^>]*>\s*(?:&nbsp;|\s)*<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>\s*</h4>(.*?)(?=<h4\b|$)',
            page,
            flags=re.I | re.S,
        )
        if not blocks and "Pratiche Pubblicate" not in page and "pratiche pubblicate" not in page.lower():
            continue
        for href, title, tail in blocks:
            tail_text = clean(tail)
            pub = re.search(r"Data Pubblicazione</b>\s*:?\s*(\d{2}-\d{2}-\d{4})", tail, flags=re.I)
            if not pub:
                pub = re.search(r"Data Pubblicazione\s*:?\s*(\d{2}-\d{2}-\d{4})", tail_text, flags=re.I)
            data = ""
            if pub:
                data = first_date(pub.group(1))
            else:
                data = first_date(tail_text)
            numero = ""
            num = re.search(r"\bN\.?\s*(\d+)\b", clean(title), flags=re.I)
            if num:
                numero = num.group(1)
            item = act(clean(title), data, section, numero, abs_url(page_url, href))
            if item:
                acts.append(item)
    if loaded == 0:
        raise SourceError("Nessuna sezione dell'albo è raggiungibile")
    return acts, final


def scrape_comune(client: Client, comune: dict):
    kind = comune.get("scraper")
    fonte = comune.get("fonte") or comune.get("alboUrl")
    fallbacks = list(comune.get("fallback") or [])
    if kind == "urbi":
        return scrape_urbi(client, fonte)
    if kind == "halley":
        try:
            return scrape_halley(client, fonte)
        except SourceError as first:
            errors = [str(first)]
            for extra in fallbacks:
                try:
                    return scrape_halley(client, extra)
                except SourceError as exc:
                    errors.append(str(exc))
            raise SourceError(errors[0])
    if kind == "mycity":
        primary_error = ""
        primary_empty = False
        try:
            acts, used = scrape_mycity(client, fonte)
            if acts:
                return acts, used
            primary_empty = True
        except SourceError as exc:
            primary_error = str(exc)
        for extra in fallbacks:
            try:
                return scrape_halley(client, extra)
            except SourceError:
                continue
        if primary_empty:
            raise SourceError(
                "La pagina del Comune non elenca atti e l'albo Halley indicato in homepage non è raggiungibile"
            )
        raise SourceError(primary_error or "Fonte non raggiungibile")
    if kind == "servizionline":
        return scrape_servizionline(client, fonte, fallbacks)
    if kind == "gazzetta":
        return scrape_gazzetta(client, fonte)
    raise SourceError(f"Tipo di fonte sconosciuto: {kind}")


def friendly_error(message: str) -> str:
    """Testo breve, in italiano, mostrato sulla pagina del comune."""
    low = message.lower()
    if "manutenzione" in low:
        return "Il portale dell'albo segnala una manutenzione in corso"
    if "non elenca atti" in low or "pagina del comune" in low:
        return message
    if "tempo scaduto" in low or "timed out" in low:
        return "Fonte non raggiungibile: il sito non ha risposto in tempo"
    if any(token in low for token in ("ssl", "tls", "connessione non riuscita", "http 5", "http 4", "eof", "handshake", "non raggiungibile", "non utilizzabile")):
        return "Fonte non raggiungibile"
    return message[:280]


def numero_normale(value: str) -> str:
    return re.sub(r"\s+", "", value or "").lower()


def chiave_atto(item: dict) -> str:
    numero = numero_normale(item.get("numero"))
    data = item.get("data") or ""
    if numero and data:
        return numero + "|" + data
    return "url|" + (item.get("url") or "")


def stesso_atto(atteso: dict, trovato: dict) -> bool:
    numero = numero_normale(atteso.get("numero"))
    if not numero or numero != numero_normale(trovato.get("numero")):
        return False
    data = atteso.get("data") or ""
    altra = trovato.get("data") or ""
    if data and altra:
        return data == altra
    return False


def _campi_halley(html: str) -> dict:
    """Nomi dei campi del modulo di ricerca, se c'è uno storico senza login."""
    campi = {}
    for match in re.finditer(r"<(input|select)\b([^>]*)>", html, flags=re.I):
        attrs = match.group(2)
        name = re.search(r'name="([^"]+)"', attrs, flags=re.I)
        if not name:
            continue
        nome = name.group(1)
        value = re.search(r'value="([^"]*)"', attrs, flags=re.I)
        campi.setdefault(nome, value.group(1) if value else "")
    archivio = None
    for nome in campi:
        low = nome.lower()
        if any(token in low for token in ("archivio", "storico", "flg_arch", "vis")):
            archivio = nome
            break
    if archivio is None and not re.search(r"storico|archivio", html, flags=re.I):
        return {}
    return campi


def cerca_storico_urbi(client: Client, fonte: str, old: dict):
    numero = numero_normale(old.get("numero"))
    data = old.get("data") or ""
    if not numero or not data:
        return None
    if "urbi" not in fonte.lower() and "ur1ME" not in fonte:
        return None
    parte = numero.split("/")[0]
    anno = data[:4]
    if "/" in numero and numero.split("/")[-1].isdigit():
        anno = numero.split("/")[-1]
    html, final, _status = client.get(fonte)
    if "in manutenzione" in html.lower():
        return None
    db_match = re.search(r'__DB_NAME__\s*=\s*"([^"]+)"', html)
    query = urllib.parse.parse_qs(urllib.parse.urlsplit(fonte).query)
    db_name = (db_match.group(1) if db_match else "") or (query.get("DB_NAME") or [""])[0]
    if not db_name:
        return None
    base = final.split("?")[0]
    search = {
        "OpenTree": "",
        "OpenTreeText": "",
        "Archivio": "S",
        "Tipologia": "",
        "EnteMittente": "",
        "DaData": "",
        "AData": "",
        "OggettoType": "",
        "Oggetto": "",
        "RifAttoAnno": anno,
        "RifAttoNumero": parte,
        "Stepper_StepAttivo": "1",
        "Stepper_StepAttivoNome": "",
        "Stepper_NextStep": "2",
        "Stepper_NextStepNome": "",
        "DB_NAME": db_name,
        "w3cbt": "S",
        "BootstrapItalia_Home": "/urbi/bootstrap-italia/2.3.8",
        "Stepper_Idx": "1",
        "Form_Idx": "1",
        "TreeView_Idx": "1",
        "Collapse_Idx": "1",
        "Contenitore_Idx": "1",
    }
    listed, listed_url, _status = client.post(
        f"{base}?DB_NAME={urllib.parse.quote(db_name)}&StwEvent=910001&w3cbt=S",
        search,
    )
    page_url = (
        f"{base}?DB_NAME={urllib.parse.quote(db_name)}&w3cbt=S&StwEvent=9100030"
        "&ElencoPubblicazioni_DimensionePagina=30&ElencoPubblicazioni_PaginaCorrente=1"
    )
    try:
        wider, _wider_url, _status = client.post(page_url, {"Form_Id": "idForm2", "DB_NAME": db_name, "w3cbt": "S"})
    except SourceError:
        wider = ""
    chosen = wider if wider.count("IdMePubblica=") > listed.count("IdMePubblica=") else listed
    for item in parse_urbi(chosen, listed_url or final, db_name):
        if stesso_atto(old, item):
            return {"url": item["url"], "numero": item.get("numero") or old.get("numero") or "", "data": item.get("data") or data}
    return None


def cerca_storico_halley(client: Client, fonte: str, old: dict):
    numero = numero_normale(old.get("numero"))
    data = old.get("data") or ""
    if not numero or not data:
        return None
    mc = halley_mc(fonte)
    page, final, _status = client.get(abs_url(mc, "mc_p_ricerca.php"))
    campi = _campi_halley(page)
    if not campi:
        return None
    payload = dict(campi)
    anno = data[:4]
    giorno = ""
    match = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", data)
    if match:
        giorno = f"{match.group(3)}/{match.group(2)}/{match.group(1)}"
    for nome in list(payload):
        low = nome.lower()
        if "numer" in low:
            payload[nome] = numero.split("/")[0]
        elif "anno" in low:
            payload[nome] = anno
        elif any(token in low for token in ("archivio", "storico")):
            payload[nome] = "1"
        elif low in {"vis", "stato"}:
            payload[nome] = "1"
        elif giorno and any(token in low for token in ("data", "dal", "al")):
            payload[nome] = giorno
    if "cerca" not in {n.lower() for n in payload}:
        payload["cerca"] = "Cerca"
    posted, post_url, _status = client.post(final.split("?")[0], payload)
    trovati = acts_from_html(posted, post_url)
    grid = re.search(r'(mc_gridev_messi_datigrid\.php[^"\']*)', posted)
    if grid:
        body, grid_final, _status = client.get(abs_url(post_url, grid.group(1)))
        parsed = parse_grid(body, grid_final) or []
        trovati.extend(parsed)
    for item in trovati:
        if stesso_atto(old, item) and item.get("url"):
            return {"url": item["url"], "numero": item.get("numero") or old.get("numero") or "", "data": item.get("data") or data}
    return None


def cerca_storico_gazzetta(client: Client, fonte: str, old: dict):
    numero = numero_normale(old.get("numero"))
    data = old.get("data") or ""
    if not numero or not data:
        return None
    html, final, _status = client.get(fonte)
    path = urllib.parse.urlsplit(final).path
    if not path.endswith("/"):
        path += "/"
    pagine = [final]
    for href in re.findall(r'href="([^"]+)"', html):
        full = abs_url(origin_of(final), href)
        cpath = urllib.parse.urlsplit(full).path
        if cpath.startswith(path) and cpath != path and "/" not in cpath[len(path):].strip("/"):
            pagine.append(full if full.endswith("/") else full + "/")
    visti = set()
    for pagina in pagine:
        if pagina in visti:
            continue
        visti.add(pagina)
        try:
            body, page_url, _status = client.get(pagina) if pagina != final else (html, final, 200)
        except SourceError:
            continue
        if pagina == final:
            body, page_url = html, final
        for item in []:
            pass
        blocks = re.findall(
            r'<h4[^>]*>\s*(?:&nbsp;|\s)*<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>',
            body,
            flags=re.I | re.S,
        )
        for href, title in blocks:
            text = clean(title)
            num = re.search(r"\bN\.?\s*(\d+)\b", text, flags=re.I)
            if not num or numero_normale(num.group(1)) != numero.split("/")[0]:
                continue
            window = body[max(0, body.find(href) - 200) : body.find(href) + 400]
            if data and first_date(clean(window)) not in {data, ""}:
                trovata = first_date(clean(window))
                if trovata and trovata != data:
                    continue
            return {"url": abs_url(page_url, href), "numero": old.get("numero") or "", "data": data}
    return None


def cerca_storico_mycity(client: Client, fonte: str, old: dict):
    numero = numero_normale(old.get("numero"))
    data = old.get("data") or ""
    if not numero or not data:
        return None
    html, final, _status = client.get(fonte)
    load = re.search(r'load-url="([^"]+)"', html)
    if not load:
        return None
    api = load.group(1)
    params = urllib.parse.urlencode({"page": "1", "search": numero.split("/")[0], "sort": "personalizzato", "type": "0"})
    body, _api, _status = client.get(api + ("&" if "?" in api else "?") + params, headers={"Accept": "application/json"})
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return None
    rows = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return None
    for row in rows:
        if not isinstance(row, dict):
            continue
        titolo = str(row.get("title") or row.get("titolo") or "")
        numero_riga = str(row.get("number") or row.get("numero") or "")
        data_riga = first_date(str(row.get("published_at") or row.get("date") or row.get("data") or ""))
        link = str(row.get("url") or row.get("link") or row.get("href") or "")
        candidato = {"numero": numero_riga or (numero if numero.split("/")[0] in titolo else ""), "data": data_riga, "url": link}
        if link and stesso_atto(old, candidato):
            return {"url": link, "numero": old.get("numero") or "", "data": data}
    return None


def cerca_storico(client: Client, comune: dict, old: dict):
    """Cerca un atto uscito dall'elenco nello storico pubblico. None se non c'è."""
    kind = comune.get("scraper")
    fonte = comune.get("fonte") or comune.get("alboUrl") or ""
    if not fonte or not numero_normale(old.get("numero")) or not old.get("data"):
        return None
    try:
        if kind == "urbi":
            return cerca_storico_urbi(client, fonte, old)
        if kind in {"halley", "servizionline"}:
            return cerca_storico_halley(client, fonte, old)
        if kind == "gazzetta":
            return cerca_storico_gazzetta(client, fonte, old)
        if kind == "mycity":
            return cerca_storico_mycity(client, fonte, old)
    except SourceError as exc:
        print(f"  storico non verificato: {exc}", flush=True)
        return None
    return None


def unisci_con_storico(client: Client, comune: dict, previous, fresh):
    """Tiene gli atti appena letti e, se spariscono, solo quelli ritrovati nello storico."""
    attuali = []
    chiavi = set()
    urls = set()
    for item in fresh or []:
        row = {
            "titolo": item.get("titolo") or "",
            "data": item.get("data") or "",
            "tipo": item.get("tipo") or "",
            "numero": item.get("numero") or "",
            "url": item.get("url") or "",
        }
        if not row["url"]:
            continue
        attuali.append(row)
        chiavi.add(chiave_atto(row))
        urls.add(row["url"])
    attuali.sort(key=lambda item: (item.get("data") or "", item.get("titolo") or ""), reverse=True)
    attuali = attuali[:LIMIT]
    storico = []
    for old in previous or []:
        if not old.get("url") or old.get("url") in urls or chiave_atto(old) in chiavi:
            continue
        trovato = cerca_storico(client, comune, old)
        if not trovato:
            print(f"  uscito dall'elenco, non nello storico: {old.get('numero') or old.get('titolo','')[:60]}", flush=True)
            continue
        row = {
            "titolo": old.get("titolo") or "",
            "data": trovato.get("data") or old.get("data") or "",
            "tipo": old.get("tipo") or "",
            "numero": trovato.get("numero") or old.get("numero") or "",
            "url": trovato.get("url") or old.get("url"),
            "storico": True,
        }
        storico.append(row)
        print(f"  STORICO {row['numero']} {row['data']}", flush=True)
    return attuali + storico


def merge_atti(previous, fresh):
    by_url = {}
    for item in list(previous or []) + list(fresh or []):
        url = item.get("url")
        if not url:
            continue
        by_url[url] = {
            "titolo": item.get("titolo") or "",
            "data": item.get("data") or "",
            "tipo": item.get("tipo") or "",
            "numero": item.get("numero") or "",
            "url": url,
        }
    atti = list(by_url.values())
    atti.sort(key=lambda item: (item.get("data") or "", item.get("titolo") or ""), reverse=True)
    return atti[:LIMIT]


def load_previous():
    if not ALBO_PATH.exists():
        return {}
    try:
        data = json.loads(ALBO_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return data.get("comuni") or {}


def write_outputs(comuni_state: dict):
    payload = {"aggiornato": now_iso(), "comuni": comuni_state}
    ALBO_PATH.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(payload, ensure_ascii=False, indent=2)
    ALBO_PATH.write_text(encoded + "\n", encoding="utf-8")
    js = (
        "/* Generato da scripts/sync_albo.py. Elenco degli atti letti dagli albi pretori. */\n"
        "window.M5S_ALBO = "
        + encoded.replace("<", "\\u003c")
        + ";\n"
    )
    JS_PATH.write_text(js, encoding="utf-8")


def main(argv):
    plan = run_plan()
    if plan is None:
        print("Questo cron non cade in una finestra prevista (00:00, 01:00, 02:30, 04:00 ora di Roma): ignorato.")
        return 0
    only = ""
    if "--only" in argv:
        only = argv[argv.index("--only") + 1]
        plan = "full"
    comuni = json.loads(COMUNI_PATH.read_text(encoding="utf-8"))
    previous = load_previous()
    state = dict(previous)
    client = Client()
    now = datetime.now(ROME)
    print(f"Sincronizzazione albi, ora di Roma: {now.isoformat(timespec='seconds')} modalità={plan}", flush=True)
    for comune in comuni:
        slug = comune["slug"]
        if only and slug != only:
            continue
        nome = comune["nome"]
        prior = previous.get(slug) or {}
        if not comune.get("scraper"):
            print(f"RISULTATO {nome} | saltato | nessun albo automatico configurato", flush=True)
            continue
        if plan == "retry" and succeeded_tonight(prior, now):
            print(
                f"RISULTATO {nome} | saltato | già letto stanotte | atti={len(prior.get('atti') or [])}",
                flush=True,
            )
            continue
        client.start_comune(nome)
        try:
            acts, used = scrape_comune(client, comune)
            if acts:
                merged = unisci_con_storico(client, comune, prior.get("atti"), acts)
                state[slug] = {
                    "ok": True,
                    "esito": "atti",
                    "errore": "",
                    "fonte": used,
                    "aggiornato": now_iso(),
                    "atti": merged,
                }
                print(
                    f"RISULTATO {nome} | richieste={client.request_count} | ultimo={client.last_status} | atti={len(acts)} | in elenco={len(merged)} | esito=atti",
                    flush=True,
                )
            else:
                kept = list(prior.get("atti") or [])
                state[slug] = {
                    "ok": True,
                    "esito": "vuoto",
                    "errore": "",
                    "fonte": used or prior.get("fonte") or comune.get("fonte") or "",
                    "aggiornato": now_iso(),
                    "atti": kept,
                }
                print(
                    f"RISULTATO {nome} | richieste={client.request_count} | ultimo={client.last_status} | atti=0 | elenco precedente conservato ({len(kept)}) | esito=vuoto",
                    flush=True,
                )
        except Exception as exc:  # un comune non deve bloccare gli altri
            technical = str(exc).strip() or exc.__class__.__name__
            if not isinstance(exc, SourceError):
                technical = f"Errore imprevisto: {technical}"
            kept = list(prior.get("atti") or [])
            state[slug] = {
                "ok": False,
                "esito": "errore",
                "errore": friendly_error(technical),
                "fonte": prior.get("fonte") or comune.get("fonte") or comune.get("alboUrl") or "",
                "aggiornato": now_iso(),
                "atti": kept,
            }
            print(
                f"RISULTATO {nome} | richieste={client.request_count} | ultimo={client.last_status} | atti conservati={len(kept)} | esito=errore | {technical}",
                flush=True,
            )
    write_outputs(state)
    print("File aggiornati:", ALBO_PATH.relative_to(ROOT), JS_PATH.relative_to(ROOT), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
