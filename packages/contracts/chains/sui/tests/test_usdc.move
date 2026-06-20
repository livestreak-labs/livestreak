// SPDX-License-Identifier: MIT

#[test_only]
module livestreak::test_usdc;

use sui::coin::{Self, Coin, TreasuryCap};

public struct USDC has drop {}

public struct UsdcMintCap has key, store {
    id: UID,
    cap: TreasuryCap<USDC>,
}

public fun create_mint_cap(ctx: &mut TxContext): UsdcMintCap {
    let (cap, metadata) = coin::create_currency<USDC>(
        USDC {},
        6,
        b"Test USDC",
        b"tUSDC",
        b"",
        option::none(),
        ctx,
    );
    transfer::public_freeze_object(metadata);
    UsdcMintCap {
        id: object::new(ctx),
        cap,
    }
}

public fun mint(cap: &mut UsdcMintCap, amount: u64, ctx: &mut TxContext): Coin<USDC> {
    coin::mint(&mut cap.cap, amount, ctx)
}
