#!/bin/bash
# Chromium Native Messaging entry (exec node host)
DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$DIR/host.mjs"
