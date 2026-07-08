"""Constructed municipal information-propagation layer over calibrated CTGAN ABM outputs.

This is an ADDITIVE, offline-only layer. It does NOT retrain CTGAN, does NOT rerun
the queue ABM, and does NOT overwrite the existing five calibrated CSVs. It reads
the calibrated CTGAN ABM outputs and constructs an explicit, deterministic graph of
operational-pressure nodes and edges, then propagates pressure across that graph over
the 30 simulated days.

HONEST FRAMING
--------------
This is a CONSTRUCTED / CALIBRATED information-propagation layer. It is NOT learned
from Brampton operational data. It is NOT a causal proof. It is NOT enforcement
decisioning. It is built on public municipal 311 benchmark data and calibrated CTGAN
ABM outputs. Edges are explicit operational dependencies (and, where geographic
adjacency is unavailable, a documented operational-similarity adjacency), not learned
causal structure. Every downstream operational decision stays human reviewed.

NODES (per scenario)
    district::<name>        one per district (all districts kept)
    complaint::<type>       the top-N demand complaint types (graph legibility)
    officer_capacity        singleton  - shared field-minute constraint
    supervisor_review       singleton  - sign-off bottleneck
    stale_backlog           singleton  - aged-case accumulation
    final_backlog           singleton  - end-of-run open queue

EDGES (explicit, deterministic)
    complaint_type -> district          demand feeds district workload
    district -> officer_capacity        backlog draws on shared field capacity
    district -> supervisor_review       throughput needs supervisor sign-off
    supervisor_review -> stale_backlog  unreviewed cases age into stale backlog
    stale_backlog -> final_backlog      stale cases persist into final backlog
    district -> district                operational-similarity adjacency (NOT geographic)
    complaint_type -> complaint_type    shared-workload similarity

PRESSURE FORMULA (per node/day, same weights as the frontend Operational Pressure Model)
    P = aC*C + aL*L + aR*R + aQ*Q + aS*S
        aC=0.20  aL=0.25  aR=0.15  aQ=0.25  aS=0.15
    Channels are normalized to [0,1] within each scenario. District nodes use the full
    five-channel formula (identical to src/services/municipalPressureModel.ts). Complaint
    nodes use the demand channels (C/L/Q); the singleton operational nodes take a single
    normalized operational signal as their base and rely mainly on inbound propagation.

ACTIVATION
    normal if P < 0.40 ; watch if P >= 0.40 ; red if P >= 0.70

PROPAGATION RULE
    For every node j at day t (t >= 2):
        incoming_j,t = sum over activated upstream i of  w_ij * transmit(zone_i,t-1) * total_i,t-1
        total_j,t    = clamp( base_j,t + decay * total_j,t-1 + incoming_j,t , 0, 1 )
    decay = 0.65 ; watch transmission = 0.20 ; red transmission = 0.35

Usage:
    python scripts/ctgan_abm/run_pressure_propagation.py
    python scripts/ctgan_abm/run_pressure_propagation.py \
        --input outputs/ctgan_abm_500k_calibrated \
        --output outputs/ctgan_abm_500k_pressure_propagation
"""

from __future__ import annotations

import argparse
import csv
import os
from pathlib import Path

# --------------------------------------------------------------------------- #
# Model constants (must stay in sync with the frontend Operational Pressure Model)
# --------------------------------------------------------------------------- #
WEIGHTS = {"C": 0.20, "L": 0.25, "R": 0.15, "Q": 0.25, "S": 0.15}
WATCH_THRESHOLD = 0.40
RED_THRESHOLD = 0.70
DECAY = 0.65
TRANSMIT = {"normal": 0.0, "watch": 0.20, "red": 0.35}
DAYS = 30
TOP_COMPLAINT_NODES = 20          # complaint types kept as nodes, per scenario
TOP_COMPLAINT_SOURCES = 10        # complaint types wired to districts
TOP_DISTRICT_TARGETS = 15         # districts receiving complaint edges
SIM_NEIGHBORS = 2                 # similarity edges per node

