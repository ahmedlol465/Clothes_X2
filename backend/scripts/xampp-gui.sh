#!/bin/bash
# One-click launcher: make sure XAMPP is up, then open phpMyAdmin in Firefox.
set -u
CTL="$(cd "$(dirname "$0")" && pwd)/xampp-ctl.sh"
"$CTL" start >/dev/null 2>&1
sleep 1
firefox-esr --new-tab "http://127.0.0.1:8081/phpmyadmin/" >/dev/null 2>&1 &
