//! Conditions scoring (OddSol `conditions` mode) — deterministic predicate front-end.
//!
//! Evaluates committed slip legs (term + predicate + frozen milli-odds) against proven
//! match facts (`ScoreStat` by `stat_key = period*1000 + base`), producing a per-slip
//! fixed-point coefficient `S`. Reproduces OddSol `scoreExpress` / `coefficientFixed`
//! bit-for-bit (`packages/scoring/src/index.mjs`), verified against
//! `packages/scoring/vre-parity-vectors.json`.
//!
//! Fixed-point contract (locked with OddSol):
//! - odds carried as `odds_milli` (×1000): `2.15 → 2150`, range `[1001, 1_000_000]`.
//! - product of the effective (non-void) legs accumulated in `u128`.
//! - `S` emitted ×10000 (4 dp) with a SINGLE round-half-up:
//!     `S = (product * 10000 + denom/2) / denom`, `denom = 1000^N` (integer division).
//! - `void` = push (leg drops from product); any `miss` → `S = 0`; `pending` → not settled → 0.
//!
//! Totals push parity (locked, variant B): totals legs carry `line_x2 = round(line*2)`;
//! `total2 = 2*(g1+g2)`; `void ⟺ line_x2 % 2 == 0 && total2 == line_x2`, else
//! `over = total2 > line_x2`, `under = total2 < line_x2`. This distinguishes under@1.5
//! (`line_x2 = 3`, odd → miss at sum 2) from under@2.0 (`line_x2 = 4`, even → push at sum 2),
//! which a compiled threshold alone could not.

use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};

pub const FORMAT_VERSION_CONDITIONS: u16 = 9;
pub const FORMULA_CODE_CONDITIONS: u8 = 7;

/// Milli-odds scale (×1000) — TxLINE's native integer odds scale.
pub const ODDS_SCALE: u128 = 1_000;
/// Coefficient output scale (×10000, 4 dp).
pub const FIXED_SCALE: u128 = 10_000;
/// Max legs per slip (locked with OddSol).
pub const MAX_LEGS: usize = 8;
/// Milli-odds band (locked with OddSol): odds 1.001 .. 1000.0.
pub const MIN_ODDS_MILLI: u64 = 1_001;
pub const MAX_ODDS_MILLI: u64 = 1_000_000;

// LegCommit tag encodings (locked borsh layout).
pub const TERM_SINGLE: u8 = 0;
pub const TERM_BINARY: u8 = 1;
pub const OP_NONE: u8 = 0;
pub const OP_ADD: u8 = 1;
pub const OP_SUBTRACT: u8 = 2;
pub const CMP_GT: u8 = 0;
pub const CMP_LT: u8 = 1;
pub const CMP_EQ: u8 = 2;
/// Sentinel `line_x2` for legs without a total line (1x2 / btts).
pub const NO_LINE: i32 = i32::MIN;

/// Canonical committed leg. Borsh layout is the parity contract with OddSol's on-chain
/// commit; field order here IS the serialized order.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct LegCommit {
    pub term_kind: u8,   // 0 Single | 1 Binary
    pub stat_key_a: u32,
    pub stat_key_b: u32, // 0 if Single
    pub op: u8,          // 0 none | 1 Add | 2 Subtract
    pub comparison: u8,  // 0 GT | 1 LT | 2 EQ
    pub threshold: i32,  // 1x2/btts: 0
    pub line_x2: i32,    // totals: round(line*2); else NO_LINE
    pub odds_milli: u64,
}

/// Canonical slip commitment preimage: `slip_hash = sha256(borsh(EntryCommit))`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct EntryCommit {
    pub wallet: [u8; 32],
    pub tier: u64,
    pub legs: Vec<LegCommit>, // canonically sorted (see `sort_legs`)
}

