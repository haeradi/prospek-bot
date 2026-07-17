#!/usr/bin/env bash
# eom-cron.sh — Run EOM reset only on last day of month
TODAY=$(date +%d)
TOMORROW=$(date -d tomorrow +%d)
if [ "$TODAY" -gt "$TOMORROW" ]; then
  echo "EOM: Last day of month — running reset..."
  cd "$(dirname "$0")" && node eom-reset.js
else
  echo "EOM: Not last day (today=$TODAY, tomorrow=$TOMORROW), skipping."
fi
