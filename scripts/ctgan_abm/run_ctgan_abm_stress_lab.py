#!/usr/bin/env python3
"""CTGAN + ABM stress lab runner (local-only, PyTorch-based).

Full pipeline:
1. Load prepared complaint training sample
2. Train a tabular GAN on the engineered *numeric* demand-intensity features
3. Generate synthetic complaint arrivals:
     - numeric demand scores come from the trained GAN
     - real categorical values (district, borough, complaint_type, closure_bucket)
       are bootstrapped from the empirical joint distribution of the training data
       so synthetic arrivals always carry credible, real-world categories.
4. Run agent-based simulation (30 days default)
5. Write CSV outputs and a SQL loader (no direct Supabase write)

Writes to: outputs/ctgan_abm/
Requires: PyTorch, numpy

Why a hybrid generator?  A small GAN cannot faithfully reproduce 148 complaint
types across ~50 council districts -- it mode-collapses and emits blanks.  The
demand *pressure* (how heavy each arrival is) is what we actually want the GAN to
model, so the GAN owns the numeric scores while the categoricals are sampled from
real rows.  This guarantees rule 3 of the brief: generated arrivals preserve real
categorical values.
"""
import argparse
import csv
import json
import sys
from dataclasses import dataclass
from datetime import datetime, date, timedelta
from pathlib import Path
import random

import numpy as np

try:
    import torch
    import torch.nn as nn
    import torch.optim as optim
except Exception:
    print('Missing dependency: torch is required', file=sys.stderr)
    raise

# ============================================================================
# CONFIGURATION
# ============================================================================

DEFAULT_INPUT = Path('data/ctgan_abm/municipal_complaints_training_sample.csv')
DEFAULT_OUTPUT_DIR = Path('outputs/ctgan_abm')

# ABM parameters
DEFAULT_OFFICER_UNITS_PER_DISTRICT = 4
DEFAULT_OFFICER_DAILY_MINUTES = 390  # ~6.5 hrs/officer -- the depleted resource
DEFAULT_SUPERVISOR_DAILY_REVIEW_CAPACITY = 75
DEFAULT_STALE_THRESHOLD_DAYS = 14
DEFAULT_OVERLOAD_MULTIPLIER = 2.5

# CTGAN parameters
DEFAULT_EPOCHS = 25
DEFAULT_BATCH_SIZE = 512
DEFAULT_SYNTHETIC_ROWS = 15000
DEFAULT_DAYS = 30
DEFAULT_SCENARIOS = 25
DEFAULT_TOP_DISTRICTS = 20

# Validation thresholds
MAX_UNKNOWN_DISTRICT_PCT = 5.0

# Supervisor-review triggers (rule 5)
SUPERVISOR_PATROL_INTENSITY_THRESHOLD = 0.65
SUPERVISOR_CLOSURE_PRESSURE_THRESHOLD = 0.70

# Closure buckets that represent a long (30+ day) resolution -> escalate to supervisor.
# Covers the project's source buckets plus the "30-90 / 90+" wording from the brief.
LONG_CLOSURE_BUCKETS = {
    '30_plus_days', '30-90 days', '90+ days', '30_90_days', '90_plus_days', '90_plus',
}

# Deterministic closure-pressure score derived from the closure bucket.
CLOSURE_PRESSURE_BY_BUCKET = {
    'same_day': 0.10,
    '1_7_days': 0.35,
    '8_30_days': 0.60,
    '30_plus_days': 0.85,
    '30-90 days': 0.85,
    '90+ days': 0.95,
    'unknown': 0.50,
}

# Processing time ranges (minutes) by intensity
PROCESSING_MINUTES = {
    'low': (30, 45),
    'medium': (60, 90),
    'high': (120, 180),
    'very_high': (180, 240),
}

# Numeric features the GAN learns (the demand-intensity signal)
NUMERIC_COLS = [
    'submitted_day_of_week',
    'submitted_hour',
    'submitted_month',
    'repeat_pressure_score',
    'patrol_intensity_score',
    'supervisor_review_likelihood',
]

# ============================================================================
# CATEGORICAL MAPPING (rule 3)
# ============================================================================

def _clean(v) -> str:
    return (v or '').strip()


def map_district(row: dict) -> str:
    """district comes from council_district; fall back to borough; Unknown last."""
    cd = _clean(row.get('council_district'))
    if cd:
        return cd
    borough = _clean(row.get('borough'))
    if borough and borough.lower() != 'unspecified':
        return borough
    return 'Unknown'


