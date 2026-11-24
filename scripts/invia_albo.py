#!/usr/bin/env python3
"""Invia i link della Release via Gmail.

L'email non ha mai un allegato: contiene solo i link alla pagina e allo zip.
Se manca SMTP_USER, SMTP_PASSWORD o MAIL_TO, oppure l'invio non riesce, esce con errore.
"""

from __future__ import annotations

import json
import os
import smtplib
import ssl
from email.message import EmailMessage
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    presenti = {
        "SMTP_USER": bool((os.environ.get("SMTP_USER") or "").strip()),
        "SMTP_PASSWORD": bool((os.environ.get("SMTP_PASSWORD") or "").strip()),
        "MAIL_TO": bool((os.environ.get("MAIL_TO") or "").strip()),
    }
    mancanti = [nome for nome, ok in presenti.items() if not ok]
    if mancanti:
        print("Invio non eseguito: mancano le variabili " + ", ".join(mancanti) + ". Vanno create come secrets di Actions del repository, con questi nomi esatti.")
        return 1

    user = os.environ["SMTP_USER"].strip()
    password = os.environ["SMTP_PASSWORD"].strip()
    destinatari = [parte.strip() for parte in os.environ["MAIL_TO"].split(",") if parte.strip()]
    prova = (os.environ.get("EMAIL_PROVA") or "").strip() == "1"
    release = (os.environ.get("RELEASE_URL") or "").strip()
    zip_url = (os.environ.get("ZIP_URL") or "").strip()

    msg = EmailMessage()
    msg["From"] = user
    msg["To"] = ", ".join(destinatari)

    if prova:
        msg["Subject"] = "Prova invio albo"
        testo = "Prova di invio. Questa email non contiene allegati.\n\n"
        testo += f"Release: {release or '(link non disponibile)'}\n"
        testo += f"Zip: {zip_url or '(link non disponibile)'}\n"
        msg.set_content(testo)
    else:
        riepilogo_path = ROOT / "dist" / "riepilogo.json"
        if not riepilogo_path.exists():
            print("Nessun riepilogo: invio saltato")
            return 0
        info = json.loads(riepilogo_path.read_text(encoding="utf-8"))
        if not info.get("zip"):
            print("Nessun atto nuovo: email non inviata")
            return 0
        tag = info.get("tag") or ""
        giorno = tag.replace("albo-", "")
        msg["Subject"] = f"Albo pretorio – atti del {giorno}"
        testo = (
            "Zip degli atti nuovi degli albi pretori sincronizzati. "
            "Il file non è allegato: si scarica dai link qui sotto.\n\n"
            f"Atti: {info.get('atti', 0)}\n"
            f"Documenti scaricati: {info.get('documenti', 0)}\n"
            f"Atti senza file (documento non pubblico senza login): {info.get('senza_file', 0)}\n"
        )
        if release:
            testo += f"\nRelease: {release}\n"
        if zip_url:
            testo += f"Zip: {zip_url}\n"
        testo += (
            "\nDentro lo zip ci sono indice.csv e PROMPT.txt. "
            "Il prompt si può incollare in ChatGPT insieme ai documenti: è un primo filtro, non una consulenza legale.\n"
        )
        msg.set_content(testo)

    context = ssl.create_default_context()
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context, timeout=60) as smtp:
            smtp.login(user, password)
            smtp.send_message(msg)
    except Exception as exc:
        print(f"Invio non riuscito: {exc.__class__.__name__}: {exc}")
        return 1
    print("Email di prova inviata" if prova else "Email inviata")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
