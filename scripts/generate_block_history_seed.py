#!/usr/bin/env python3
"""Generate SQL seed rows for public.language_block_history.

Input JSON shape:
[
  {"user_id":"...", "language":"Spanish", "date":"2026-06-01", "minutes":30, "inserted_at":"2026-06-01T12:00:00Z"},
  ...
]

Run once for historical sessions after creating the Supabase table:
  python3 scripts/generate_block_history_seed.py sessions.json > block_history_seed.sql

The script chooses one random adjacent grid position whenever blocks are gained
and pops positions from the stack whenever blocks are lost (LIFO). The generated
SQL stores that random order so future visualizations can replay it exactly.
"""

from __future__ import annotations

import argparse
import json
import math
import random
from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from pathlib import Path

GRID_SIZE = 20
GRID_TOTAL_CELLS = GRID_SIZE * GRID_SIZE
PARAMS = {
    "decay_half_life_days": 10,
    "base_rate": Decimal("2.35"),
    "block_size": Decimal("10"),
    "gain_margin": Decimal("1"),
    "lose_margin": Decimal("0.92"),
    "multipliers": {
        "same_day": Decimal("2.3"),
        "consecutive_day": Decimal("2.25"),
        "same_week": Decimal("2.2"),
        "consecutive_week": Decimal("2.15"),
        "same_month": Decimal("2.05"),
        "consecutive_month": Decimal("2.02"),
        "default": Decimal("1.00"),
    },
}


def parse_date(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def days_between(a: datetime, b: datetime) -> float:
    return max(0.0, (b - a).total_seconds() / 86400)


def consistency_multiplier(previous: datetime | None, current: datetime) -> Decimal:
    if previous is None:
        return Decimal("1")
    gap = days_between(previous, current)
    m = PARAMS["multipliers"]
    if gap < 1:
        return m["same_day"]
    if gap <= 1.5:
        return m["consecutive_day"]
    if gap <= 7:
        return m["same_week"]
    if gap <= 14:
        return m["consecutive_week"]
    if gap <= 31:
        return m["same_month"]
    if gap <= 62:
        return m["consecutive_month"]
    return m["default"]


def compute_study_strength(sessions: list[dict]) -> list[dict]:
    value = Decimal("0")
    blocks = 0
    last_date = None
    timeline = []

    for session in sorted(sessions, key=lambda row: (row["date"], row.get("inserted_at", ""))):
        current_date = parse_date(session["date"])
        if last_date:
            value *= Decimal(str(math.exp(-days_between(last_date, current_date) / PARAMS["decay_half_life_days"])))

        multiplier = consistency_multiplier(last_date, current_date)
        value += Decimal(str(session.get("minutes") or 0)) * PARAMS["base_rate"] * multiplier

        gain_blocks = int(value / (PARAMS["block_size"] * PARAMS["gain_margin"]))
        if gain_blocks > blocks:
            blocks = gain_blocks

        lose_threshold = Decimal(blocks) * PARAMS["block_size"] * PARAMS["lose_margin"]
        if blocks > 0 and value < lose_threshold:
            blocks = int(value / (PARAMS["block_size"] * PARAMS["gain_margin"]))

        timeline.append({**session, "punctuation": value, "blocks": blocks})
        last_date = current_date

    return timeline


def random_position(stack: list[str], rng: random.Random) -> str | None:
    active = set(stack)
    if not active:
        center = GRID_SIZE // 2
        return f"{center},{center}"

    candidates = []
    for key in active:
        row, col = map(int, key.split(","))
        for nrow, ncol in ((row - 1, col), (row + 1, col), (row, col - 1), (row, col + 1)):
            candidate = f"{nrow},{ncol}"
            if 0 <= nrow < GRID_SIZE and 0 <= ncol < GRID_SIZE and candidate not in active and candidate not in candidates:
                candidates.append(candidate)

    if candidates:
        return rng.choice(candidates)

    remaining = [f"{index // GRID_SIZE},{index % GRID_SIZE}" for index in range(GRID_TOTAL_CELLS) if f"{index // GRID_SIZE},{index % GRID_SIZE}" not in active]
    return rng.choice(remaining) if remaining else None


def pg_array(values: list[str]) -> str:
    if not values:
        return "ARRAY[]::text[]"
    escaped = ["'" + value.replace("'", "''") + "'" for value in values]
    return "ARRAY[" + ",".join(escaped) + "]::text[]"


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def rows_for_group(sessions: list[dict], rng: random.Random) -> list[str]:
    timeline = compute_study_strength(sessions)
    stack: list[str] = []
    sql_rows = []

    for index, point in enumerate(timeline):
        previous_blocks = timeline[index - 1]["blocks"] if index else 0
        delta = point["blocks"] - previous_blocks
        added: list[str] = []
        removed: list[str] = []

        if delta > 0:
            for _ in range(delta):
                position = random_position(stack, rng)
                if position is None:
                    break
                stack.append(position)
                added.append(position)
        elif delta < 0:
            for _ in range(abs(delta)):
                if stack:
                    removed.append(stack.pop())

        visible = list(stack)
        active = set(visible)
        hidden = [f"{cell // GRID_SIZE},{cell % GRID_SIZE}" for cell in range(GRID_TOTAL_CELLS) if f"{cell // GRID_SIZE},{cell % GRID_SIZE}" not in active]
        sql_rows.append(
            "(" + ", ".join([
                sql_literal(point["user_id"]) + "::uuid",
                sql_literal(point["language"]),
                sql_literal(point["date"]) + "::date",
                "true" if added else "false",
                "true" if removed else "false",
                pg_array(added),
                pg_array(removed),
                str(point["punctuation"].quantize(Decimal("0.000001"))),
                pg_array(visible),
                pg_array(hidden),
                str(index + 1),
                "0",
            ]) + ")"
        )

    return sql_rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path, help="JSON file with historical entries")
    parser.add_argument("--seed", type=int, help="Optional reproducible random seed for review/testing")
    args = parser.parse_args()

    sessions = json.loads(args.input.read_text())
    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for session in sessions:
        grouped[(session["user_id"], session["language"])].append(session)

    rng = random.Random(args.seed) if args.seed is not None else random.SystemRandom()
    rows = []
    for group_sessions in grouped.values():
        rows.extend(rows_for_group(group_sessions, rng))

    print("insert into public.language_block_history (")
    print("  user_id, language, date, block_added, block_removed,")
    print("  position_added_block, position_removed_block, punctuation,")
    print("  visible_positions, hidden_positions, session_sequence, operation_index")
    print(") values")
    print(",\n".join(rows))
    print("on conflict (user_id, language, session_sequence) do nothing;")


if __name__ == "__main__":
    main()