def district_label(district: str) -> str:
    """Readable label, still derived from council_district."""
    d = district.strip()
    core = d.lstrip('0') or '0'
    if core.isdigit():
        return f'Council District {int(core)}'
    return d


def map_complaint_type(row: dict) -> str:
    """complaint_type, falling back to request_detail, then 'Other'."""
    ct = _clean(row.get('complaint_type'))
    if ct:
        return ct
    rd = _clean(row.get('request_detail'))
    if rd:
        return rd
    return 'Other'


def map_closure_bucket(row: dict) -> str:
    """closure_bucket must never be blank."""
    cb = _clean(row.get('closure_bucket'))
    return cb if cb else 'unknown'


def map_borough(row: dict) -> str:
    """borough stays as the source value; Unknown only when truly missing."""
    b = _clean(row.get('borough'))
    return b if b else 'Unknown'


def closure_pressure_from_bucket(bucket: str) -> float:
    return CLOSURE_PRESSURE_BY_BUCKET.get(bucket, 0.50)


def needs_supervisor_review(closure_bucket: str, patrol_intensity: float, closure_pressure: float) -> bool:
    """rule 5: any trigger => supervisor review required."""
    if closure_bucket in LONG_CLOSURE_BUCKETS:
        return True
    if patrol_intensity >= SUPERVISOR_PATROL_INTENSITY_THRESHOLD:
        return True
    if closure_pressure >= SUPERVISOR_CLOSURE_PRESSURE_THRESHOLD:
        return True
    return False


# ============================================================================
# AGENT DATACLASSES
# ============================================================================

@dataclass
class ComplaintAgent:
    """One synthetic service request."""
    case_id: str
    scenario_id: str
    arrival_day: int
    borough: str
    district: str
    complaint_type: str
    priority_score: float
    closure_pressure_score: float
    patrol_intensity_score: float
    supervisor_review_required: bool
    age_days: int = 0
    status: str = 'open'


@dataclass
class OfficerUnitAgent:
    """One enforcement unit. Daily minutes are the depleted resource."""
    unit_id: str
    district: str
    daily_minutes: int
    specialization: str
    current_minutes_used: int = 0
    cases_completed: int = 0

    def can_process(self, minutes_needed: int) -> bool:
        return self.current_minutes_used + minutes_needed <= self.daily_minutes

    def process_case(self, minutes_used: int):
        self.current_minutes_used += minutes_used
        self.cases_completed += 1

    def reset_daily(self):
        self.current_minutes_used = 0
        self.cases_completed = 0


@dataclass
class DistrictAgent:
    """One district with its own officer units, queue and backlog tracking."""
    district: str
    borough: str
    officer_units: list
    queue: list = None
    total_cases: int = 0          # cumulative arrivals routed to this district
    backlog: int = 0
    stale_cases: int = 0
    overload_flag: bool = False
    daily_closure_rate: float = 0.0

    def __post_init__(self):
        if self.queue is None:
            self.queue = []

    def enqueue(self, complaint: ComplaintAgent):
        self.queue.append(complaint)
        self.backlog += 1
        self.total_cases += 1

    def process_cases(self) -> tuple:
        """Process queue with available officer minutes.

        Returns: (processed_count, supervisor_review_cases)
        """
        processed = 0
        supervisor_cases = []

        # Highest priority first, then oldest first (FIFO within priority).
        self.queue.sort(key=lambda c: (-c.priority_score, -c.age_days))

        remaining = []
        for complaint in self.queue:
            intensity = self._intensity_from_score(complaint.patrol_intensity_score)
            min_time, max_time = PROCESSING_MINUTES.get(intensity, (60, 90))
            process_time = random.randint(min_time, max_time)

            available_unit = None
            for unit in self.officer_units:
                if unit.can_process(process_time):
                    available_unit = unit
                    break

            if available_unit is not None:
                available_unit.process_case(process_time)
                complaint.status = 'processed'
                if complaint.supervisor_review_required:
                    supervisor_cases.append(complaint)
                else:
                    complaint.status = 'closed'
                processed += 1
            else:
                remaining.append(complaint)

        self.queue = remaining
        self.backlog = len(remaining)
        self.stale_cases = sum(1 for c in remaining if c.age_days >= DEFAULT_STALE_THRESHOLD_DAYS)

        daily_capacity_cases = sum(u.daily_minutes for u in self.officer_units) // 60
        self.overload_flag = self.backlog > daily_capacity_cases * DEFAULT_OVERLOAD_MULTIPLIER

        return processed, supervisor_cases

    @staticmethod
    def _intensity_from_score(score: float) -> str:
        if score < 0.25:
            return 'low'
        elif score < 0.5:
            return 'medium'
        elif score < 0.75:
            return 'high'
        return 'very_high'

    def age_queue(self):
        for complaint in self.queue:
            complaint.age_days += 1


