// SPDX-License-Identifier: GPL-3.0-only

module livestreak::treasury;

use livestreak::side;

public(package) fun mint_loss_lvst(
    _account: u256,
    _to: address,
    _vault_id: vector<u8>,
    side: u8,
): u256 {
    side::assert_valid(side);
    0
}