/// A single proven fact: `stat_key = period*1000 + base` (base 1 = P1 goals, 2 = P2 goals).
/// `period` is derivable as `stat_key / 1000` and is deliberately NOT committed (single source
/// of truth with `LegCommit.stat_key_*`).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct ScoreStat {
    pub stat_key: u32,
    pub value: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LegResult {
    Hit,
    Miss,
    Void,
    Pending,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SlipScore {
    /// `false` if any leg is pending (missing facts).
    pub settled: bool,
    /// `true` iff settled and every effective (non-void) leg hit.
    pub all_hit: bool,
    /// Number of legs that pushed (void).
    pub void_count: u32,
    /// Coefficient ×10000 (0 unless settled and all effective legs hit).
    pub score_fixed: u64,
}

fn stat_value(facts: &[ScoreStat], key: u32) -> Option<i32> {
    facts.iter().find(|s| s.stat_key == key).map(|s| s.value)
}

/// Structural validity of a leg (tags in range, odds within band). Does not touch facts.
pub fn validate_leg(leg: &LegCommit) -> bool {
    let ok_kind = leg.term_kind == TERM_SINGLE || leg.term_kind == TERM_BINARY;
    let ok_op = matches!(leg.op, OP_NONE | OP_ADD | OP_SUBTRACT);
    let ok_cmp = matches!(leg.comparison, CMP_GT | CMP_LT | CMP_EQ);
    let ok_single = leg.term_kind != TERM_SINGLE || (leg.op == OP_NONE && leg.stat_key_b == 0);
    let ok_binary = leg.term_kind != TERM_BINARY || leg.op != OP_NONE;
    let ok_odds = leg.odds_milli >= MIN_ODDS_MILLI && leg.odds_milli <= MAX_ODDS_MILLI;
    ok_kind && ok_op && ok_cmp && ok_single && ok_binary && ok_odds
}

/// Evaluate one leg against its fixture's facts.
pub fn eval_leg(leg: &LegCommit, facts: &[ScoreStat]) -> LegResult {
    let value = if leg.term_kind == TERM_SINGLE {
        match stat_value(facts, leg.stat_key_a) {
            Some(v) => v,
            None => return LegResult::Pending,
        }
    } else {
        let a = match stat_value(facts, leg.stat_key_a) {
            Some(v) => v,
            None => return LegResult::Pending,
        };
        let b = match stat_value(facts, leg.stat_key_b) {
            Some(v) => v,
            None => return LegResult::Pending,
        };
        match leg.op {
            OP_ADD => a.saturating_add(b),
            OP_SUBTRACT => a.saturating_sub(b),
            _ => return LegResult::Miss, // OP_NONE on a Binary term is invalid → never hit
        }
    };

    if leg.line_x2 == NO_LINE {
        // Discrete market (1x2 / btts): compare the raw term value against threshold.
        let hit = match leg.comparison {
            CMP_GT => value > leg.threshold,
            CMP_LT => value < leg.threshold,
            CMP_EQ => value == leg.threshold,
            _ => false,
        };
        return if hit { LegResult::Hit } else { LegResult::Miss };
    }

    // Totals market: work in ×2 space so half-lines are integers and pushes are exact.
    let total2 = value.saturating_mul(2);
    if leg.line_x2 % 2 == 0 && total2 == leg.line_x2 {
        return LegResult::Void; // push
    }
    let hit = match leg.comparison {
        CMP_GT => total2 > leg.line_x2, // over
        CMP_LT => total2 < leg.line_x2, // under
        _ => false,
    };
    if hit {
        LegResult::Hit
    } else {
        LegResult::Miss
    }
}

/// Fixed-point product of milli-odds → coefficient ×10000, single round-half-up.
/// Mirrors OddSol `coefficientFixed`. Returns `None` on too-many-legs, out-of-band odds,
/// or `u128` overflow (same rejection surface both sides enforce before a payout).
pub fn coefficient_fixed(odds_milli: &[u64]) -> Option<u64> {
    if odds_milli.len() > MAX_LEGS {
        return None;
    }
    let mut product: u128 = 1;
    let mut denom: u128 = 1;
    for &o in odds_milli {
        if o < MIN_ODDS_MILLI || o > MAX_ODDS_MILLI {
            return None;
        }
        product = product.checked_mul(o as u128)?;
        denom = denom.checked_mul(ODDS_SCALE)?;
    }
    let numerator = product.checked_mul(FIXED_SCALE)?.checked_add(denom / 2)?;
    u64::try_from(numerator / denom).ok()
}

/// Score a slip: evaluate every leg against its fixture facts, then apply the fixed-point
/// coefficient over the effective (non-void) legs. `facts_by_leg[i]` is the fact set for `legs[i]`.
pub fn score_slip(legs: &[LegCommit], facts_by_leg: &[&[ScoreStat]]) -> SlipScore {
    let mut settled = true;
    let mut all_hit = true;
    let mut void_count: u32 = 0;
    let mut effective: Vec<u64> = Vec::with_capacity(legs.len());

    for (leg, facts) in legs.iter().zip(facts_by_leg.iter()) {
        match eval_leg(leg, facts) {
            LegResult::Pending => settled = false,
            LegResult::Void => void_count += 1,
            LegResult::Hit => effective.push(leg.odds_milli),
            LegResult::Miss => {
                effective.push(leg.odds_milli);
                all_hit = false;
            }
        }
    }

    let settled_all_hit = settled && all_hit;
    let score_fixed = if settled_all_hit {
        coefficient_fixed(&effective).unwrap_or(0)
    } else {
        0
    };

    SlipScore {
        settled,
        all_hit: settled_all_hit,
        void_count,
        score_fixed,
    }
}

/// Canonical leg ordering for the commit preimage (locked with OddSol).
pub fn sort_legs(legs: &mut [LegCommit]) {
    legs.sort_by_key(|l| {
        (
            l.stat_key_a,
            l.stat_key_b,
            l.op,
            l.comparison,
            l.threshold,
            l.line_x2,
            l.odds_milli,
        )
    });
}

/// `slip_hash = sha256(borsh(EntryCommit))` with canonically sorted legs.
pub fn slip_hash(wallet: [u8; 32], tier: u64, legs: &[LegCommit]) -> [u8; 32] {
    let mut sorted = legs.to_vec();
    sort_legs(&mut sorted);
    let commit = EntryCommit {
        wallet,
        tier,
        legs: sorted,
    };
    // AnchorSerialize == borsh; infallible for these plain types.
    let bytes = commit.try_to_vec().unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    hasher.finalize().into()
}

/// One entrant's resolved result, ready for round ranking.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RankedEntrant {
    pub wallet: [u8; 32],
    /// On-chain `Entry.entered_at` (unix seconds) — tie-break after score.
    pub entered_at: i64,
    pub score_fixed: u64,
    pub all_hit: bool,
    pub void_count: u32,
    pub settled: bool,
}

