//! Engine core — 1:1 port of streams.move (constructors, core utilities so far;
//! receive/squeeze/set_streams land in the following sections of the port).

use ethnum::U256;

extern crate alloc;

use crate::state::*;

pub const MAX_U64: u64 = u64::MAX;

impl StreamsRegistry {
    /// Move create_registry: cycle_secs > 1; min = ceil(multiplier / cycle_secs).
    pub fn new(cycle_secs: u64) -> StreamsResult<Self> {
        if cycle_secs <= 1 {
            return Err(StreamsError::CycleSecsTooLow);
        }
        let multiplier = U256::from(AMT_PER_SEC_MULTIPLIER);
        let min_amt_per_sec = (multiplier + U256::from(cycle_secs) - 1) / U256::from(cycle_secs);
        Ok(Self {
            cycle_secs,
            min_amt_per_sec,
            states: Default::default(),
            amt_deltas: Default::default(),
            next_squeezed: Default::default(),
        })
    }

    /// Cycle containing ts. Never cycle 0.
    pub fn cycle_of(&self, ts: u64) -> u64 {
        ts / self.cycle_secs + 1
    }

    /// Start of the cycle containing `now`.
    pub fn curr_cycle_start(&self, now: u64) -> u64 {
        now - (now % self.cycle_secs)
    }
}

/// floor(end * rate / M) - floor(start * rate / M) — the engine's fundamental quantum.
pub fn streamed_amt(amt_per_sec: U256, start: u64, end: u64) -> U256 {
    if end <= start {
        return U256::ZERO;
    }
    let m = U256::from(AMT_PER_SEC_MULTIPLIER);
    let amt_end = U256::from(end) * amt_per_sec / m;
    let amt_start = U256::from(start) * amt_per_sec / m;
    amt_end - amt_start
}

/// Receiver's streamed window, capped to [start_cap, end_cap].
pub fn stream_range(
    config: &StreamConfig,
    update_time: u64,
    max_end: u64,
    start_cap: u64,
    end_cap: u64,
) -> (u64, u64) {
    let stream_start = if config.start == 0 { update_time } else { config.start };
    let mut stream_end = stream_start.saturating_add(config.duration);
    if stream_end == stream_start || stream_end > max_end {
        stream_end = max_end;
    }
    let start = stream_start.max(start_cap);
    let end = stream_end.min(end_cap).max(start);
    (start, end)
}

pub fn stream_range_in_future(
    receiver: &StreamReceiver,
    update_time: u64,
    max_end: u64,
    now: u64,
) -> (u64, u64) {
    stream_range(&receiver.config, update_time, max_end, now, MAX_U64)
}

/// Receiver ordering: account_id, then config lexicographically.
pub fn is_ordered(prev: &StreamReceiver, next: &StreamReceiver) -> bool {
    if prev.account_id != next.account_id {
        return prev.account_id < next.account_id;
    }
    config_lt(&prev.config, &next.config)
}

fn config_lt(a: &StreamConfig, b: &StreamConfig) -> bool {
    if a.stream_id != b.stream_id {
        return a.stream_id < b.stream_id;
    }
    if a.amt_per_sec != b.amt_per_sec {
        return a.amt_per_sec < b.amt_per_sec;
    }
    if a.start != b.start {
        return a.start < b.start;
    }
    a.duration < b.duration
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_min_rate_is_one_token_per_cycle() {
        let r = StreamsRegistry::new(3600).unwrap();
        // ceil(1e9 / 3600) = 277_778
        assert_eq!(r.min_amt_per_sec, U256::from(277_778u64));
        assert!(StreamsRegistry::new(1).is_err());
    }

    #[test]
    fn streamed_amt_floor_pair_never_overcounts() {
        // rate 1.5 tokens/s (1_500_000_000 scaled): floor-pair over [0,3] = 4 units... no:
        // floor(3*1.5)-floor(0)=4. Split at t=1: floor(1.5)=1, then floor(4.5)-floor(1.5)=3.
        // Total identical — the floor-pair form makes split points lossless.
        let rate = U256::from(1_500_000_000u64);
        let whole = streamed_amt(rate, 0, 3);
        let split = streamed_amt(rate, 0, 1) + streamed_amt(rate, 1, 3);
        assert_eq!(whole, split);
        assert_eq!(whole, U256::from(4u8));
    }

    #[test]
    fn stream_range_caps_and_zero_start_uses_update_time() {
        let cfg = StreamConfig { stream_id: 0, amt_per_sec: U256::ONE, start: 0, duration: 0 };
        // start=0 → update_time; duration=0 → forever → capped at max_end.
        assert_eq!(stream_range(&cfg, 100, 500, 0, MAX_U64), (100, 500));
        let cfg2 = StreamConfig { stream_id: 0, amt_per_sec: U256::ONE, start: 200, duration: 50 };
        assert_eq!(stream_range(&cfg2, 100, 500, 220, 240), (220, 240));
        // end below start clamps to start (empty range).
        assert_eq!(stream_range(&cfg2, 100, 500, 260, 240), (260, 260));
    }
}

