# V2 UI Integration Plan — "Needs Attention" score

_Planning only. No retraining, no Supabase changes, no frontend changes, no live
inference. Based on the V2 results in `reports/modeling/v2/` (`metrics.json`,
`scored_sample.csv`). The score is a **staff decision-support** signal — never an
automated decision._

## Summary
Surface the **stale-risk / handling-path proxy** (Model 2) as a soft **"Needs
Attention"** ranking on the staff work queue. Do **not** surface the routing model
(Model 1) yet. Use `scored_sample.csv` only for mock/preview rendering during
design — not as production data.

## 1. Why routing should not be wired yet
- On the Toronto 311 benchmark the routing classifier is a **near-perfect lookup
  of `complaint_type` → department** (macro-F1 0.997 with the type), collapsing to
  **macro-F1 ≈ 0.30** once `complaint_type` is removed and the type phrase is
  stripped from the templated `description` — barely above the 48% majority class.
- So it adds essentially **no information beyond the `complaint_type` the record
  already carries**, and would give staff false confidence ("the model agrees with
  the obvious"). Its real value only appears on **free-text Brampton intake** where
  `complaint_type` isn't pre-assigned. Wire it then, ideally as an assist that only
  fires when `complaint_type`/department is missing.

## 2. Why queue attention is the better candidate
- The stale-risk proxy shows **genuine lift**: top-decile by score is ~**74%
  actually-open vs a 28% base rate** (~2.6×), ROC-AUC ~0.80, and its drivers are
  **complaint-type characteristics, not recency**.
- It maps directly onto an existing workflow need: the app already surfaces aging
  open cases with **rules** (`getAgingOpenComplaints`). A model-assisted attention
  rank **complements** that rules layer rather than replacing it.
- It's low-risk as a *soft hint that re-orders a queue* — staff still read and
  decide every case; a wrong rank just changes ordering, not an outcome.

## 3. How to label it safely
- Call it **"Needs Attention"** (model-assisted) — **not** "stale prediction",
  "will go overdue", or any SLA/deadline language.
- Present it as a **relative rank / tier**, not a raw probability. The model is
  **under-calibrated** (train open-rate 9% → April 28%, Brier ~0.17), so absolute
  scores are misleading; percentile tiers are honest and stable.
- Show it **only on open/unresolved cases** (the proxy is open-vs-resolved; it is
  meaningless on Completed/Closed/Cancelled).
- Always attach the standard advisory: _"Model-assisted attention rank on current
  handling state. Decision support only — staff review and decide. Toronto 311
  benchmark, not Brampton operational data."_
- Badge styling should read as a **hint**, not an alarm (e.g. a muted "Higher
  attention" chip), and never override the existing `priority`/status badges.

## 4. Suggested UI fields
View-model (mock from `scored_sample.csv` now; from a batch job later):
- `attentionTier`: `'Higher' | 'Medium' | 'Lower'` — derived from score percentile
  across the current open queue (e.g. top third / mid / bottom).
- `attentionRank`: integer position within the open queue (for sort).
- `needsAttentionScore`: raw 0–1 (kept internal / shown only as a faint tooltip,
  not a headline number).
- `attentionReason` (optional, phase 2): 1–2 top contributing factors
  (e.g. complaint type), from the saved coefficients.
- `modelVersion` + `advisory`: provenance + disclaimer text.

Placement, in priority order:
1. **Case Queue (primary)** — a small "Needs Attention" chip on each open-case
   row/card (`CaseQueueView` / `CaseQueuePanel`), plus an optional "Sort by
   attention" toggle. This is where triage ordering happens.
2. **Workflow page** — a compact "Top cases needing attention" strip on
   `/app/workflow`, alongside the existing stage counts and aging list.
3. **Case detail** — a small decision-support panel on `AppCaseDetailPage`
   showing the tier, the advisory, and (phase 2) the top factors. Mirror the
   existing `CaseAiReview` panel's tone.

## 5. Whether Supabase needs a `workflow_ml_predictions` table later
**Yes, later — not now.** For production the scores should be precomputed by an
offline batch job and stored, mirroring `workload_insights_v1`:
- `workflow_ml_predictions(case_id, model, model_version, feature_window,
  scoring_period, needs_attention_score, attention_tier, top_factors jsonb,
  advisory, generated_at, created_at)`, unique on `(model_version, case_id)`.
- RLS: authenticated **read-only**; writes via service-role batch job only.
- The frontend reads it Supabase-first with the static `scored_sample.csv` as a
  labelled fallback (same pattern as Workload Insights).
For this planning step we use `scored_sample.csv` for mock rendering only — no
table, no migration, no inference wiring.

## 6. How V3 agentic workflow would use this score later
V3 (human-in-the-loop assistant, **not** autonomous enforcement) would treat
"Needs Attention" as a **prioritization input**, not an action trigger:
- Order the assistant's review worklist by attention tier so it drafts support for
  the highest-attention open cases first.
- For those cases, generate **suggested next actions** (assignment, request-more-
  info, closure draft) that a staff member **approves or rejects** — every action
  recorded as a `workflow_events` row for auditability.
- The score never auto-closes, auto-assigns, or auto-enforces; it only changes
  *what the assistant looks at first* and *what it proposes for human review*.
- Keep the same safe labeling and advisory; the score remains decision support,
  and a human remains the decision-maker.
