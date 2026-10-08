#!/usr/bin/env bash
# Обновляет читалку из исходников Wednesday: пересобирает книгу и копирует в site/.
# Запускать из папки railway-deploy/. Ничего не коммитит и не пушит.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
python3 "$ROOT/tools/build_book.py" shipwreck-island
rsync -a --delete --exclude 'DEPLOY.md' --exclude 'ARCHITECTURE.md' "$ROOT/build/reader/" site/
echo "Готово. Дальше: git add -A && git commit -m 'Обновление глав' && git push (push только вручную)"