/// Rank a round for the resolution artifact. Winners (`all_hit`) come first, ordered by
/// `score_fixed` desc, then `entered_at` asc, then `wallet` asc (fully deterministic).
/// Non-winners follow in the same tie-break order. Payout is pro-rata over the winners
/// (`net * S_i / ΣS`) and is executed by OddSol — VRE only proves per-entrant S + ranking.
pub fn rank_round(mut entrants: Vec<RankedEntrant>) -> Vec<RankedEntrant> {
    entrants.sort_by(|a, b| {
        b.all_hit
            .cmp(&a.all_hit) // winners (true) first
            .then(b.score_fixed.cmp(&a.score_fixed)) // S desc
            .then(a.entered_at.cmp(&b.entered_at)) // entered_at asc
            .then(a.wallet.cmp(&b.wallet)) // wallet asc
    });
    entrants
}

/// Sum of winning scores (`ΣS` over `all_hit` entrants) — the pro-rata denominator OddSol uses.
pub fn winning_score_sum(entrants: &[RankedEntrant]) -> u128 {
    entrants
        .iter()
        .filter(|e| e.all_hit)
        .map(|e| e.score_fixed as u128)
        .sum()
}

// ---------------------------------------------------------------------------------------
// fc7 / fv9 resolution artifact (locked with OddSol).
//
// Layout (borsh, LE): magic b"W3O1" ‖ format_version(u16) ‖ formula_code(u8) ‖ winners_mode(u8)
//   ‖ fixtures: Vec<ConditionsFixture> ‖ entrants: Vec<ConditionsEntrant>.
// Facts join legs by stat_key EQUALITY (not index); each leg picks its fixture via a parallel
// `fixture_index` into `fixtures`. `LegCommit` / `slip_hash` are untouched (no re-hash).
// `event_stat_root` is the verbatim TxLINE facts-ref anchor (VRE binds, does not re-verify).
// ---------------------------------------------------------------------------------------