@dataclass
class SupervisorQueueAgent:
    """Supervisor review bottleneck: processes up to capacity reviews per day."""
    daily_review_capacity: int
    pending_reviews: list = None
    completed_reviews: int = 0
    stale_review_count: int = 0

    def __post_init__(self):
        if self.pending_reviews is None:
            self.pending_reviews = []

    def enqueue(self, complaint: ComplaintAgent):
        self.pending_reviews.append(complaint)

    def process_reviews(self) -> int:
        """Process reviews up to daily capacity, stale first."""
        self.pending_reviews.sort(key=lambda c: -c.age_days)
        processed = 0
        remaining = []
        for complaint in self.pending_reviews:
            if processed < self.daily_review_capacity:
                complaint.status = 'closed'
                processed += 1
            else:
                remaining.append(complaint)
        self.completed_reviews += processed
        self.stale_review_count = sum(1 for c in remaining if c.age_days >= DEFAULT_STALE_THRESHOLD_DAYS)
        self.pending_reviews = remaining
        return processed

    def age_queue(self):
        for complaint in self.pending_reviews:
            complaint.age_days += 1


# ============================================================================
# CTGAN MODEL (numeric demand-intensity GAN)
# ============================================================================

class CTGANGenerator(nn.Module):
    def __init__(self, latent_dim: int, condition_dim: int, output_dim: int):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(latent_dim + condition_dim, 256),
            nn.ReLU(),
            nn.Linear(256, 256),
            nn.ReLU(),
            nn.Linear(256, output_dim),
            nn.Sigmoid(),  # numeric features are min-max normalised to [0, 1]
        )

    def forward(self, z, condition):
        return self.net(torch.cat([z, condition], dim=1))


class CTGANDiscriminator(nn.Module):
    def __init__(self, input_dim: int):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, 256),
            nn.LeakyReLU(0.2),
            nn.Dropout(0.3),
            nn.Linear(256, 256),
            nn.LeakyReLU(0.2),
            nn.Dropout(0.3),
            nn.Linear(256, 1),
            nn.Sigmoid(),
        )

    def forward(self, x):
        return self.net(x)


# ============================================================================
# DATA LOADING & PREPROCESSING
# ============================================================================

