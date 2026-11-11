#!/usr/bin/env python3
"""Data processing helpers for the AI daily station."""

from __future__ import annotations

import json
import math
import os
import re
from collections import Counter
from dataclasses import dataclass
from datetime import date
from html.parser import HTMLParser
from typing import Any, Protocol

import requests


CATEGORIES = [
    "AI 前沿",
    "产品、设计与商业",
    "工程与编程",
    "硬件",
    "安全",
    "观点与杂谈",
]

TITLE_BATCH_SIZE = 20

CRYPTO_TERMS = re.compile(
    r"bitcoin|btc|ethereum|ether\b|crypto|binance|coinbase|okx|mexc|"
    r"stablecoin|token sale|airdrop|币圈|比特币|以太坊|交易所|加密货币",
    re.IGNORECASE,
)
CRYPTO_KEEP_TERMS = re.compile(
    r"treasury|department of justice|doj\b|sec\b|lawsuit|regulat|sanction|"
    r"data leak|breach|财政部|司法部|证监会|监管|制裁|泄露",
    re.IGNORECASE,
)


class _HTMLTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def clean_summary(value: str, limit: int = 600) -> str:
    parser = _HTMLTextParser()
    try:
        parser.feed(value or "")
    except Exception:
        return (value or "")[:limit]
    text = re.sub(r"\s+", " ", " ".join(parser.parts)).strip()
    return text[:limit]


class TranslationProvider(Protocol):
    def translate_titles(self, titles: list[str]) -> list[str]:
        ...

    def cluster_topics(self, items: list[ProcessedItem]) -> list[dict[str, Any]]:
        ...

    def write_headline(
        self, topics: list[dict[str, Any]], stream: list[dict[str, Any]]
    ) -> str:
        ...


class NoopProvider:
    def translate_titles(self, titles: list[str]) -> list[str]:
        return titles

    def cluster_topics(self, items: list[ProcessedItem]) -> list[dict[str, Any]]:
        return [
            {
                "title": group[0].item["zh_title"],
                "summary": "；".join(
                    processed.item["orig_title"] for processed in group[:3]
                ),
                "items": group,
            }
            for group in cluster_items(items)
        ]

    def write_headline(
        self, topics: list[dict[str, Any]], stream: list[dict[str, Any]]
    ) -> str:
        if topics:
            return "今日更新已完成，以下是与 AI、产品和工程相关的重点话题。"
        return "今日更新已完成，可先浏览时间流中的原始条目。"


