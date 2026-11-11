#!/usr/bin/env python3
"""Turn one collected news JSON into station data."""

from __future__ import annotations

import argparse
import os

try:
    from .pipeline import (
        DeepSeekProvider,
        NoopProvider,
        build_station_data,
        load_json,
        write_json,
    )
except ImportError:
    from pipeline import (
        DeepSeekProvider,
        NoopProvider,
        build_station_data,
        load_json,
        write_json,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("news_file")
    parser.add_argument("sources_file")
    parser.add_argument("output_file")
    parser.add_argument("--provider", choices=("deepseek", "noop"), default="deepseek")
    parser.add_argument("--stage", choices=("raw", "full"), default="full")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.provider == "deepseek":
        api_key = os.environ.get("DEEPSEEK_API_KEY")
        if not api_key:
            raise SystemExit("DEEPSEEK_API_KEY is required for the full DeepSeek provider")
        provider = DeepSeekProvider(api_key, os.environ.get("DEEPSEEK_MODEL", "deepseek-chat"))
    else:
        provider = NoopProvider()

    station_data = build_station_data(
        load_json(args.news_file), args.sources_file, provider, args.stage
    )
    write_json(args.output_file, station_data)
    print(
        f"[saved] {args.output_file}: {station_data['stats']['items_kept']} items, "
        f"{station_data['stats']['topics']} topics, stage={args.stage}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