// ── Cycle accumulation (Move process_cycles) ────────────────────────────────────

/// Walk cycles [from, to), folding deltas into a running per-cycle rate and total.
pub fn process_cycles(
    amt_deltas: &alloc::collections::BTreeMap<(AccountId, u64), AmtDelta>,
    account_id: AccountId,
    from_cycle: u64,
    to_cycle: u64,
    received_amt: u128,
    amt_per_cycle: i128,
) -> (u128, i128) {
    let mut acc_received = received_amt;
    let mut acc_rate = amt_per_cycle;
    for cycle in from_cycle..to_cycle {
        if let Some(delta) = amt_deltas.get(&(account_id, cycle)) {
            acc_rate += delta.this_cycle;
            acc_received += u128::try_from(acc_rate).expect("negative cycle rate");
            acc_rate += delta.next_cycle;
        } else {
            acc_received += u128::try_from(acc_rate).expect("negative cycle rate");
        }
    }
    (acc_received, acc_rate)
}

// ── Hash chain (Move hash_streams / hash_streams_history) ───────────────────────
//
// blake2b-256 like the Move source. The preimage encoding is this engine's own
// canonical fixed-width layout, NOT Sui's BCS: these hashes never leave the chain
// they were written on — they only need to be internally consistent + collision
// resistant. (EVM uses keccak/abi for the same role; the chains never compare.)

use blake2::digest::consts::U32;
use blake2::{Blake2b, Digest};

type Blake2b256 = Blake2b<U32>;

pub fn hash_streams(receivers: &[StreamReceiver]) -> alloc::vec::Vec<u8> {
    if receivers.is_empty() {
        return alloc::vec::Vec::new();
    }
    let mut h = Blake2b256::new();
    for r in receivers {
        h.update(r.account_id.to_be_bytes());
        h.update(r.config.stream_id.to_le_bytes());
        h.update(r.config.amt_per_sec.to_be_bytes());
        h.update(r.config.start.to_le_bytes());
        h.update(r.config.duration.to_le_bytes());
    }
    h.finalize().to_vec()
}

pub fn hash_streams_history(
    old_streams_history_hash: &[u8],
    streams_hash: &[u8],
    update_time: u64,
    max_end: u64,
) -> alloc::vec::Vec<u8> {
    let mut h = Blake2b256::new();
    h.update(old_streams_history_hash);
    h.update(streams_hash);
    h.update(update_time.to_le_bytes());
    h.update(max_end.to_le_bytes());
    h.finalize().to_vec()
}

// ── Config preprocessing (Move build_configs) ───────────────────────────────────

impl StreamsRegistry {
    /// Validate ordering + min rate, window each receiver to the future, skip expired.
    pub fn build_configs(
        &self,
        receivers: &[StreamReceiver],
        now: u64,
    ) -> StreamsResult<alloc::vec::Vec<ProcessedConfig>> {
        if receivers.len() > MAX_STREAMS_RECEIVERS {
            return Err(StreamsError::TooManyReceivers);
        }
        let mut configs = alloc::vec::Vec::new();
        for (i, receiver) in receivers.iter().enumerate() {
            if i > 0 && !is_ordered(&receivers[i - 1], receiver) {
                return Err(StreamsError::ReceiversNotSorted);
            }
            if receiver.config.amt_per_sec < self.min_amt_per_sec {
                return Err(StreamsError::AmtPerSecTooLow);
            }
            let (start, end) = stream_range_in_future(receiver, now, MAX_U64, now);
            if start != end {
                configs.push(ProcessedConfig {
                    amt_per_sec: receiver.config.amt_per_sec,
                    start,
                    end,
                });
            }
        }
        Ok(configs)
    }
}
