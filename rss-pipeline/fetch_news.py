#!/usr/bin/env python3
"""Collect RSS items published during yesterday in Asia/Shanghai."""

from __future__ import annotations

import argparse
import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date as calendar_date
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import feedparser
import requests


USER_TZ = ZoneInfo("Asia/Shanghai")
STALE_HOURS = 72
MAX_RETRIES = 3
TIMEOUT = 25
USER_AGENT = "Mozilla/5.0 (AI-Daily-Brief/1.0)"
MAX_WORKERS = 12


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("sources_file")
    parser.add_argument("output_file")
    parser.add_argument("--date", help="Override the Asia/Shanghai window date, YYYY-MM-DD")
    return parser.parse_args()


def window_utc(value: str | None) -> tuple[datetime, datetime, calendar_date]:
    if value:
        try:
            selected = calendar_date.fromisoformat(value)
        except ValueError as exc:
            raise ValueError("--date must use YYYY-MM-DD") from exc
    else:
        selected = (datetime.now(USER_TZ) - timedelta(days=1)).date()
    start_local = datetime(selected.year, selected.month, selected.day, tzinfo=USER_TZ)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc), selected


def load_sources(path: str) -> list[dict[str, str]]:
    with open(path, encoding="utf-8") as file:
        raw = json.load(file)
    if isinstance(raw, dict):
        raw = raw.get("sources", raw)
    sources = []
    for source in raw:
        url = source.get("url") or source.get("xmlUrl")
        if source.get("name") and url:
            sources.append({"name": source["name"], "url": url})
    return sources


def fetch_feed(url: str) -> tuple[object | None, str | None]:
    last_error: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = requests.get(url, timeout=TIMEOUT, headers={"User-Agent": USER_AGENT})
            response.raise_for_status()
            feed = feedparser.parse(response.content)
            if feed.bozo and not feed.entries:
                raise ValueError(f"feed parse failed: {feed.bozo_exception}")
            return feed, None
        except Exception as error:
            last_error = error
            if attempt < MAX_RETRIES:
                time.sleep(2 * attempt)
    return None, str(last_error)


def entry_time(entry: object) -> datetime | None:
    for key in ("published_parsed", "updated_parsed"):
        parsed = getattr(entry, key, None)
        if parsed:
            return datetime(*parsed[:6], tzinfo=timezone.utc)
    return None


def entry_link(entry: object) -> str:
    link = (getattr(entry, "link", "") or "").strip()
    if link:
        return link
    for rel in ("alternate", "enclosure"):
        for candidate in getattr(entry, "links", []) or []:
            if candidate.get("rel") == rel and candidate.get("href"):
                return candidate["href"].strip()
    return ""


def collect_source(
    source: dict[str, str],
    win_start: datetime,
    win_end: datetime,
    stale_cutoff: datetime,
) -> tuple[dict[str, object] | None, dict[str, str] | None]:
    feed, error = fetch_feed(source["url"])
    if feed is None:
        return None, {
            "name": source["name"],
            "url": source["url"],
            "reason": f"fetch failed after {MAX_RETRIES} tries: {error}",
        }

    if not feed.entries:
        return None, {
            "name": source["name"],
            "url": source["url"],
            "reason": "feed has no entries",
        }

    latest = max(
        (entry_time(entry) for entry in feed.entries if entry_time(entry)),
        default=None,
    )
    if latest and latest < stale_cutoff:
        return None, {
            "name": source["name"],
            "url": source["url"],
            "reason": f"latest item too old ({latest:%Y-%m-%d %H:%M} UTC)",
        }

    items = []
    for entry in feed.entries:
        published = entry_time(entry)
        if not published or not win_start <= published < win_end:
            continue
        items.append(
            {
                "title": (getattr(entry, "title", "") or "").strip(),
                "link": entry_link(entry),
                "published_utc": published.strftime("%Y-%m-%d %H:%M"),
                "summary": getattr(entry, "summary", "") or getattr(entry, "description", "") or "",
            }
        )
    return {"name": source["name"], "url": source["url"], "items": items}, None


def collect_sources(
    sources: list[dict[str, str]],
    win_start: datetime,
    win_end: datetime,
    stale_cutoff: datetime,
) -> tuple[list[dict[str, object]], list[dict[str, str]]]:
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        results = list(
            executor.map(
                lambda source: collect_source(source, win_start, win_end, stale_cutoff),
                sources,
            )
        )

    returned = [result for result, _ in results if result]
    skipped = [skip for _, skip in results if skip]
    return returned, skipped


def main() -> int:
    args = parse_args()
    sources = load_sources(args.sources_file)
    win_start, win_end, window_date = window_utc(args.date)
    stale_cutoff = datetime.now(timezone.utc) - timedelta(hours=STALE_HOURS)

    print(
        f"[window] {window_date} Asia/Shanghai <=> UTC "
        f"{win_start:%Y-%m-%d %H:%M} ~ {win_end:%Y-%m-%d %H:%M}"
    )
    returned, skipped = collect_sources(sources, win_start, win_end, stale_cutoff)
    for source in returned:
        print(f"[ok] {source['name']}: {len(source['items'])} items in window")
    for source in skipped:
        print(f"[skip] {source['name']}: {source['reason']}")

    payload = {
        "date_local": str(window_date),
        "window_utc": [win_start.isoformat(), win_end.isoformat()],
        "sources": returned,
        "skipped": skipped,
    }
    output = Path(args.output_file)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"[saved] {output}: {len(returned)} returned sources, "
        f"{sum(len(source['items']) for source in returned)} items, {len(skipped)} skipped"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
