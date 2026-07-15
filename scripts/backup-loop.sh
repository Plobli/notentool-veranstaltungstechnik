#!/bin/sh
# Täglicher Backup-Loop für den backup-Service (siehe docker-compose.yml).
# Führt sofort beim Start ein Backup aus und danach alle BACKUP_INTERVAL
# Sekunden (Default 86400 = 24 h). Nutzt dasselbe App-Image, daher ist
# better-sqlite3 vorhanden.
set -e
INTERVAL="${BACKUP_INTERVAL:-86400}"

while true; do
  echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') starte Backup"
  node /app/scripts/backup-voll.cjs || echo "[backup] FEHLER beim Backup"
  echo "[backup] nächster Lauf in ${INTERVAL}s"
  sleep "${INTERVAL}"
done
