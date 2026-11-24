#!/usr/bin/env python3
"""Scrive negli output del workflow i link dell'ultima Release albo-."""

from __future__ import annotations

import json
import os
import subprocess


def output(name: str, value: str) -> None:
    print(f"{name}={value}")
    path = os.environ.get("GITHUB_OUTPUT")
    if not path:
        return
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(f"{name}={value}\n")


def main() -> int:
    repo = os.environ.get("GITHUB_REPOSITORY") or ""
    proc = subprocess.run(
        ["gh", "release", "list", "--limit", "30", "--json", "tagName,publishedAt"],
        check=False,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        print(proc.stderr.strip() or "Impossibile leggere le Release")
        return proc.returncode
    candidati = [
        item for item in json.loads(proc.stdout or "[]")
        if str(item.get("tagName") or "").startswith("albo-")
    ]
    candidati.sort(key=lambda item: item.get("publishedAt") or "", reverse=True)
    if not candidati or not repo:
        output("release_url", "")
        output("zip_url", "")
        print("Nessuna Release albo trovata")
        return 0
    tag = candidati[0]["tagName"]
    output("release_url", f"https://github.com/{repo}/releases/tag/{tag}")
    output("zip_url", f"https://github.com/{repo}/releases/download/{tag}/{tag}.zip")
    print(f"Ultima Release: {tag}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