def _to_float(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def load_training_data(input_path: Path):
    """Load the training CSV. Returns (rows, scalers) where scalers is per
    numeric column (min, max) for normalisation."""
    rows = []
    with open(input_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for r in reader:
            rows.append(r)
    if not rows:
        raise ValueError(f'No rows in {input_path}')

    scalers = {}
    for col in NUMERIC_COLS:
        values = [_to_float(r.get(col)) for r in rows if _clean(r.get(col)) != '']
        if values:
            scalers[col] = (min(values), max(values))
        else:
            scalers[col] = (0.0, 1.0)
    return rows, scalers


def encode_numeric(row: dict, scalers: dict) -> np.ndarray:
    feats = []
    for col in NUMERIC_COLS:
        val = _to_float(row.get(col))
        min_v, max_v = scalers[col]
        feats.append((val - min_v) / (max_v - min_v + 1e-6))
    return np.array(feats, dtype=np.float32)


def decode_numeric(vec: np.ndarray, scalers: dict) -> dict:
    out = {}
    for i, col in enumerate(NUMERIC_COLS):
        min_v, max_v = scalers[col]
        out[col] = float(np.clip(vec[i] * (max_v - min_v) + min_v, min_v, max_v))
    return out


# ============================================================================
# CTGAN TRAINING
# ============================================================================

def train_ctgan(train_data, latent_dim=32, condition_dim=16, epochs=25,
                batch_size=512, device=None) -> CTGANGenerator:
    if device is None:
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

    n_samples, feature_dim = train_data.shape
    generator = CTGANGenerator(latent_dim, condition_dim, feature_dim).to(device)
    discriminator = CTGANDiscriminator(feature_dim).to(device)

    opt_g = optim.Adam(generator.parameters(), lr=0.0002, betas=(0.5, 0.999))
    opt_d = optim.Adam(discriminator.parameters(), lr=0.0002, betas=(0.5, 0.999))
    loss_fn = nn.BCELoss()
    train_tensor = torch.FloatTensor(train_data).to(device)

    print(f'Training CTGAN for {epochs} epochs on {n_samples} samples ({feature_dim} numeric features)...')
    for epoch in range(epochs):
        indices = np.random.permutation(n_samples)
        epoch_loss_d = epoch_loss_g = 0.0
        n_batches = 0
        for i in range(0, n_samples, batch_size):
            batch_idx = indices[i:i + batch_size]
            real_batch = train_tensor[batch_idx]
            bsz = real_batch.size(0)

            condition = torch.randn(bsz, condition_dim, device=device)
            z = torch.randn(bsz, latent_dim, device=device)

            opt_d.zero_grad()
            real_pred = discriminator(real_batch)
            fake_data = generator(z, condition).detach()
            fake_pred = discriminator(fake_data)
            loss_d = loss_fn(real_pred, torch.ones_like(real_pred)) + \
                     loss_fn(fake_pred, torch.zeros_like(fake_pred))
            loss_d.backward()
            opt_d.step()

            opt_g.zero_grad()
            z = torch.randn(bsz, latent_dim, device=device)
            fake_data = generator(z, condition)
            fake_pred = discriminator(fake_data)
            loss_g = loss_fn(fake_pred, torch.ones_like(fake_pred))
            loss_g.backward()
            opt_g.step()

            epoch_loss_d += loss_d.item()
            epoch_loss_g += loss_g.item()
            n_batches += 1

        if (epoch + 1) % 5 == 0:
            print(f'  Epoch {epoch + 1}/{epochs}: D_loss={epoch_loss_d / n_batches:.4f}, '
                  f'G_loss={epoch_loss_g / n_batches:.4f}')
    print('CTGAN training complete.')
    return generator


def generate_numeric_samples(generator, n_samples, latent_dim=32, condition_dim=16, device=None):
    if device is None:
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    generator.eval()
    with torch.no_grad():
        z = torch.randn(n_samples, latent_dim, device=device)
        condition = torch.randn(n_samples, condition_dim, device=device)
        fake = generator(z, condition)
    return fake.cpu().numpy()


# ============================================================================
# SYNTHETIC ARRIVAL ASSEMBLY (numeric GAN + empirical categoricals)
# ============================================================================

def build_synthetic_arrivals(training_rows, numeric_samples, scalers) -> list:
    """Pair each GAN numeric sample with a bootstrapped real categorical tuple."""
    n_train = len(training_rows)
    n_synth = len(numeric_samples)
    boot_idx = np.random.randint(0, n_train, size=n_synth)

    arrivals = []
    for i in range(n_synth):
        base = training_rows[int(boot_idx[i])]
        nums = decode_numeric(numeric_samples[i], scalers)

        district = map_district(base)
        borough = map_borough(base)
        complaint_type = map_complaint_type(base)
        closure_bucket = map_closure_bucket(base)

        patrol = round(float(nums['patrol_intensity_score']), 4)
        repeat = round(float(nums['repeat_pressure_score']), 4)
        closure_pressure = round(closure_pressure_from_bucket(closure_bucket), 4)
        supervisor_required = needs_supervisor_review(closure_bucket, patrol, closure_pressure)

        arrivals.append({
            'borough': borough,
            'council_district': _clean(base.get('council_district')),
            'district': district,
            'district_label': district_label(district),
            'complaint_type': complaint_type,
            'closure_bucket': closure_bucket,
            'patrol_intensity_score': patrol,
            'repeat_pressure_score': repeat,
            'closure_pressure_score': closure_pressure,
            'supervisor_review_required': bool(supervisor_required),
        })
    return arrivals


# ============================================================================
# ABM SIMULATION
# ============================================================================

def run_simulation(arrivals, days=30, top_districts=20, scenarios=1):
    """Run the ABM for N days across M scenarios.

    Returns: scenario_runs, scenarios_list, daily_metrics, district_metrics,
             complaint_type_metrics, sim_stats
    """
    scenario_runs, scenarios_list = [], []
    daily_metrics, district_metrics, complaint_type_metrics = [], [], []
    supervisor_queue_sizes = []

    # Pick the top districts by real arrival volume.
    district_counts = {}
    for a in arrivals:
        district_counts[a['district']] = district_counts.get(a['district'], 0) + 1
    top_dists = sorted(district_counts.items(), key=lambda x: -x[1])[:top_districts]
    top_districts_list = [d[0] for d in top_dists]
    top_set = set(top_districts_list)

    # Most common borough + readable label per district (computed once).
    district_borough = {}
    district_display = {}
    for a in arrivals:
        d = a['district']
        if d in top_set:
            district_borough.setdefault(d, {})
            district_borough[d][a['borough']] = district_borough[d].get(a['borough'], 0) + 1
            district_display[d] = a['district_label']
    district_borough = {d: max(b.items(), key=lambda x: x[1])[0] for d, b in district_borough.items()}

    # Arrivals routed into the simulated districts.
    sim_arrivals = [a for a in arrivals if a['district'] in top_set]

    print(f'Running {scenarios} scenario(s) over {days} days...')
    print(f'Top districts ({len(top_districts_list)}): '
          f'{[district_display.get(d, d) for d in top_districts_list[:5]]} ...')

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

    for scenario_num in range(scenarios):
        scenario_id = f'scenario_{scenario_num:03d}'
        run_id = f'run_{scenario_num:03d}_{timestamp}'

        scenarios_list.append({
            'scenario_id': scenario_id,
            'name': f'ABM Scenario {scenario_num}',
            'description': f'{days}-day simulation, {len(top_districts_list)} districts',
            'created_at': datetime.now().isoformat(),
        })

        # Build agents keyed by district.
        districts_agents = {}
        for d in top_districts_list:
            officer_units = [
                OfficerUnitAgent(
                    unit_id=f'{d}_unit_{i}',
                    district=d,
                    daily_minutes=DEFAULT_OFFICER_DAILY_MINUTES,
                    specialization='general',
                )
                for i in range(DEFAULT_OFFICER_UNITS_PER_DISTRICT)
            ]
            districts_agents[d] = DistrictAgent(
                district=d,
                borough=district_borough.get(d, 'Unknown'),
                officer_units=officer_units,
            )
        supervisor_queue = SupervisorQueueAgent(
            daily_review_capacity=DEFAULT_SUPERVISOR_DAILY_REVIEW_CAPACITY,
        )

        # Schedule arrivals across days, grouped by district.
        complaints_by_day = {d: [] for d in range(days)}
        ct_counts = {}
        for idx, a in enumerate(sim_arrivals):
            day = random.randint(0, days - 1)
            complaint = ComplaintAgent(
                case_id=f'{run_id}_{idx}',
                scenario_id=scenario_id,
                arrival_day=day,
                borough=a['borough'],
                district=a['district'],
                complaint_type=a['complaint_type'],
                priority_score=a['repeat_pressure_score'],
                closure_pressure_score=a['closure_pressure_score'],
                patrol_intensity_score=a['patrol_intensity_score'],
                supervisor_review_required=a['supervisor_review_required'],
            )
            complaints_by_day[day].append(complaint)
            ct_counts[a['complaint_type']] = ct_counts.get(a['complaint_type'], 0) + 1

        total_processed = 0
        total_closed = 0
        cumulative_arrivals = 0

        for sim_day in range(days):
            # New arrivals routed to their real district queue.
            for complaint in complaints_by_day.get(sim_day, []):
                districts_agents[complaint.district].enqueue(complaint)
                cumulative_arrivals += 1

            # Each district works its queue with available officer minutes.
            for district_agent in districts_agents.values():
                processed, supervisor_cases = district_agent.process_cases()
                total_processed += processed
                for complaint in supervisor_cases:
                    supervisor_queue.enqueue(complaint)

            # Supervisor queue size = cases awaiting review this day (the review
            # load), captured before the supervisor works through up to capacity.
            supervisor_peak = len(supervisor_queue.pending_reviews)
            supervisor_queue_sizes.append(supervisor_peak)
            total_closed += supervisor_queue.process_reviews()

            # Age everything still waiting.
            for district_agent in districts_agents.values():
                district_agent.age_queue()
            supervisor_queue.age_queue()

            # Reset officer minutes for the next day.
            for district_agent in districts_agents.values():
                for unit in district_agent.officer_units:
                    unit.reset_daily()

            total_backlog = sum(d.backlog for d in districts_agents.values())
            total_stale = sum(d.stale_cases for d in districts_agents.values())

            daily_metrics.append({
                'id': f'{run_id}_day_{sim_day}',
                'run_id': run_id,
                'scenario_id': scenario_id,
                'day': (date.today() + timedelta(days=sim_day)).isoformat(),
                'total_cases': cumulative_arrivals,
                'processed': total_processed,
                'backlog': total_backlog,
                'stale_cases': total_stale,
                'supervisor_queue_size': len(supervisor_queue.pending_reviews),
                'created_at': datetime.now().isoformat(),
            })

        scenario_runs.append({
            'run_id': run_id,
            'scenario_id': scenario_id,
            'run_date': datetime.now().isoformat(),
            'generated_cases': len(sim_arrivals),
            'processed_cases': total_processed,
            'closed_cases': total_closed,
            'final_backlog': sum(d.backlog for d in districts_agents.values()),
            'metadata': json.dumps({
                'days': days,
                'districts': len(top_districts_list),
                'supervisor_capacity': DEFAULT_SUPERVISOR_DAILY_REVIEW_CAPACITY,
            }),
        })

        # District metrics: total_cases counts arrivals routed to that district.
        for d, district_agent in districts_agents.items():
            district_metrics.append({
                'id': f'{run_id}_{d}',
                'run_id': run_id,
                'scenario_id': scenario_id,
                'district_or_area': district_display.get(d, d),
                'total_cases': district_agent.total_cases,
                'backlog': district_agent.backlog,
                'stale_cases': district_agent.stale_cases,
                'overload_flag': int(district_agent.overload_flag),
                'estimated_hours': round(district_agent.total_cases * 1.5, 1),
                'created_at': datetime.now().isoformat(),
            })

        # Complaint-type metrics: grouped by complaint_type across the simulation.
        for complaint_type, count in sorted(ct_counts.items(), key=lambda x: -x[1]):
            complaint_type_metrics.append({
                'id': f'{run_id}_{complaint_type}',
                'run_id': run_id,
                'scenario_id': scenario_id,
                'complaint_type': complaint_type,
                'total_cases': count,
                'estimated_hours': round(count * 1.5, 1),
                'created_at': datetime.now().isoformat(),
            })

    sim_stats = {
        'top_districts': top_districts_list,
        'distinct_districts': len({a['district'] for a in arrivals}),
        'distinct_complaint_types': len({a['complaint_type'] for a in arrivals}),
        'supervisor_queue_sizes': supervisor_queue_sizes,
    }
    return (scenario_runs, scenarios_list, daily_metrics, district_metrics,
            complaint_type_metrics, sim_stats)


# ============================================================================
# VALIDATION (rule 6)
# ============================================================================

def validate_outputs(arrivals, district_metrics, complaint_type_metrics, sim_stats):
    """Print diagnostics and raise on credibility failures."""
    total = len(arrivals)
    unknown = sum(1 for a in arrivals if a['district'] == 'Unknown')
    unknown_pct = (100.0 * unknown / total) if total else 0.0

    sizes = sim_stats['supervisor_queue_sizes']
    sup_min = min(sizes) if sizes else 0
    sup_max = max(sizes) if sizes else 0
    sup_avg = (sum(sizes) / len(sizes)) if sizes else 0.0

    print('\n=== VALIDATION ===')
    print(f'Distinct district count:        {sim_stats["distinct_districts"]}')
    print(f'Distinct complaint type count:  {sim_stats["distinct_complaint_types"]}')
    print(f'Supervisor queue min/max/avg:   {sup_min} / {sup_max} / {sup_avg:.1f}')
    print(f'Unknown district percentage:    {unknown_pct:.2f}%')
    print(f'District metric rows:           {len(district_metrics)}')
    print(f'Complaint-type metric rows:     {len(complaint_type_metrics)}')

    failures = []
    if unknown_pct > MAX_UNKNOWN_DISTRICT_PCT:
        failures.append(f'Unknown district {unknown_pct:.2f}% exceeds {MAX_UNKNOWN_DISTRICT_PCT}%')
    if len(complaint_type_metrics) == 0:
        failures.append('complaint_type_metrics has 0 rows')
    if len(district_metrics) == 0:
        failures.append('district_metrics has 0 rows')

    if failures:
        print('\nVALIDATION FAILED:')
        for f in failures:
            print(f'  - {f}')
        raise SystemExit(1)
    print('Validation passed.\n')
    return {
        'unknown_pct': unknown_pct,
        'supervisor_min': sup_min,
        'supervisor_max': sup_max,
        'supervisor_avg': sup_avg,
    }


# ============================================================================
# OUTPUT WRITERS
# ============================================================================

def write_csv(path: Path, fieldnames: list, rows: list):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in rows:
            writer.writerow(r)


def write_arrivals_csv(path: Path, arrivals: list):
    cols = ['borough', 'council_district', 'district', 'district_label', 'complaint_type',
            'closure_bucket', 'patrol_intensity_score', 'repeat_pressure_score',
            'closure_pressure_score', 'supervisor_review_required']
    write_csv(path, cols, arrivals)


def write_sql_loader(output_dir: Path, csv_files: dict):
    out_path = output_dir / 'load_ctgan_abm_results.sql'
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('-- SQL loader for CTGAN ABM results.\n')
        f.write('-- Adjust file paths and run in psql/supabase CLI as appropriate.\n')
        f.write('-- Usage: psql -d your_db -f load_ctgan_abm_results.sql\n\n')
        for table, csv_path in csv_files.items():
            escaped = csv_path.replace("'", "''")
            f.write(f"COPY public.{table} FROM '{escaped}' WITH (FORMAT csv, HEADER true);\n")


def write_all_outputs(output_dir, scenarios_list, scenario_runs, daily_metrics,
                      district_metrics, complaint_type_metrics):
    output_dir.mkdir(parents=True, exist_ok=True)
    csv_files = {}

    p = output_dir / 'ctgan_abm_scenarios.csv'
    write_csv(p, ['scenario_id', 'name', 'description', 'created_at'], scenarios_list)
    csv_files['ctgan_abm_scenarios'] = str(p)

    p = output_dir / 'ctgan_abm_scenario_runs.csv'
    write_csv(p, ['run_id', 'scenario_id', 'run_date', 'generated_cases', 'processed_cases',
                  'closed_cases', 'final_backlog', 'metadata'], scenario_runs)
    csv_files['ctgan_abm_scenario_runs'] = str(p)

    p = output_dir / 'ctgan_abm_daily_metrics.csv'
    write_csv(p, ['id', 'run_id', 'scenario_id', 'day', 'total_cases', 'processed', 'backlog',
                  'stale_cases', 'supervisor_queue_size', 'created_at'], daily_metrics)
    csv_files['ctgan_abm_daily_metrics'] = str(p)

    p = output_dir / 'ctgan_abm_district_metrics.csv'
    write_csv(p, ['id', 'run_id', 'scenario_id', 'district_or_area', 'total_cases', 'backlog',
                  'stale_cases', 'overload_flag', 'estimated_hours', 'created_at'], district_metrics)
    csv_files['ctgan_abm_district_metrics'] = str(p)

    p = output_dir / 'ctgan_abm_complaint_type_metrics.csv'
    write_csv(p, ['id', 'run_id', 'scenario_id', 'complaint_type', 'total_cases',
                  'estimated_hours', 'created_at'], complaint_type_metrics)
    csv_files['ctgan_abm_complaint_type_metrics'] = str(p)

    write_sql_loader(output_dir, csv_files)
    return csv_files


# ============================================================================
# SELF-TEST MODE
# ============================================================================

def generate_self_test_outputs(output_dir: Path):
    """Generate small, internally-consistent test data without training."""
    torch.manual_seed(42)
    random.seed(42)
    np.random.seed(42)
    output_dir.mkdir(parents=True, exist_ok=True)

    # A handful of real-shaped training rows -> exercise the full pipeline.
    boroughs = ['BROOKLYN', 'QUEENS', 'MANHATTAN', 'BRONX', 'STATEN ISLAND']
    cds = ['34', '10', '03', '01', '30', '40', '15', '09', '14', '']
    types = ['HEAT/HOT WATER', 'Noise - Residential', 'Illegal Parking', 'Blocked Driveway',
             'Street Light Condition', 'Street Condition', 'Abandoned Vehicle', 'Water System']
    buckets = ['same_day', '1_7_days', '8_30_days', '30_plus_days']

    fake_rows = []
    for i in range(1500):
        fake_rows.append({
            'borough': random.choice(boroughs),
            'council_district': random.choice(cds),
            'complaint_type': random.choice(types),
            'request_detail': 'detail',
            'closure_bucket': random.choice(buckets),
            'submitted_day_of_week': random.randint(0, 6),
            'submitted_hour': random.randint(0, 23),
            'submitted_month': random.randint(1, 12),
            'repeat_pressure_score': round(random.random(), 4),
            'patrol_intensity_score': round(random.random(), 4),
            'supervisor_review_likelihood': random.randint(0, 1),
        })

    scalers = {}
    for col in NUMERIC_COLS:
        vals = [_to_float(r.get(col)) for r in fake_rows]
        scalers[col] = (min(vals), max(vals))

    numeric_samples = np.random.rand(1500, len(NUMERIC_COLS)).astype(np.float32)
    arrivals = build_synthetic_arrivals(fake_rows, numeric_samples, scalers)

    (scenario_runs, scenarios_list, daily_metrics, district_metrics,
     complaint_type_metrics, sim_stats) = run_simulation(
        arrivals, days=7, top_districts=5, scenarios=1)

    write_arrivals_csv(output_dir / 'synthetic_complaint_arrivals.csv', arrivals)
    csv_files = write_all_outputs(output_dir, scenarios_list, scenario_runs, daily_metrics,
                                  district_metrics, complaint_type_metrics)
    validate_outputs(arrivals, district_metrics, complaint_type_metrics, sim_stats)

    print(f'Self-test outputs written to: {output_dir}')
    return csv_files


# ============================================================================
# REAL RUN MODE
# ============================================================================

def run_real_pipeline(input_path, output_dir, days, scenarios, synthetic_rows_count,
                      top_districts, epochs, batch_size):
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

    print('\n=== CTGAN ABM Real Run ===')
    print(f'Input: {input_path}')
    print(f'Output: {output_dir}')
    print(f'Days: {days}, Scenarios: {scenarios}, Synthetic rows: {synthetic_rows_count}')
    print(f'Device: {device}\n')

    print('Loading training data...')
    training_rows, scalers = load_training_data(input_path)
    print(f'  Loaded {len(training_rows)} training rows')

    print('Encoding numeric demand features...')
    train_data = np.vstack([encode_numeric(r, scalers) for r in training_rows])
    print(f'  Encoded shape: {train_data.shape}')

    print('\nTraining CTGAN...')
    latent_dim, condition_dim = 32, 16
    generator = train_ctgan(train_data, latent_dim=latent_dim, condition_dim=condition_dim,
                            epochs=epochs, batch_size=batch_size, device=device)

    print(f'\nGenerating {synthetic_rows_count} synthetic numeric samples...')
    numeric_samples = generate_numeric_samples(
        generator, synthetic_rows_count, latent_dim=latent_dim,
        condition_dim=condition_dim, device=device)

    print('Assembling synthetic arrivals (numeric GAN + empirical categoricals)...')
    arrivals = build_synthetic_arrivals(training_rows, numeric_samples, scalers)

    print(f'\nRunning ABM simulation ({days} days, {scenarios} scenario(s))...')
    (scenario_runs, scenarios_list, daily_metrics, district_metrics,
     complaint_type_metrics, sim_stats) = run_simulation(
        arrivals, days=days, top_districts=top_districts, scenarios=scenarios)

    print(f'\nWriting outputs to {output_dir}...')
    write_arrivals_csv(output_dir / 'synthetic_complaint_arrivals.csv', arrivals)
    csv_files = write_all_outputs(output_dir, scenarios_list, scenario_runs, daily_metrics,
                                  district_metrics, complaint_type_metrics)

    validate_outputs(arrivals, district_metrics, complaint_type_metrics, sim_stats)

    print(f'[OK] All outputs written to: {output_dir}')
    print(f'[OK] Synthetic arrivals:  {output_dir / "synthetic_complaint_arrivals.csv"}')
    print(f'[OK] SQL loader: {output_dir / "load_ctgan_abm_results.sql"}')


# ============================================================================
# MAIN
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description='CTGAN + ABM stress lab runner (local-only, PyTorch-based)')
    parser.add_argument('--self-test', action='store_true', help='Run self-test mode (no training)')
    parser.add_argument('--input', type=Path, default=DEFAULT_INPUT, help='Training CSV path')
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT_DIR, help='Output directory')
    parser.add_argument('--days', type=int, default=DEFAULT_DAYS, help='Simulation days')
    parser.add_argument('--scenarios', type=int, default=DEFAULT_SCENARIOS, help='Number of scenarios')
    parser.add_argument('--synthetic-rows', type=int, default=DEFAULT_SYNTHETIC_ROWS,
                        help='Synthetic complaints to generate')
    parser.add_argument('--top-districts', type=int, default=DEFAULT_TOP_DISTRICTS,
                        help='Top N districts to simulate')
    parser.add_argument('--epochs', type=int, default=DEFAULT_EPOCHS, help='CTGAN training epochs')
    parser.add_argument('--batch-size', type=int, default=DEFAULT_BATCH_SIZE, help='CTGAN batch size')

    args = parser.parse_args()

    print(f'PyTorch version: {torch.__version__}')
    print(f'CUDA available: {torch.cuda.is_available()}')
    if torch.cuda.is_available():
        print(f'GPU device name: {torch.cuda.get_device_name(0)}')
    print()

    if args.self_test:
        print('=== Self-test Mode ===')
        generate_self_test_outputs(args.output)
    else:
        if not args.input.exists():
            print(f'Error: Input file not found: {args.input}', file=sys.stderr)
            sys.exit(1)
        run_real_pipeline(args.input, args.output, args.days, args.scenarios,
                          args.synthetic_rows, args.top_districts, args.epochs, args.batch_size)


if __name__ == '__main__':
    main()
