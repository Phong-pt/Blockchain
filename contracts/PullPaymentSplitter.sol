// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/**
 * @title PullPaymentSplitter
 * @notice Lưu số dư (credit) cho từng người thụ hưởng theo mô hình
 *         "pull-payment" / claim-based. Người nhận tự gọi `withdraw()` để
 *         rút tiền. Nhờ vậy một receiver lỗi (revert / hết gas) sẽ KHÔNG
 *         làm thất bại toàn bộ giao dịch bán/chuyển NFT.
 *
 * Thuộc tính an toàn:
 *  - Checks-Effects-Interactions + ReentrancyGuard => chống reentrancy.
 *  - Vòng lặp deposit chỉ ghi mapping => không có "Out of Gas" khi
 *    danh sách receiver lớn (gas O(n) nhưng không call external).
 *  - Address.sendValue dùng call{value: ...} với toàn bộ gas còn lại,
 *    tương thích với smart-contract wallets.
 */
contract PullPaymentSplitter is ReentrancyGuard {
    mapping(address account => uint256 amount) private _balances;
    uint256 private _totalPending;

    event PaymentDeposited(address indexed payee, uint256 amount, address indexed from);
    event PaymentWithdrawn(address indexed payee, uint256 amount);

    error NothingToWithdraw();
    error AmountMismatch(uint256 expected, uint256 actual);
    error ZeroPayee();

    /**
     * @notice Gửi ETH và chia đều theo mảng (payee, amount) cho trước.
     *         Tổng `amounts` phải đúng bằng `msg.value`.
     * @param payees    Danh sách địa chỉ nhận.
     * @param amounts   Số wei cấp cho từng địa chỉ (cùng độ dài).
     */
    function deposit(address[] calldata payees, uint256[] calldata amounts)
        external
        payable
    {
        require(payees.length == amounts.length, "length mismatch");

        uint256 total;
        for (uint256 i = 0; i < payees.length; ++i) {
            address payee = payees[i];
            if (payee == address(0)) revert ZeroPayee();
            uint256 amt = amounts[i];
            _balances[payee] += amt;
            total += amt;
            emit PaymentDeposited(payee, amt, msg.sender);
        }

        if (total != msg.value) revert AmountMismatch(total, msg.value);
        _totalPending += total;
    }

    /// @notice Rút toàn bộ số dư của `msg.sender`.
    function withdraw() external nonReentrant {
        _withdrawTo(payable(msg.sender));
    }

    /// @notice Bất kỳ ai cũng có thể "push" tiền cho `payee` (ví dụ bot).
    function withdrawFor(address payable payee) external nonReentrant {
        _withdrawTo(payee);
    }

    function _withdrawTo(address payable payee) internal {
        uint256 amount = _balances[payee];
        if (amount == 0) revert NothingToWithdraw();

        _balances[payee] = 0;
        _totalPending -= amount;

        emit PaymentWithdrawn(payee, amount);
        Address.sendValue(payee, amount);
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function totalPending() external view returns (uint256) {
        return _totalPending;
    }
}