class DeepSeekProvider:
    def __init__(self, api_key: str, model: str = "deepseek-chat") -> None:
        self.api_key = api_key
        self.model = model
        self.url = os.environ.get(
            "DEEPSEEK_API_URL", "https://api.deepseek.com/v1/chat/completions"
        )

    def _chat(self, prompt: str, json_mode: bool = False) -> str:
        body: dict[str, Any] = {
            "model": self.model,
            "temperature": 0.3,
            "messages": [
                {"role": "system", "content": "你是严谨的中文科技资讯编辑。"},
                {"role": "user", "content": prompt},
            ],
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        response = requests.post(
            self.url,
            headers={"Authorization": f"Bearer {self.api_key}"},
            json=body,
            timeout=60,
        )
        if response.status_code >= 400:
            raise RuntimeError(
                f"DeepSeek request failed: HTTP {response.status_code}: {response.text}"
            )
        try:
            return response.json()["choices"][0]["message"]["content"].strip()
        except (KeyError, IndexError, ValueError) as exc:
            raise RuntimeError(f"Unexpected DeepSeek response: {response.text}") from exc

    def translate_titles(self, titles: list[str]) -> list[str]:
        translated: list[str] = []
        for start in range(0, len(titles), TITLE_BATCH_SIZE):
            batch = titles[start : start + TITLE_BATCH_SIZE]
            prompt = (
                "把下面 JSON 数组里的新闻标题逐条翻译成中文。专有名词保留通行中文译名；"
                "若已是中文则轻微润色。输出严格 JSON："
                '{"titles":["译文1","译文2"]}。数量、顺序必须与输入一致，不要解释。\n'
                + json.dumps(batch, ensure_ascii=False)
            )
            try:
                parsed = json.loads(self._chat(prompt, json_mode=True))
                batch_translations = parsed["titles"]
                if not isinstance(batch_translations, list) or len(batch_translations) != len(batch):
                    raise ValueError("title translation count mismatch")
                if any(not isinstance(translation, str) for translation in batch_translations):
                    raise ValueError("title translations must be strings")
            except (KeyError, TypeError, ValueError, json.JSONDecodeError):
                translated.extend(batch)
                continue
            translated.extend(
                str(translation).strip() or original
                for original, translation in zip(batch, batch_translations)
            )
        return translated

    def cluster_topics(self, items: list[ProcessedItem]) -> list[dict[str, Any]]:
        material = "\n".join(
            f"{number}. [{processed.item['source']}] {processed.item['zh_title']}"
            for number, processed in enumerate(items, start=1)
        )
        prompt = (
            "你是中文 AI 资讯台的话题聚类编辑。根据下面带序号的新闻标题，"
            "找出 3-7 个同一具体事件或具体趋势的话题。每个话题必须包含 2-6 条，"
            "且至少来自两个不同来源；不要因 AI、商业、政策、链接等泛词合并。"
            "summary 只能基于所列标题。输出严格 JSON："
            '{"topics":[{"title":"中文话题标题","summary":"2-3句中文摘要",'
            '"items":[序号,...]}]}。若当日没有满足规则的话题，输出 {"topics":[]}。\n'
            + material
        )
        try:
            parsed = json.loads(self._chat(prompt, json_mode=True))
            raw_topics = parsed["topics"]
        except (KeyError, TypeError, json.JSONDecodeError) as exc:
            raise RuntimeError("DeepSeek returned invalid topic clustering JSON") from exc

        result: list[dict[str, Any]] = []
        used_indices: set[int] = set()
        for raw_topic in raw_topics:
            indices: list[int] = []
            for value in raw_topic.get("items", []):
                index = int(value) - 1
                if 0 <= index < len(items) and index not in used_indices:
                    used_indices.add(index)
                    indices.append(index)
            if len(indices) > 6:
                for index in indices[6:]:
                    used_indices.remove(index)
                indices = indices[:6]
            group = [items[index] for index in indices]
            if len(indices) < 2 or len({item.item["source"] for item in group}) < 2:
                for index in indices:
                    used_indices.remove(index)
                continue
            result.append(
                {
                    "title": str(raw_topic["title"]),
                    "summary": str(raw_topic["summary"]),
                    "items": group,
                }
            )
            if len(result) == 7:
                break
        return result

    def write_headline(
        self, topics: list[dict[str, Any]], stream: list[dict[str, Any]]
    ) -> str:
        topic_lines = "\n".join(
            f"- {topic['title']}：{topic['summary']}" for topic in topics
        )
        item_lines = "\n".join(
            f"- {item['zh_title']}（{item['source']}）" for item in stream[:30]
        )
        prompt = (
            "你是 AI 资讯台编辑。基于下列话题摘要与条目标题写一段中文头条导读，"
            "2-4 句，只陈述材料中已有信息，不要空话。只输出导读正文。\n"
            f"话题：\n{topic_lines or '无'}\n\n条目：\n{item_lines}"
        )
        return self._chat(prompt)


@dataclass(frozen=True)
class ProcessedItem:
    item: dict[str, Any]
    summary: str
    category: str


def load_source_index(path: str) -> dict[str, dict[str, str]]:
    with open(path, encoding="utf-8") as file:
        sources = json.load(file)
    result = {source["name"]: source for source in sources}
    if len(result) != len(sources):
        raise ValueError("Source pool contains duplicate names")
    return result


def flatten_items(
    news: dict[str, Any], source_index: dict[str, dict[str, str]]
) -> list[ProcessedItem]:
    result: list[ProcessedItem] = []
    for source in news.get("sources", []):
        name = source.get("name", "")
        if name not in source_index:
            raise ValueError(f"Collected source is absent from source pool: {name}")
        if source.get("url") != source_index[name]["xmlUrl"]:
            raise ValueError(f"Collected feed URL differs from source pool: {name}")
        category = source_index[name]["category"]
        for item in source.get("items", []):
            result.append(
                ProcessedItem(
                    {
                        "orig_title": item.get("title", ""),
                        "source": name,
                        "category": category,
                        "link": item.get("link", ""),
                        "published_utc": item.get("published_utc", ""),
                    },
                    clean_summary(item.get("summary", "")),
                    category,
                )
            )
    return result


def is_pure_crypto(title: str) -> bool:
    if not CRYPTO_TERMS.search(title):
        return False
    if CRYPTO_KEEP_TERMS.search(title):
        return False
    if re.search(r"binance", title, re.IGNORECASE) and not re.search(
        r"treasury|doj\b|department of justice", title, re.IGNORECASE
    ):
        return True
    return True


def split_items(items: list[ProcessedItem]) -> tuple[list[ProcessedItem], list[dict[str, str]]]:
    kept: list[ProcessedItem] = []
    filtered: list[dict[str, str]] = []
    for processed in items:
        if is_pure_crypto(processed.item["orig_title"]):
            filtered.append(
                {
                    "orig_title": processed.item["orig_title"],
                    "source": processed.item["source"],
                    "reason": "纯币圈，已按编辑规则滤掉",
                }
            )
        else:
            kept.append(processed)
    return kept, filtered


def _tokens(value: str) -> set[str]:
    normalized = value.lower()
    english = {word for word in re.findall(r"[a-z][a-z0-9]{2,}", normalized) if word not in {"the", "and", "for", "with", "from"}}
    cjk = {
        normalized[index : index + 2]
        for index in range(len(normalized) - 1)
        if re.match(r"[\u4e00-\u9fff]", normalized[index])
    }
    return english | cjk


def _similarity(left: Counter[str], right: Counter[str]) -> float:
    if not left or not right:
        return 0.0
    common = set(left) & set(right)
    numerator = sum(left[key] * right[key] for key in common)
    denominator = math.sqrt(
        sum(value * value for value in left.values())
        * sum(value * value for value in right.values())
    )
    return numerator / denominator if denominator else 0.0


def cluster_items(items: list[ProcessedItem], max_topics: int = 7) -> list[list[ProcessedItem]]:
    if len(items) < 2:
        return []
    vectors = [Counter(_tokens(item.item["orig_title"] + " " + item.summary)) for item in items]
    clusters: list[list[int]] = []

    for current in range(len(items)):
        candidates: list[tuple[float, int]] = []
        for cluster_index, cluster in enumerate(clusters):
            representative = max(
                cluster,
                key=lambda index: _similarity(vectors[current], vectors[index]),
            )
            score = _similarity(vectors[current], vectors[representative])
            if score >= 0.44 and len(cluster) < 6:
                candidates.append((score, -len(cluster), cluster_index))
        if candidates:
            _, _, best = max(candidates)
            clusters[best].append(current)
        else:
            clusters.append([current])

    selected = [cluster for cluster in clusters if 2 <= len(cluster) <= 6]
    selected.sort(key=lambda cluster: (-len(cluster), cluster[0]))
    return [[items[index] for index in cluster] for cluster in selected[:max_topics]]


def build_station_data(
    news: dict[str, Any],
    source_pool_path: str,
    provider: TranslationProvider,
    stage: str = "full",
) -> dict[str, Any]:
    if stage not in {"raw", "full"}:
        raise ValueError("stage must be raw or full")

    source_index = load_source_index(source_pool_path)
    all_items = flatten_items(news, source_index)
    kept, filtered = split_items(all_items)
    kept.sort(
        key=lambda processed: processed.item["published_utc"],
        reverse=True,
    )
    weekday_names = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
    selected_date = news["date_local"]
    year, month, day = (int(part) for part in selected_date.split("-"))
    weekday = weekday_names[date(year, month, day).weekday()]

    if stage == "raw":
        translated = [
            ProcessedItem(
                {**processed.item, "zh_title": processed.item["orig_title"]},
                processed.summary,
                processed.category,
            )
            for processed in kept
        ]
        stream = [
            {
                key: value
                for key, value in processed.item.items()
                if key not in {"summary", "published_utc"}
            }
            for processed in translated
        ]
        topics: list[dict[str, Any]] = []
        headline = "今日原始数据已更新，翻译、话题聚类与编辑导读随后覆盖。"
    else:
        zh_titles = provider.translate_titles(
            [processed.item["orig_title"] for processed in kept]
        )
        translated = []
        for processed, zh_title in zip(kept, zh_titles):
            item = {
                **processed.item,
                "zh_title": zh_title,
            }
            translated.append(ProcessedItem(item, processed.summary, processed.category))

        topic_groups = provider.cluster_topics(translated)
        topics = []
        for number, written in enumerate(topic_groups, start=1):
            topics.append(
                {
                    "id": f"T{number}",
                    "title": written["title"],
                    "summary": written["summary"],
                    "items": [
                        {
                            key: value
                            for key, value in processed.item.items()
                            if key not in {"published_utc"}
                        }
                        for processed in written["items"]
                    ],
                }
            )
        stream = [
            {
                key: value
                for key, value in processed.item.items()
                if key not in {"summary", "published_utc"}
            }
            for processed in translated
        ]
        headline = provider.write_headline(topics, stream)

    return {
        "date": selected_date,
        "weekday": weekday,
        "stats": {
            "sources_total": len(source_index),
            "sources_returned": len(news.get("sources", [])),
            "items_in_window": len(all_items),
            "items_kept": len(stream),
            "items_filtered": len(filtered),
            "topics": len(topics),
        },
        "headline": headline,
        "topics": topics,
        "stream": stream,
        "filtered": filtered,
    }


def load_json(path: str) -> dict[str, Any]:
    with open(path, encoding="utf-8") as file:
        return json.load(file)


def write_json(path: str, payload: dict[str, Any]) -> None:
    with open(path, "w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
        file.write("\n")
