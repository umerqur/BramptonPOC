"""Generate a smaller local NYC 311 sample from a larger raw export.

Input:
    data/raw/nyc311/nyc311_partial_557mb.csv

Output:
    data/raw/nyc311/nyc311_sample_50000.csv

Raw CSV files are ignored by Git. This script is committed so the sample can be recreated locally.
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

DEFAULT_INPUT = Path("data/raw/nyc311/nyc311_partial_557mb.csv")
DEFAULT_OUTPUT = Path("data/raw/nyc311/nyc311_sample_50000.csv")
DEFAULT_ROWS = 50_000


def generate_sample(input_path: Path, output_path: Path, rows: int) -> None:
    if rows <= 0:
        raise ValueError("rows must be greater than 0")
    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    output_path.parent.mkdir(parents=True, exist_ok=True)

    written = 0
    with input_path.open("r", newline="", encoding="utf-8-sig", errors="replace") as src:
        reader = csv.reader(src)
        with output_path.open("w", newline="", encoding="utf-8", errors="replace") as dst:
            writer = csv.writer(dst)
            header = next(reader)
            writer.writerow(header)
            for row in reader:
                if written >= rows:
                    break
                writer.writerow(row)
                written += 1

    print(f"Wrote {written:,} rows to {output_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a local sample from a large NYC 311 raw export.")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--rows", type=int, default=DEFAULT_ROWS)
    args = parser.parse_args()

    generate_sample(args.input, args.output, args.rows)


if __name__ == "__main__":
    main()
