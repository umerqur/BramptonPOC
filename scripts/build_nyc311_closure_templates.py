"""Derive rule-based closure templates from NYC 311 resolution_description text.

Input:
    data/processed/nyc311_municipal_complaints.csv  (from clean_nyc311_service_requests.py)
Output:
    data/processed/nyc311_closure_templates.csv

The resident-facing final closure message in this POC is RULES BASED and TEMPLATE
CONTROLLED, not freeform AI generation. This script mines recurring NYC 311
`resolution_description` patterns into a small set of approved closure scenarios,
each with a policy-aligned template, the required on-file context, and a policy
note. At closure time the workflow selects a template by (request_type, scenario)
and grounds it in the officer-recorded field outcome — AI only assists with
summary and context.

Standard library only.
"""

from __future__ import annotations

import argparse
import csv
from collections import Counter
from pathlib import Path

DEFAULT_IN = Path("data/processed/nyc311_municipal_complaints.csv")
DEFAULT_OUT = Path("data/processed/nyc311_closure_templates.csv")

# Ordered scenario rules: the first whose keywords match the resolution text wins.
# Each scenario maps to an approved, policy-aligned template and the context that
# must be on file before staff may send it.
SCENARIO_RULES: list[dict] = [
    {
        "scenario": "no_violation_found",
        "keywords": ["no violation", "did not observe", "no condition", "within acceptable", "unable to substantiate", "not observed"],
        "template_text": (
            "Thank you for contacting the City about the {request_type} concern you reported. "
            "A by-law enforcement officer reviewed the location and did not observe a violation at the time of inspection. "
            "Based on that review, this file is being closed. If the issue recurs, please submit a new request so we can schedule a follow-up."
        ),
        "required_context": "{officer_field_outcome}",
        "policy_note": "Use only when the recorded field outcome is 'no violation observed'. Do not speculate about the original report.",
    },
    {
        "scenario": "notice_or_order_issued",
        "keywords": ["notice", "summons", "violation was issued", "order to", "directed to correct", "issued a"],
        "template_text": (
            "Thank you for contacting the City about the {request_type} concern. "
            "A by-law enforcement officer attended the location, observed a violation, and issued a notice to comply to the responsible party. "
            "The location will be re-inspected after the compliance period. Your service request has been closed now that enforcement action has been taken."
        ),
        "required_context": "{officer_field_outcome,reference_number}",
        "policy_note": "Use only when a notice/order reference number is recorded. Never disclose fines or internal notes to the resident.",
    },
    {
        "scenario": "resolved_or_corrected",
        "keywords": ["corrected", "resolved", "cleaned", "removed", "addressed", "completed the requested", "repaired"],
        "template_text": (
            "Thank you for reporting the {request_type} concern. "
            "A by-law enforcement officer attended the location and confirmed the issue has been addressed, so no further enforcement action was required. "
            "This file has been closed."
        ),
        "required_context": "{officer_field_outcome}",
        "policy_note": "Use only when the recorded field outcome confirms the issue was resolved or corrected.",
    },
    {
        "scenario": "referred_or_other_agency",
        "keywords": ["referred", "another agency", "transferred", "not the responsibility", "outside the jurisdiction"],
        "template_text": (
            "Thank you for contacting the City about the {request_type} concern. "
            "After review, this matter falls to another service area and has been referred accordingly. "
            "This 311 file has been closed; the receiving area will carry the matter forward."
        ),
        "required_context": "{review_note}",
        "policy_note": "Use when the matter was referred/transferred. Name the receiving area only if confirmed.",
    },
]

FALLBACK_SCENARIO = {
    "scenario": "reviewed_and_closed",
    "template_text": (
        "Thank you for contacting the City about the {request_type} concern. "
        "We reviewed the information provided along with the applicable by-law. Based on that review, this file has been closed. "
        "If the issue continues or recurs, please contact 311 and reference your case number."
    ),
    "required_context": "{review_note}",
    "policy_note": "Review-only closure. Does not claim a site visit; use when no officer field outcome is on file.",
}


def scenario_for(resolution: str) -> str:
    text = resolution.lower()
    for rule in SCENARIO_RULES:
        if any(kw in text for kw in rule["keywords"]):
            return rule["scenario"]
    return FALLBACK_SCENARIO["scenario"]


def build(in_path: Path, out_path: Path) -> tuple[int, Counter]:
    if not in_path.exists():
        raise FileNotFoundError(f"Normalized file not found: {in_path}. Run clean_nyc311_service_requests.py first.")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    by_scenario = {r["scenario"]: r for r in SCENARIO_RULES}
    by_scenario[FALLBACK_SCENARIO["scenario"]] = FALLBACK_SCENARIO

    counts: Counter = Counter()
    rows = 0
    with in_path.open("r", newline="", encoding="utf-8") as src:
        for row in csv.DictReader(src):
            rows += 1
            counts[scenario_for(row.get("resolution_description", ""))] += 1

    # Emit one approved template per scenario that actually occurred, plus the
    # review-only fallback (always available).
    with out_path.open("w", newline="", encoding="utf-8") as dst:
        writer = csv.writer(dst)
        writer.writerow(
            ["scenario", "request_type", "template_text", "required_context", "policy_note", "matched_count", "source"]
        )
        emit = [r for r in SCENARIO_RULES if counts[r["scenario"]] > 0] + [FALLBACK_SCENARIO]
        for rule in emit:
            writer.writerow(
                [
                    rule["scenario"],
                    "Any",
                    rule["template_text"],
                    rule["required_context"],
                    rule["policy_note"],
                    counts[rule["scenario"]],
                    "Derived from NYC 311 resolution_description patterns",
                ]
            )
    return rows, counts


def main() -> None:
    parser = argparse.ArgumentParser(description="Build rule-based closure templates from NYC 311 resolutions.")
    parser.add_argument("--in", dest="in_path", type=Path, default=DEFAULT_IN)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    rows, counts = build(args.in_path, args.out)
    print(f"Scanned {rows:,} normalized rows.")
    for scenario, n in counts.most_common():
        print(f"  {scenario}: {n:,}")
    print(f"Wrote approved closure templates to {args.out}")


if __name__ == "__main__":
    main()
