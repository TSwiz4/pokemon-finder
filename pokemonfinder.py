#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PokemonFinder Launcher
Starts the Next.js restock tracker on port 6969.

Usage:
  python pokemonfinder.py          # start normally
  python pokemonfinder.py --reset  # wipe DB and reseed with fresh Oldsmar stores
  python pokemonfinder.py --build  # production build + start
"""

import os
import sys
import subprocess
import shutil

NPM = "npm.cmd" if sys.platform == "win32" else "npm"

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(PROJECT_DIR, "data")
DB_FILES = [
    os.path.join(DATA_DIR, "pokemon-finder.db"),
    os.path.join(DATA_DIR, "pokemon-finder.db-shm"),
    os.path.join(DATA_DIR, "pokemon-finder.db-wal"),
]

def banner():
    print("\n" + "="*50)
    print("  PokemonFinder -- Restock Tracker")
    print("  Oldsmar, FL  |  localhost:6969")
    print("="*50 + "\n")

def reset_db():
    print("[*] Resetting database...")
    for f in DB_FILES:
        if os.path.exists(f):
            try:
                os.remove(f)
                print(f"    Deleted {os.path.basename(f)}")
            except PermissionError:
                print(f"    [!] Could not delete {os.path.basename(f)} -- close the server first.")
                sys.exit(1)
    print("[+] Database reset. Will reseed Oldsmar stores on next launch.\n")

def check_node():
    if not shutil.which("node"):
        print("[!] Node.js not found. Install from https://nodejs.org")
        sys.exit(1)
    if not shutil.which("npm"):
        print("[!] npm not found.")
        sys.exit(1)

def install_deps():
    node_modules = os.path.join(PROJECT_DIR, "node_modules")
    if not os.path.exists(node_modules):
        print("[*] Installing dependencies...")
        subprocess.run([NPM, "install"], cwd=PROJECT_DIR, check=True)
        print("[+] Dependencies installed.\n")

def run_dev():
    print("[+] Starting dev server at http://localhost:6969\n")
    print("    Press Ctrl+C to stop.\n")
    try:
        subprocess.run([NPM, "run", "dev"], cwd=PROJECT_DIR)
    except KeyboardInterrupt:
        print("\n\n[*] PokemonFinder stopped.")

def run_build_and_start():
    print("[*] Building for production...")
    subprocess.run([NPM, "run", "build"], cwd=PROJECT_DIR, check=True)
    print("\n[+] Starting production server at http://localhost:6969\n")
    print("    Press Ctrl+C to stop.\n")
    try:
        subprocess.run([NPM, "run", "start"], cwd=PROJECT_DIR)
    except KeyboardInterrupt:
        print("\n\n[*] PokemonFinder stopped.")

def main():
    args = sys.argv[1:]
    do_reset = "--reset" in args
    do_build = "--build" in args

    banner()
    check_node()

    if do_reset:
        reset_db()

    install_deps()

    if do_build:
        run_build_and_start()
    else:
        run_dev()

if __name__ == "__main__":
    main()
