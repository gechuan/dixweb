#!/usr/bin/env bash
set -euo pipefail

readonly PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
readonly WINDOW_DATE="$(TZ=Asia/Shanghai python3 -c 'from datetime import datetime, timedelta; from zoneinfo import ZoneInfo; print((datetime.now(ZoneInfo("Asia/Shanghai")) - timedelta(days=1)).date())')"

cd "$PROJECT_ROOT"
python3 rss-pipeline/fetch_news.py \
  rss-pipeline/rss_sources.json \
  "rss-pipeline/news_${WINDOW_DATE}.json" \
  --date "$WINDOW_DATE"
python3 rss-pipeline/process_news.py \
  "rss-pipeline/news_${WINDOW_DATE}.json" \
  rss-pipeline/rss_sources.json \
  src/data/rss.json \
  --provider deepseek \
  --stage full
npm run build
/usr/bin/find dist -name .DS_Store -delete
