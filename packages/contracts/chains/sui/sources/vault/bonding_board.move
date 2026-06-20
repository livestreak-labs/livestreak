// SPDX-License-Identifier: GPL-3.0-only

module livestreak::bonding_board;

const BASE_PRICE: u256 = 100_000;
const CURVE_K: u256 = 10_000_000_000;
const SHARE_SCALE: u256 = 1_000_000;
const WAD: u256 = 1_000_000_000_000_000_000;
const LN2_WAD: u256 = 693147180559945309;

public fun price(pool: u256): u256 {
    BASE_PRICE + (BASE_PRICE * pool) / CURVE_K
}

public fun seg_math(pool: u256, side_rate: u256, dt: u256): (u256, u256) {
    let p0 = price(pool);
    let new_pool = pool + side_rate * dt;
    let p1 = price(new_pool);
    if (p1 == p0) {
        return (new_pool, 0)
    };
    let ratio_wad = (p1 * WAD) / p0;
    let lnv = ln_wad(ratio_wad);
    let d_g = (SHARE_SCALE * CURVE_K * lnv) / (BASE_PRICE * side_rate);
    (new_pool, d_g)
}

fun ln_wad(x: u256): u256 {
    assert!(x >= WAD, 0);
    let mut k: u64 = 0;
    let mut m = x;
    while (m >= 2 * WAD) {
        m = m / 2;
        k = k + 1;
    };
    let z = m - WAD;
    let z2 = (z * z) / WAD;
    let z3 = (z2 * z) / WAD;
    let ln_m = z - z2 / 2 + z3 / 3;
    ln_m + (k as u256) * LN2_WAD
}

#[test_only]
public fun base_price(): u256 { BASE_PRICE }

#[test_only]
public fun wad(): u256 { WAD }

#[test]
fun test_price_empty() {
    assert!(price(0) == 100_000, 0);
}

#[test]
fun test_price_doubles_at_curve_k() {
    assert!(price(10_000_000_000) == 200_000, 0);
}

#[test]
fun test_seg_math_worked_example() {
    let (new_pool, d_g) = seg_math(0, 1_000_000, 50);
    assert!(new_pool == 50_000_000, 0);
    let shares = (1_000_000 * d_g) / WAD;
    assert!(shares > 498_650_000 && shares < 498_850_000, 1);
}
