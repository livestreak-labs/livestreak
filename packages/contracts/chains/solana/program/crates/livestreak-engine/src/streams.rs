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
