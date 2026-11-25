#!/usr/bin/env python3
"""Pubblica lo zip come Release e cancella quelle più vecchie di 30 giorni."""

from __future__ import annotations

import json
import os
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
ROME = ZoneInfo("Europe/Rome")


def output(name: str, value: str) -> None:
    print(f"{name}={value}")
    path = os.environ.get("GITHUB_OUTPUT")
    if not path:
        return
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(f"{name}={value}\n")


def gh(*args, check=True):
    result = subprocess.run(["gh", *args], check=False, capture_output=True, text=True)
    if check and result.returncode != 0:
        print(result.stderr.strip() or result.stdout.strip() or "gh ha restituito un errore")
        raise SystemExit(result.returncode)
    return result


def main() -> int:
    riepilogo_path = ROOT / "dist" / "riepilogo.json"
    if not riepilogo_path.exists():
        output("release_url", "")
        output("zip_url", "")
        print("Nessun riepilogo")
        return 0
    info = json.loads(riepilogo_path.read_text(encoding="utf-8"))
    if not info.get("zip") or info.get("pubblica") is False:
        output("release_url", "")
        output("zip_url", "")
        print("Nessuno zip da pubblicare")
        return 0
    tag = info["tag"]
    zip_path = ROOT / info["zip"]
    repo = os.environ.get("GITHUB_REPOSITORY") or ""
    gh("release", "delete", tag, "--yes", "--cleanup-tag", check=False)
    notes = (
        f"Atti nuovi: {info.get('atti', 0)}. "
        f"Documenti scaricati: {info.get('documenti', 0)}. "
        f"Atti senza file perché il documento non è pubblico senza login: {info.get('senza_file', 0)}."
    )
    creato = gh(
        "release",
        "create",
        tag,
        str(zip_path),
        "--title",
        f"Albo pretorio {tag.removeprefix('albo-')}",
        "--notes",
        notes,
    )
    if creato.returncode != 0:
        print(creato.stderr)
        return creato.returncode
    release_url = f"https://github.com/{repo}/releases/tag/{tag}" if repo else ""
    zip_url = f"https://github.com/{repo}/releases/download/{tag}/{zip_path.name}" if repo else ""
    output("release_url", release_url)
    output("zip_url", zip_url)
    print(release_url)
    print(zip_url)

    limite = datetime.now(ROME).date() - timedelta(days=30)
    elenco = gh("release", "list", "--limit", "100", "--json", "tagName,publishedAt")
    if elenco.returncode != 0:
        print(elenco.stderr)
        return 0
    for item in json.loads(elenco.stdout or "[]"):
        nome = item.get("tagName") or ""
        if not nome.startswith("albo-") or nome == tag:
            continue
        try:
            giorno = datetime.fromisoformat(nome.removeprefix("albo-")).date()
        except ValueError:
            continue
        if giorno < limite:
            print(f"Rimuovo la release vecchia {nome}")
            gh("release", "delete", nome, "--yes", "--cleanup-tag", check=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
