#!/usr/bin/env python3
"""Invia lo zip dell'albo via Gmail. Se i secrets mancano, esce senza errore."""

from __future__ import annotations

import json
import os
import smtplib
import ssl
from email.message import EmailMessage
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIMITE = 20 * 1024 * 1024


def main() -> int:
    user = (os.environ.get("SMTP_USER") or "").strip()
    password = (os.environ.get("SMTP_PASSWORD") or "").strip()
    destinatari = [parte.strip() for parte in (os.environ.get("MAIL_TO") or "").split(",") if parte.strip()]
    if not user or not password or not destinatari:
        print("Secrets SMTP assenti (SMTP_USER, SMTP_PASSWORD, MAIL_TO): invio saltato")
        return 0
    riepilogo_path = ROOT / "dist" / "riepilogo.json"
    if not riepilogo_path.exists():
        print("Nessun riepilogo: invio saltato")
        return 0
    info = json.loads(riepilogo_path.read_text(encoding="utf-8"))
    if not info.get("zip"):
        print("Nessun atto nuovo: email non inviata")
        return 0
    zip_path = ROOT / info["zip"]
    release = (os.environ.get("RELEASE_URL") or "").strip()
    zip_url = (os.environ.get("ZIP_URL") or "").strip()
    tag = info.get("tag") or ""
    giorno = tag.replace("albo-", "")
    msg = EmailMessage()
    msg["From"] = user
    msg["To"] = ", ".join(destinatari)
    msg["Subject"] = f"Albo pretorio – atti del {giorno}"
    testo = (
        "In allegato, se c'è spazio, lo zip degli atti nuovi degli albi pretori sincronizzati.\n\n"
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
    dimensione = zip_path.stat().st_size if zip_path.exists() else 0
    if zip_path.exists() and dimensione < LIMITE:
        msg.set_content(testo + "\nLo zip è allegato a questo messaggio.\n")
        msg.add_attachment(
            zip_path.read_bytes(),
            maintype="application",
            subtype="zip",
            filename=zip_path.name,
        )
    else:
        msg.set_content(
            testo
            + "\nLo zip supera 20 MB oppure non è sul runner: usa il link alla Release, non l'allegato.\n"
        )
    context = ssl.create_default_context()
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context, timeout=60) as smtp:
        smtp.login(user, password)
        smtp.send_message(msg)
    print(f"Email inviata a {', '.join(destinatari)} ({dimensione} byte)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