INPUT_FILES = {
    "scenarios": "ctgan_abm_scenarios.csv",
    "runs": "ctgan_abm_scenario_runs.csv",
    "daily": "ctgan_abm_daily_metrics.csv",
    "district": "ctgan_abm_district_metrics.csv",
    "complaint": "ctgan_abm_complaint_type_metrics.csv",
}


def clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return lo if x < lo else hi if x > hi else x


def zone_of(p: float) -> str:
    if p >= RED_THRESHOLD:
        return "red"
    if p >= WATCH_THRESHOLD:
        return "watch"
    return "normal"


def safe_max(values) -> float:
    m = 0.0
    for v in values:
        if v > m:
            m = v
    return m if m > 0 else 1.0


def r6(x: float) -> float:
    return round(float(x), 6)


# --------------------------------------------------------------------------- #
# Input loading
# --------------------------------------------------------------------------- #
def read_csv(path: Path):
    with path.open("r", encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


def fnum(row: dict, key: str) -> float:
    v = row.get(key, "")
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def load_inputs(input_dir: Path):
    data = {}
    for key, fname in INPUT_FILES.items():
        p = input_dir / fname
        if not p.exists():
            raise FileNotFoundError(f"Missing required input CSV: {p}")
        data[key] = read_csv(p)
    return data


# --------------------------------------------------------------------------- #
# Per-scenario graph construction
# --------------------------------------------------------------------------- #
def build_scenario(scenario_id, name, districts, complaints, daily):
    """Return (nodes, edges, per-day base-pressure lookups, meta) for one scenario."""
    # --- daily scenario time series, day index 1..DAYS ---
    daily_sorted = sorted(daily, key=lambda r: str(r.get("day", "")))
    backlog_day, sup_day, stale_day = {}, {}, {}
    for i, r in enumerate(daily_sorted[:DAYS], start=1):
        backlog_day[i] = fnum(r, "backlog")
        sup_day[i] = fnum(r, "supervisor_queue_size")
        stale_day[i] = fnum(r, "stale_cases")
    # Pad if fewer than DAYS rows (defensive; calibrated set has exactly 30).
    for i in range(1, DAYS + 1):
        backlog_day.setdefault(i, 0.0)
        sup_day.setdefault(i, 0.0)
        stale_day.setdefault(i, 0.0)

    max_backlog_day = safe_max(backlog_day.values())
    max_sup_day = safe_max(sup_day.values())
    max_stale_day = safe_max(stale_day.values())
    # Load fraction gives district/complaint end-of-run pressure a rising daily shape.
    load_frac = {t: backlog_day[t] / max_backlog_day for t in range(1, DAYS + 1)}

    # --- district base pressure (identical to frontend Operational Pressure Model) ---
    d_max_total = safe_max(fnum(d, "total_cases") for d in districts)
    d_max_backlog = safe_max(fnum(d, "backlog") for d in districts)
    d_max_stale = safe_max(fnum(d, "stale_cases") for d in districts)
    d_max_hours = safe_max(fnum(d, "estimated_hours") for d in districts)
    demand_total = sum(fnum(c, "total_cases") for c in complaints) or 1.0
    top_complaint_share = (
        max((fnum(c, "total_cases") for c in complaints), default=0.0) / demand_total
    )
    C_scenario = top_complaint_share
    overloaded = sum(1 for d in districts if fnum(d, "overload_flag") == 1)
    red_frac = overloaded / len(districts) if districts else 0.0

    district_info = {}
    for d in districts:
        name_d = d["district_or_area"]
        L = fnum(d, "total_cases") / d_max_total
        Q = fnum(d, "backlog") / d_max_backlog
        R = fnum(d, "stale_cases") / d_max_stale
        S = max(1.0 if fnum(d, "overload_flag") == 1 else 0.0,
                fnum(d, "estimated_hours") / d_max_hours)
        ch = {"C": C_scenario, "L": L, "R": R, "Q": Q, "S": S}
        p_end = clamp(sum(WEIGHTS[k] * ch[k] for k in WEIGHTS))
        dominant = max(ch, key=lambda k: WEIGHTS[k] * ch[k])
        district_info[name_d] = {
            "p_end": p_end, "channels": ch, "dominant": dominant,
            "backlog": fnum(d, "backlog"), "total_cases": fnum(d, "total_cases"),
            "stale_cases": fnum(d, "stale_cases"), "estimated_hours": fnum(d, "estimated_hours"),
        }

    # --- complaint base pressure (demand channels C/L/Q), keep top-N as nodes ---
    complaints_sorted = sorted(complaints, key=lambda c: -fnum(c, "total_cases"))
    top_complaints = complaints_sorted[:TOP_COMPLAINT_NODES]
    c_max_total = safe_max(fnum(c, "total_cases") for c in top_complaints)
    c_max_hours = safe_max(fnum(c, "estimated_hours") for c in top_complaints)
    complaint_info = {}
    for c in top_complaints:
        ctype = c["complaint_type"]
        L = fnum(c, "total_cases") / c_max_total
        Q = fnum(c, "estimated_hours") / c_max_hours
        C = fnum(c, "total_cases") / demand_total
        p_base = clamp(WEIGHTS["C"] * C + WEIGHTS["L"] * L + WEIGHTS["Q"] * Q)
        complaint_info[ctype] = {
            "p_base": p_base, "total_cases": fnum(c, "total_cases"),
            "estimated_hours": fnum(c, "estimated_hours"),
        }

    # --- node table + per-day base-pressure function ---
    nodes = {}  # node_id -> {type, label, base(t)->float}

    def add_node(node_id, node_type, label, base_fn):
        nodes[node_id] = {"type": node_type, "label": label, "base": base_fn}

    for name_d, info in district_info.items():
        nid = f"district::{name_d}"
        add_node(nid, "district", name_d,
                 (lambda p=info["p_end"]: (lambda t: clamp(p * load_frac[t])))())
    for ctype, info in complaint_info.items():
        nid = f"complaint::{ctype}"
        add_node(nid, "complaint_type", ctype,
                 (lambda p=info["p_base"]: (lambda t: clamp(p * load_frac[t])))())
    add_node("officer_capacity", "officer_capacity", "Officer field capacity",
             lambda t: clamp(0.25 * (backlog_day[t] / max_backlog_day) + 0.15 * red_frac))
    add_node("supervisor_review", "supervisor_review", "Supervisor review queue",
             lambda t: clamp(0.25 * (sup_day[t] / max_sup_day)))
    add_node("stale_backlog", "stale_backlog", "Stale backlog",
             lambda t: clamp(0.15 * (stale_day[t] / max_stale_day)))
    add_node("final_backlog", "final_backlog", "Final backlog",
             lambda t: clamp(0.25 * (backlog_day[t] / max_backlog_day)))

    # --- edges (explicit, deterministic) ---
    edges = []  # (src, tgt, edge_type, weight, description)

    sum_backlog = sum(info["backlog"] for info in district_info.values()) or 1.0
    sum_total = sum(info["total_cases"] for info in district_info.values()) or 1.0

    # complaint_type -> district : outer-product coupling (no joint data exists)
    top_c_sources = list(complaint_info.items())[:TOP_COMPLAINT_SOURCES]
    c_top_total = safe_max(info["total_cases"] for _, info in top_c_sources)
    top_districts = sorted(district_info.items(), key=lambda kv: -kv[1]["backlog"])[:TOP_DISTRICT_TARGETS]
    for ctype, cinfo in top_c_sources:
        for name_d, dinfo in top_districts:
            w = (cinfo["total_cases"] / c_top_total) * (dinfo["backlog"] / d_max_backlog) * 0.5
            if w <= 0:
                continue
            edges.append((f"complaint::{ctype}", f"district::{name_d}", "complaint_to_district",
                          r6(w), "Complaint demand feeds district workload (outer-product coupling; no joint data)"))

    # district -> officer_capacity / supervisor_review
    for name_d, dinfo in district_info.items():
        w_off = dinfo["backlog"] / sum_backlog
        edges.append((f"district::{name_d}", "officer_capacity", "district_to_officer_capacity",
                      r6(w_off), "District backlog draws on shared officer field capacity"))
        w_sup = (dinfo["total_cases"] / sum_total) * 0.7
        edges.append((f"district::{name_d}", "supervisor_review", "district_to_supervisor_review",
                      r6(w_sup), "District throughput requires supervisor sign-off"))

    # supervisor_review -> stale_backlog -> final_backlog (fixed operational chain)
    edges.append(("supervisor_review", "stale_backlog", "supervisor_to_stale",
                  0.6, "Unreviewed cases age into stale backlog"))
    edges.append(("stale_backlog", "final_backlog", "stale_to_final",
                  0.7, "Stale cases persist into the final backlog"))

    # district -> district : operational-similarity adjacency (NOT geographic)
    dnames = list(district_info.keys())
    dfeat = {n: [district_info[n]["total_cases"] / d_max_total,
                 district_info[n]["backlog"] / d_max_backlog,
                 district_info[n]["stale_cases"] / d_max_stale,
                 district_info[n]["estimated_hours"] / d_max_hours] for n in dnames}
    for a in dnames:
        sims = []
        for b in dnames:
            if a == b:
                continue
            diff = sum(abs(x - y) for x, y in zip(dfeat[a], dfeat[b])) / len(dfeat[a])
            sims.append((1.0 - diff, b))
        sims.sort(reverse=True)
        for sim, b in sims[:SIM_NEIGHBORS]:
            edges.append((f"district::{a}", f"district::{b}", "district_similarity",
                          r6(sim * 0.15), "Operational-similarity adjacency (workload profile), NOT geographic proof"))

    # complaint_type -> complaint_type : shared-workload similarity (top nodes only)
    cnames = list(complaint_info.keys())
    cfeat = {n: [complaint_info[n]["total_cases"] / c_max_total,
                 complaint_info[n]["estimated_hours"] / c_max_hours] for n in cnames}
    for a in cnames:
        sims = []
        for b in cnames:
            if a == b:
                continue
            diff = sum(abs(x - y) for x, y in zip(cfeat[a], cfeat[b])) / len(cfeat[a])
            sims.append((1.0 - diff, b))
        sims.sort(reverse=True)
        for sim, b in sims[:SIM_NEIGHBORS]:
            edges.append((f"complaint::{a}", f"complaint::{b}", "complaint_similarity",
                          r6(sim * 0.10), "Shared operational-workload similarity"))

    meta = {"district_info": district_info, "red_frac": red_frac}
    return nodes, edges, meta


# --------------------------------------------------------------------------- #
# Propagation over the constructed graph
# --------------------------------------------------------------------------- #
def propagate(scenario_id, nodes, edges):
    """Run the day-by-day propagation. Returns (timesteps, cascade, node_stats)."""
    incoming_edges = {}  # target -> list of (source, weight, edge_type)
    for src, tgt, etype, w, _desc in edges:
        incoming_edges.setdefault(tgt, []).append((src, w, etype))

    node_ids = list(nodes.keys())
    total_prev, zone_prev = {}, {}
    timesteps, cascade = [], []
    node_stats = {n: {"max": 0.0, "first_watch": None, "first_red": None} for n in node_ids}

    for t in range(1, DAYS + 1):
        base_t = {n: nodes[n]["base"](t) for n in node_ids}
        incoming_t = {n: 0.0 for n in node_ids}
        day_cascade = []

        if t >= 2:
            for tgt, srcs in incoming_edges.items():
                for src, w, etype in srcs:
                    zs = zone_prev.get(src, "normal")
                    factor = TRANSMIT[zs]
                    if factor <= 0.0:
                        continue
                    contrib = w * factor * total_prev.get(src, 0.0)
                    if contrib <= 0.0:
                        continue
                    incoming_t[tgt] += contrib
                    day_cascade.append([src, tgt, contrib, zs, etype])

        total_t, zone_t = {}, {}
        for n in node_ids:
            if t == 1:
                tot = clamp(base_t[n])
            else:
                tot = clamp(base_t[n] + DECAY * total_prev.get(n, 0.0) + incoming_t[n])
            total_t[n] = tot
            z = zone_of(tot)
            zone_t[n] = z
            st = node_stats[n]
            if tot > st["max"]:
                st["max"] = tot
            if z in ("watch", "red") and st["first_watch"] is None:
                st["first_watch"] = t
            if z == "red" and st["first_red"] is None:
                st["first_red"] = t
            timesteps.append([
                scenario_id, t, n, nodes[n]["type"],
                r6(base_t[n]), r6(incoming_t[n]), r6(tot), z, 1 if z in ("watch", "red") else 0,
            ])

        for src, tgt, contrib, zs, etype in day_cascade:
            cascade.append([
                scenario_id, t, src, tgt, r6(contrib), zs, zone_t.get(tgt, "normal"), etype,
            ])

        total_prev, zone_prev = total_t, zone_t

    return timesteps, cascade, node_stats


def mitigation_for(dominant: str, source_label: str, supervisor_pressure: float) -> str:
    if supervisor_pressure >= RED_THRESHOLD:
        return "Increase supervisor review capacity"
    return {
        "S": "Prioritize the overloaded / safety-pressured districts",
        "R": "Add a stale / repeat-case triage pass",
        "L": f"Surge officer minutes to {source_label}",
        "C": "Run a category-targeted response",
        "Q": "Add officer field capacity",
    }.get(dominant, "Add officer field capacity")


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser(description="Constructed municipal information-propagation layer (offline).")
    ap.add_argument("--input", default="outputs/ctgan_abm_500k_calibrated")
    ap.add_argument("--output", default="outputs/ctgan_abm_500k_pressure_propagation")
    args = ap.parse_args()

    input_dir = Path(args.input)
    output_dir = Path(args.output)

    if output_dir.resolve() == input_dir.resolve():
        raise SystemExit("Refusing to write into the input folder (would overwrite the 5 calibrated CSVs).")

    data = load_inputs(input_dir)

    # Group inputs by scenario_id.
    scen_rows = data["scenarios"]
    by_scen = {s["scenario_id"]: {"name": s.get("name", s["scenario_id"]),
                                  "districts": [], "complaints": [], "daily": []} for s in scen_rows}
    for d in data["district"]:
        by_scen.setdefault(d["scenario_id"], {"name": d["scenario_id"], "districts": [], "complaints": [], "daily": []})
        by_scen[d["scenario_id"]]["districts"].append(d)
    for c in data["complaint"]:
        by_scen.setdefault(c["scenario_id"], {"name": c["scenario_id"], "districts": [], "complaints": [], "daily": []})
        by_scen[c["scenario_id"]]["complaints"].append(c)
    for r in data["daily"]:
        by_scen.setdefault(r["scenario_id"], {"name": r["scenario_id"], "districts": [], "complaints": [], "daily": []})
        by_scen[r["scenario_id"]]["daily"].append(r)

    nodes_rows, edges_rows, ts_rows, cas_rows, sum_rows = [], [], [], [], []

    for scenario_id in sorted(by_scen.keys()):
        bundle = by_scen[scenario_id]
        nodes, edges, meta = build_scenario(
            scenario_id, bundle["name"], bundle["districts"], bundle["complaints"], bundle["daily"])
        timesteps, cascade, node_stats = propagate(scenario_id, nodes, edges)

        # nodes.csv
        for nid, ninfo in nodes.items():
            st = node_stats[nid]
            nodes_rows.append([
                scenario_id, nid, ninfo["type"], ninfo["label"],
                r6(ninfo["base"](DAYS)), r6(st["max"]),
                st["first_watch"] if st["first_watch"] is not None else "",
                st["first_red"] if st["first_red"] is not None else "",
            ])
        # edges.csv
        for src, tgt, etype, w, desc in edges:
            edges_rows.append([scenario_id, src, tgt, etype, w, desc])
        ts_rows.extend(timesteps)
        cas_rows.extend(cascade)

        # summary.csv
        district_stats = {n: node_stats[n]["max"] for n in node_stats if n.startswith("district::")}
        source_nid = max(district_stats, key=district_stats.get) if district_stats else ""
        source_label = source_nid.split("::", 1)[1] if source_nid else ""
        peak = district_stats.get(source_nid, 0.0)
        red_ct = sum(1 for n in node_stats if node_stats[n]["max"] >= RED_THRESHOLD)
        watch_ct = sum(1 for n in node_stats if WATCH_THRESHOLD <= node_stats[n]["max"] < RED_THRESHOLD)
        first_red_days = [node_stats[n]["first_red"] for n in node_stats if node_stats[n]["first_red"] is not None]
        first_red = min(first_red_days) if first_red_days else ""
        final_p = node_stats.get("final_backlog", {}).get("max", 0.0)
        sup_p = node_stats.get("supervisor_review", {}).get("max", 0.0)
        stale_p = node_stats.get("stale_backlog", {}).get("max", 0.0)
        dominant = meta["district_info"].get(source_label, {}).get("dominant", "Q")
        mitigation = mitigation_for(dominant, source_label, sup_p)
        sum_rows.append([
            scenario_id, source_nid, source_label, r6(peak), red_ct, watch_ct,
            first_red, r6(final_p), r6(sup_p), r6(stale_p), mitigation,
        ])

    # --- write outputs ---
    output_dir.mkdir(parents=True, exist_ok=True)

    def write_csv(fname, header, rows):
        with (output_dir / fname).open("w", encoding="utf-8", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(header)
            w.writerows(rows)

    write_csv("ctgan_abm_pressure_nodes.csv",
              ["scenario_id", "node_id", "node_type", "label", "base_pressure", "max_pressure",
               "first_watch_day", "first_red_day"], nodes_rows)
    write_csv("ctgan_abm_pressure_edges.csv",
              ["scenario_id", "source_node_id", "target_node_id", "edge_type", "weight", "description"], edges_rows)
    write_csv("ctgan_abm_pressure_timesteps.csv",
              ["scenario_id", "day", "node_id", "node_type", "base_pressure", "incoming_pressure",
               "total_pressure", "zone", "activated"], ts_rows)
    write_csv("ctgan_abm_pressure_cascade.csv",
              ["scenario_id", "day", "source_node_id", "target_node_id", "transmitted_pressure",
               "source_zone", "target_zone", "edge_type"], cas_rows)
    write_csv("ctgan_abm_pressure_summary.csv",
              ["scenario_id", "source_node_id", "source_label", "peak_pressure", "red_node_count",
               "watch_node_count", "first_red_day", "final_backlog_pressure", "supervisor_pressure",
               "stale_pressure", "recommended_mitigation"], sum_rows)

    write_readme(output_dir)

    # --- validation ---
    validate(by_scen, nodes_rows, edges_rows, ts_rows, cas_rows, sum_rows, output_dir)


def write_readme(output_dir: Path):
    text = f"""# CTGAN ABM Pressure Propagation Layer (constructed)

This folder is a **constructed / calibrated information-propagation layer** built on top of
the calibrated CTGAN ABM outputs in `outputs/ctgan_abm_500k_calibrated/`.

## What this is — and is not
- It is a **constructed / calibrated** information-propagation layer.
- It is **not learned from Brampton operational data**.
- It is **not a causal proof**.
- It is **not enforcement decisioning**.
- It is built on **public municipal 311 benchmark data and calibrated CTGAN ABM outputs**.

Edges are explicit, documented operational dependencies. Where true geographic adjacency
is unavailable, district-to-district edges use a documented **operational-similarity**
adjacency (workload-profile similarity), which is **not** geographic proof. Every downstream
operational decision remains human reviewed.

## Method
Nodes: district, complaint type, officer capacity, supervisor review, stale backlog, final
backlog. Base pressure uses the same five-channel Operational Pressure Model as the app
(`P = 0.20*C + 0.25*L + 0.15*R + 0.25*Q + 0.15*S`; watch >= {WATCH_THRESHOLD}, red >= {RED_THRESHOLD}).
Pressure propagates day-by-day: `total_j,t = clamp(base_j,t + {DECAY}*total_j,t-1 + sum_i w_ij*transmit(zone_i)*total_i,t-1)`
with watch transmission {TRANSMIT['watch']} and red transmission {TRANSMIT['red']}.

## Files
- `ctgan_abm_pressure_nodes.csv` — node table (base/max pressure, first watch/red day)
- `ctgan_abm_pressure_edges.csv` — explicit edge list with weights and descriptions
- `ctgan_abm_pressure_timesteps.csv` — per-day node pressure and zone
- `ctgan_abm_pressure_cascade.csv` — per-day edge transmissions (the cascade)
- `ctgan_abm_pressure_summary.csv` — per-scenario source, peaks, counts, mitigation

Inputs are read-only; the five calibrated CSVs are never modified.
"""
    (output_dir / "README.md").write_text(text, encoding="utf-8")


def validate(by_scen, nodes_rows, edges_rows, ts_rows, cas_rows, sum_rows, output_dir):
    checks = []

    def check(name, ok, detail=""):
        checks.append((name, bool(ok), detail))

    scen_ids = sorted(by_scen.keys())
    node_scen = {r[0] for r in nodes_rows}
    ts_scen = {r[0] for r in ts_rows}
    check("all 6 scenarios present", len(scen_ids) == 6 and node_scen == set(scen_ids),
          f"{len(scen_ids)} scenarios")

    # 30 days per scenario
    days_ok = True
    for s in scen_ids:
        days = {r[1] for r in ts_rows if r[0] == s}
        if days != set(range(1, DAYS + 1)):
            days_ok = False
    check("30 days per scenario", days_ok)

    # required node types present per scenario
    required_types = {"district", "complaint_type", "officer_capacity", "supervisor_review",
                      "stale_backlog", "final_backlog"}
    types_ok = True
    for s in scen_ids:
        present = {r[2] for r in nodes_rows if r[0] == s}
        if not required_types.issubset(present):
            types_ok = False
    check("all required node types exist per scenario", types_ok)

    check("edges exist", len(edges_rows) > 0, f"{len(edges_rows)} edges")
    check("timesteps exist", len(ts_rows) > 0, f"{len(ts_rows)} rows")
    check("cascade rows exist", len(cas_rows) > 0, f"{len(cas_rows)} rows")

    # no null scenario_id anywhere
    null_scen = any(not r[0] for r in nodes_rows + edges_rows + ts_rows + cas_rows + sum_rows)
    check("no null scenario_id", not null_scen)

    # pressure values in [0,1] (nodes base/max, timesteps base/incoming/total, cascade transmitted)
    press_ok = True
    for r in nodes_rows:
        if not (0.0 <= float(r[4]) <= 1.0 and 0.0 <= float(r[5]) <= 1.0):
            press_ok = False
    for r in ts_rows:
        if not (0.0 <= float(r[4]) <= 1.0 and 0.0 <= float(r[6]) <= 1.0):
            press_ok = False
    for r in cas_rows:
        if not (0.0 <= float(r[4]) <= 1.0):
            press_ok = False
    check("pressure values in [0,1]", press_ok)

    # zones only normal/watch/red
    zones = {r[7] for r in ts_rows} | {r[5] for r in cas_rows} | {r[6] for r in cas_rows}
    check("zones only normal/watch/red", zones.issubset({"normal", "watch", "red"}), str(sorted(zones)))

    print("\n=== VALIDATION ===")
    all_ok = True
    for name, ok, detail in checks:
        all_ok = all_ok and ok
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  ({detail})" if detail else ""))

    print("\n=== ROW COUNTS ===")
    print(f"  nodes:     {len(nodes_rows)}")
    print(f"  edges:     {len(edges_rows)}")
    print(f"  timesteps: {len(ts_rows)}")
    print(f"  cascade:   {len(cas_rows)}")
    print(f"  summary:   {len(sum_rows)}")

    # Example: top pressure cascade for baseline_calibrated
    print("\n=== TOP CASCADE (baseline_calibrated) ===")
    base_cas = [r for r in cas_rows if r[0] == "baseline_calibrated"]
    base_cas.sort(key=lambda r: -float(r[4]))
    for r in base_cas[:8]:
        print(f"  day {r[1]:>2}  {r[2]}  ->  {r[3]}   transmitted={r[4]}  ({r[5]}->{r[6]}, {r[7]})")

    print(f"\nOutput folder: {output_dir}")
    print("OVERALL: " + ("PASS" if all_ok else "FAIL"))


if __name__ == "__main__":
    main()
