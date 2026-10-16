#!/bin/sh
set -eu
. /etc/kharcha-web/env
name="$1"
if [ "$name" = scheduled ]; then
  clock="$(TZ=Asia/Kolkata date +%H:%M)"
  weekday="$(TZ=Asia/Kolkata date +%u)"
  case "$clock" in
    06:00|23:30) exec "$0" prices ;;
    02:00) exec "$0" detectors ;;
    07:00) [ "$weekday" = 1 ] && exec "$0" digest ;;
  esac
  exit 0
fi
exec curl --fail --silent --show-error --max-time 60 -X POST -H "Authorization: Bearer $INGEST_TOKEN" "http://127.0.0.1:8790/api/jobs/$name"