pub const CONDITIONS_MAGIC: [u8; 4] = *b"W3O1";
/// Winners = every settled `all_hit` slip; payout is pro-rata over them (OddSol side).
pub const WINNERS_MODE_ALL_HIT_PRORATA: u8 = 0;

/// One committed fixture (match) with its proven stats and facts-ref anchor.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct ConditionsFixture {
    pub fixture_id: u32,
    pub event_stat_root: [u8; 32],
    pub stats: Vec<ScoreStat>,
}

/// One committed entrant: identity + tie-break key + slip legs, each pointing at a fixture.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct ConditionsEntrant {
    pub wallet: [u8; 32],
    pub tier: u64,
    pub entered_at: i64,
    pub legs: Vec<LegCommit>,
    /// Parallel to `legs`: index into the artifact `fixtures` for each leg.
    pub fixture_index: Vec<u16>,
}

impl ConditionsEntrant {
    /// Recompute this entrant's `slip_hash` from the committed legs (not trusted from input).
    pub fn slip_hash(&self) -> [u8; 32] {
        slip_hash(self.wallet, self.tier, &self.legs)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct ConditionsArtifact {
    pub magic: [u8; 4],
    pub format_version: u16,
    pub formula_code: u8,
    pub winners_mode: u8,
    pub fixtures: Vec<ConditionsFixture>,
    pub entrants: Vec<ConditionsEntrant>,
}

impl ConditionsArtifact {
    pub fn new(fixtures: Vec<ConditionsFixture>, entrants: Vec<ConditionsEntrant>) -> Self {
        Self {
            magic: CONDITIONS_MAGIC,
            format_version: FORMAT_VERSION_CONDITIONS,
            formula_code: FORMULA_CODE_CONDITIONS,
            winners_mode: WINNERS_MODE_ALL_HIT_PRORATA,
            fixtures,
            entrants,
        }
    }

    /// Serialize to the fc7 byte artifact.
    pub fn to_bytes(&self) -> Vec<u8> {
        self.try_to_vec().unwrap_or_default()
    }

    /// Parse an fc7 byte artifact, validating the header.
    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        let a = Self::deserialize(&mut &bytes[..]).ok()?;
        if a.magic == CONDITIONS_MAGIC
            && a.format_version == FORMAT_VERSION_CONDITIONS
            && a.formula_code == FORMULA_CODE_CONDITIONS
        {
            Some(a)
        } else {
            None
        }
    }

    /// Structural validity: every entrant's `fixture_index` is parallel to `legs`, in range,
    /// leg count within bounds, and legs structurally valid.
    pub fn validate(&self) -> bool {
        let nfix = self.fixtures.len();
        self.entrants.iter().all(|e| {
            e.legs.len() == e.fixture_index.len()
                && e.legs.len() <= MAX_LEGS
                && e.fixture_index.iter().all(|&i| (i as usize) < nfix)
                && e.legs.iter().all(validate_leg)
        })
    }
}

/// Replay core: recompute every entrant's `S` from the committed artifact (facts joined per
/// leg via `fixture_index`), then rank the round. This is what the verifier compares to the
/// on-chain resolution for MATCH.
pub fn resolve_conditions_artifact(artifact: &ConditionsArtifact) -> Vec<RankedEntrant> {
    let mut ranked = Vec::with_capacity(artifact.entrants.len());
    for e in &artifact.entrants {
        let facts_by_leg: Vec<&[ScoreStat]> = e
            .fixture_index
            .iter()
            .map(|&fi| {
                artifact
                    .fixtures
                    .get(fi as usize)
                    .map(|f| f.stats.as_slice())
                    .unwrap_or(&[])
            })
            .collect();
        let score = score_slip(&e.legs, &facts_by_leg);
        ranked.push(RankedEntrant {
            wallet: e.wallet,
            entered_at: e.entered_at,
            score_fixed: score.score_fixed,
            all_hit: score.all_hit,
            void_count: score.void_count,
            settled: score.settled,
        });
    }
    rank_round(ranked)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(stat_key: u32, value: i32) -> ScoreStat {
        ScoreStat { stat_key, value }
    }
    /// 1x2 / discrete leg (no line).
    fn disc(a: u32, b: u32, op: u8, cmp: u8, th: i32, odds: u64) -> LegCommit {
        LegCommit { term_kind: TERM_BINARY, stat_key_a: a, stat_key_b: b, op, comparison: cmp, threshold: th, line_x2: NO_LINE, odds_milli: odds }
    }
    /// totals leg with `line_x2`.
    fn tot(cmp: u8, line_x2: i32, odds: u64) -> LegCommit {
        LegCommit { term_kind: TERM_BINARY, stat_key_a: 1, stat_key_b: 2, op: OP_ADD, comparison: cmp, threshold: 0, line_x2, odds_milli: odds }
    }

    // Ground truth: OddSol packages/scoring/vre-parity-vectors.json (scoreExpress.scoreFixed).

    #[test]
    fn acceptance_vector() {
        assert_eq!(coefficient_fixed(&[2150, 1850]), Some(39_775));
    }

    #[test]
    fn all_hit_2leg() {
        let f1 = [f(1, 2), f(2, 0)];
        let f2 = [f(1, 1), f(2, 1)];
        let legs = [disc(1, 2, OP_SUBTRACT, CMP_GT, 0, 2150), tot(CMP_LT, 5, 1850)]; // under@2.5
        let s = score_slip(&legs, &[&f1, &f2]);
        assert_eq!((s.settled, s.all_hit, s.void_count, s.score_fixed), (true, true, 0, 39_775));
    }

    #[test]
    fn any_miss_zero() {
        let f1 = [f(1, 2), f(2, 0)];
        let f2 = [f(1, 1), f(2, 1)];
        let legs = [disc(1, 2, OP_SUBTRACT, CMP_GT, 0, 2150), tot(CMP_LT, 3, 1850)]; // under@1.5 → miss
        let s = score_slip(&legs, &[&f1, &f2]);
        assert_eq!((s.settled, s.all_hit, s.void_count, s.score_fixed), (true, false, 0, 0));
    }

    #[test]
    fn void_push_integer_line() {
        let f1 = [f(1, 2), f(2, 0)];
        let f2 = [f(1, 1), f(2, 1)];
        let legs = [disc(1, 2, OP_SUBTRACT, CMP_GT, 0, 2150), tot(CMP_LT, 4, 1850)]; // under@2.0 → push
        let s = score_slip(&legs, &[&f1, &f2]);
        assert_eq!((s.settled, s.all_hit, s.void_count, s.score_fixed), (true, true, 1, 21_500));
    }

    #[test]
    fn mixed_void_and_hit() {
        let f1 = [f(1, 2), f(2, 0)];
        let f2 = [f(1, 1), f(2, 1)];
        let f3 = [f(1, 2), f(2, 1)];
        let legs = [disc(1, 2, OP_SUBTRACT, CMP_GT, 0, 2150), tot(CMP_LT, 4, 1850), tot(CMP_GT, 5, 1900)];
        let s = score_slip(&legs, &[&f1, &f2, &f3]);
        assert_eq!((s.settled, s.all_hit, s.void_count, s.score_fixed), (true, true, 1, 40_850));
    }

    #[test]
    fn pending_no_facts() {
        let f1 = [f(1, 2), f(2, 0)];
        let f9: [ScoreStat; 0] = [];
        let legs = [disc(1, 2, OP_SUBTRACT, CMP_GT, 0, 2150), tot(CMP_GT, 5, 1900)];
        let s = score_slip(&legs, &[&f1, &f9]);
        assert_eq!((s.settled, s.all_hit, s.void_count, s.score_fixed), (false, false, 0, 0));
    }

    #[test]
    fn multi_leg_3() {
        let f1 = [f(1, 1), f(2, 0)];
        let f2 = [f(1, 1), f(2, 1)];
        let f3 = [f(1, 1), f(2, 1)];
        let legs = [disc(1, 2, OP_SUBTRACT, CMP_GT, 0, 2000), tot(CMP_GT, 3, 1500), tot(CMP_LT, 7, 1850)];
        let s = score_slip(&legs, &[&f1, &f2, &f3]);
        assert_eq!((s.settled, s.all_hit, s.void_count, s.score_fixed), (true, true, 0, 55_500));
    }

    #[test]
    fn draw_hit() {
        let f1 = [f(1, 1), f(2, 1)];
        let legs = [disc(1, 2, OP_SUBTRACT, CMP_EQ, 0, 3400)];
        let s = score_slip(&legs, &[&f1]);
        assert_eq!((s.settled, s.all_hit, s.void_count, s.score_fixed), (true, true, 0, 34_000));
    }

    #[test]
    fn slip_hash_is_order_independent() {
        // Canonical sort → permutations of the same legs hash identically.
        let a = tot(CMP_LT, 5, 1850);
        let b = disc(1, 2, OP_SUBTRACT, CMP_GT, 0, 2150);
        let w = [7u8; 32];
        assert_eq!(slip_hash(w, 100, &[a, b]), slip_hash(w, 100, &[b, a]));
        // Distinct slips differ.
        assert_ne!(slip_hash(w, 100, &[a, b]), slip_hash(w, 200, &[a, b]));
    }

    #[test]
    fn cross_check_slip_hash_all_hit_2leg() {
        // OddSol reference (packages/txline/src/slip-commit.mjs): all_hit_2leg.
        let wallet: [u8; 32] = core::array::from_fn(|i| (i as u8) + 1); // 01..20
        let under = tot(CMP_LT, 5, 1850); // under 2.5
        let home = disc(1, 2, OP_SUBTRACT, CMP_GT, 0, 2150);
        // Input order does not matter — slip_hash sorts canonically.
        let h = slip_hash(wallet, 50, &[home, under]);
        let expected: [u8; 32] = [
            0x42, 0x21, 0x83, 0xbb, 0x68, 0x2e, 0x7c, 0x91, 0x44, 0xb1, 0xdf, 0x8a, 0x9f, 0xc0,
            0xac, 0x6d, 0xce, 0x47, 0xf5, 0x3a, 0x09, 0x23, 0x7c, 0xf1, 0x83, 0x22, 0x0e, 0xa6,
            0x1d, 0xaa, 0xea, 0xf6,
        ];
        assert_eq!(h, expected);
    }

    #[test]
    fn rank_round_tie_break() {
        let w = |b: u8| -> [u8; 32] { [b; 32] };
        let e = |wb: u8, at: i64, s: u64, hit: bool| RankedEntrant {
            wallet: w(wb),
            entered_at: at,
            score_fixed: s,
            all_hit: hit,
            void_count: 0,
            settled: true,
        };
        // A,B tie on S=39775; A entered earlier → A before B. C higher S → first. D miss → last.
        let c = e(0x0c, 500, 55_500, true);
        let a = e(0x0a, 100, 39_775, true);
        let b = e(0x0b, 200, 39_775, true);
        let d = e(0x0d, 50, 0, false);
        let ranked = rank_round(vec![b, d, a, c]);
        let order: Vec<u8> = ranked.iter().map(|r| r.wallet[0]).collect();
        assert_eq!(order, vec![0x0c, 0x0a, 0x0b, 0x0d]); // C, A, B, then miss D
        assert_eq!(winning_score_sum(&ranked), (55_500 + 39_775 + 39_775) as u128);
    }

    #[test]
    fn rank_round_wallet_tie_break() {
        // Same S and same entered_at → wallet asc.
        let mk = |wb: u8| RankedEntrant {
            wallet: [wb; 32],
            entered_at: 100,
            score_fixed: 20_000,
            all_hit: true,
            void_count: 0,
            settled: true,
        };
        let ranked = rank_round(vec![mk(0x03), mk(0x01), mk(0x02)]);
        let order: Vec<u8> = ranked.iter().map(|r| r.wallet[0]).collect();
        assert_eq!(order, vec![0x01, 0x02, 0x03]);
    }

    #[test]
    fn fc7_roundtrip_and_resolve() {
        // Shared fixtures: F1 (P1=2,P2=0), F2 (P1=1,P2=1).
        let fixtures = vec![
            ConditionsFixture { fixture_id: 1, event_stat_root: [0x11; 32], stats: vec![ScoreStat { stat_key: 1, value: 2 }, ScoreStat { stat_key: 2, value: 0 }] },
            ConditionsFixture { fixture_id: 2, event_stat_root: [0x22; 32], stats: vec![ScoreStat { stat_key: 1, value: 1 }, ScoreStat { stat_key: 2, value: 1 }] },
        ];
        // A: home(F1) + under@2.5(F2) → all_hit, S=39775.
        let a = ConditionsEntrant {
            wallet: [0x0a; 32], tier: 50, entered_at: 100,
            legs: vec![disc(1, 2, OP_SUBTRACT, CMP_GT, 0, 2150), tot(CMP_LT, 5, 1850)],
            fixture_index: vec![0, 1],
        };
        // B: home(F1) + under@2.0(F2) → void push on leg2 → all_hit, S=21500.
        let b = ConditionsEntrant {
            wallet: [0x0b; 32], tier: 50, entered_at: 200,
            legs: vec![disc(1, 2, OP_SUBTRACT, CMP_GT, 0, 2150), tot(CMP_LT, 4, 1850)],
            fixture_index: vec![0, 1],
        };
        let artifact = ConditionsArtifact::new(fixtures, vec![b.clone(), a.clone()]);
        assert!(artifact.validate());

        // Byte roundtrip.
        let bytes = artifact.to_bytes();
        assert_eq!(&bytes[0..4], b"W3O1");
        let parsed = ConditionsArtifact::from_bytes(&bytes).expect("parse");
        assert_eq!(parsed, artifact);

        // Replay: recompute S + ranking from committed bytes.
        let ranked = resolve_conditions_artifact(&parsed);
        assert_eq!(ranked.len(), 2);
        // A (S=39775) ranks before B (S=21500); both winners.
        assert_eq!(ranked[0].wallet[0], 0x0a);
        assert_eq!(ranked[0].score_fixed, 39_775);
        assert!(ranked[0].all_hit);
        assert_eq!(ranked[1].wallet[0], 0x0b);
        assert_eq!(ranked[1].score_fixed, 21_500);
        assert_eq!(ranked[1].void_count, 1);
        assert_eq!(winning_score_sum(&ranked), (39_775 + 21_500) as u128);
    }

    #[test]
    fn fc7_validate_rejects_bad_input() {
        let fixtures = vec![ConditionsFixture { fixture_id: 1, event_stat_root: [0; 32], stats: vec![] }];
        // fixture_index out of range.
        let bad_idx = ConditionsArtifact::new(
            fixtures.clone(),
            vec![ConditionsEntrant { wallet: [1; 32], tier: 10, entered_at: 0, legs: vec![tot(CMP_LT, 5, 1850)], fixture_index: vec![9] }],
        );
        assert!(!bad_idx.validate());
        // legs / fixture_index length mismatch.
        let bad_len = ConditionsArtifact::new(
            fixtures,
            vec![ConditionsEntrant { wallet: [1; 32], tier: 10, entered_at: 0, legs: vec![tot(CMP_LT, 5, 1850)], fixture_index: vec![0, 0] }],
        );
        assert!(!bad_len.validate());
    }

    #[test]
    fn bounds_enforced() {
        assert!(coefficient_fixed(&[1000]).is_none()); // below band
        assert!(coefficient_fixed(&[1_000_001]).is_none()); // above band
        assert!(coefficient_fixed(&[2000; MAX_LEGS + 1]).is_none()); // too many legs
        assert!(validate_leg(&tot(CMP_LT, 5, 1850)));
        assert!(!validate_leg(&tot(CMP_LT, 5, 1000))); // odds below band
    }
}
