#!/bin/bash
cd "$(dirname "$0")"
echo "Запуск сервера..."
open http://localhost:8765/
python3 -m http.server 8765
