// SPDX-License-Identifier: MIT

module livestreak::lvst;

use sui::coin::{Self, TreasuryCap};

public struct LVST has drop {}

public struct LvstTreasuryCap has key {
    id: UID,
    cap: TreasuryCap<LVST>,
}

fun init(otw: LVST, ctx: &mut TxContext) {
    let (treasury_cap, metadata) = coin::create_currency<LVST>(
        otw,
        9,
        b"LiveStreak",
        b"LVST",
        b"",
        option::none(),
        ctx,
    );
    transfer::public_freeze_object(metadata);
    let wrapper = LvstTreasuryCap {
        id: object::new(ctx),
        cap: treasury_cap,
    };
    transfer::share_object(wrapper);
}

public fun mint(cap: &mut LvstTreasuryCap, amount: u64, recipient: address, ctx: &mut TxContext) {
    coin::mint_and_transfer(&mut cap.cap, amount, recipient, ctx);
}

public fun pull_from(_cap: &mut LvstTreasuryCap, _from: address, _amount: u64, _ctx: &mut TxContext) {
    // Staking uses Coin<LVST> passed into treasury::stake_lvst instead of allowance pulls.
}
