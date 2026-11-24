#!/bin/bash
# Terminal control panel for the user-space XAMPP stack (launched by foot).
set -u
CTL="$(cd "$(dirname "$0")" && pwd)/xampp-ctl.sh"

pause() { read -r -p "Press Enter to continue..." _; }

while true; do
  clear
  echo "================================================"
  echo "            XAMPP Control Panel"
  echo "================================================"
  "$CTL" status
  echo
  echo "  1) Start MariaDB + Apache"
  echo "  2) Stop"
  echo "  3) Restart"
  echo "  4) Open phpMyAdmin in Firefox"
  echo "  5) SQL shell (swtest)"
  echo "  6) Re-import data/db.json"
  echo "  q) Quit"
  echo
  read -r -p "Choose: " choice
  case "$choice" in
    1) "$CTL" start; pause ;;
    2) "$CTL" stop; pause ;;
    3) "$CTL" restart; pause ;;
    4) firefox-esr --new-tab "http://127.0.0.1:8081/phpmyadmin/" >/dev/null 2>&1 & ;;
    5) "$CTL" mysql ;;
    6) "$CTL" import; pause ;;
    q|Q) exit 0 ;;
  esac
done
