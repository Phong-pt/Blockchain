// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IMultiRoyalty
 * @notice Mở rộng EIP-2981 để trả về nhiều người thụ hưởng cho một NFT.
 *         EIP-2981 chuẩn chỉ hỗ trợ 1 receiver, giao diện này cho phép
 *         split tiền royalty tới N stakeholder theo basis points (bps).
 */
interface IMultiRoyalty {
    struct RoyaltyShare {
        address receiver;
        uint96 shareBps; // basis points (1% = 100 bps). Tổng các share = 10000.
    }

    /**
     * @notice Lấy danh sách người nhận royalty và tổng tỉ lệ royalty trên giá bán.
     * @param tokenId       Id của NFT.
     * @param salePrice     Giá bán.
     * @return totalAmount  Tổng royalty (wei) phải trích từ salePrice.
     * @return shares       Danh sách (receiver, shareBps) dùng để chia totalAmount.
     */
    function royaltyShares(uint256 tokenId, uint256 salePrice)
        external
        view
        returns (uint256 totalAmount, RoyaltyShare[] memory shares);
}
