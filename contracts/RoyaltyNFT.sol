// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import {IMultiRoyalty} from "./interfaces/IMultiRoyalty.sol";

/**
 * @title RoyaltyNFT
 * @notice ERC-721 mở rộng EIP-2981 (royaltyInfo) cùng với chuẩn mở rộng
 *         IMultiRoyalty cho phép nhiều stakeholder cùng nhận royalty.
 *
 *         - royaltyInfo() trả về receiver = address(this) (hoặc splitter)
 *           để tương thích với các marketplace hỗ trợ EIP-2981.
 *         - royaltyShares() trả về mảng (receiver, bps) để marketplace
 *           của chúng ta có thể trả thẳng tới từng người.
 */
contract RoyaltyNFT is ERC721URIStorage, ERC2981, Ownable, IMultiRoyalty {
    uint96 public constant BPS_DENOMINATOR = 10_000;
    uint96 public constant MAX_ROYALTY_BPS = 1_000; // tối đa 10%

    uint256 private _nextTokenId;

    mapping(uint256 tokenId => RoyaltyShare[]) private _royaltyShares;
    mapping(uint256 tokenId => uint96) private _royaltyBps;

    event RoyaltySharesSet(uint256 indexed tokenId, uint96 royaltyBps, RoyaltyShare[] shares);

    error InvalidShareTotal(uint256 totalBps);
    error RoyaltyTooHigh(uint96 royaltyBps);
    error EmptyShares();
    error ZeroReceiver();
    error TokenDoesNotExist(uint256 tokenId);

    constructor(string memory name_, string memory symbol_, address owner_)
        ERC721(name_, symbol_)
        Ownable(owner_)
    {}

    /**
     * @notice Mint NFT với nhiều royalty receiver.
     * @param to           Người được mint.
     * @param tokenURI_    URI metadata.
     * @param royaltyBps   Tỉ lệ royalty trên giá bán (<= MAX_ROYALTY_BPS).
     * @param shares       Danh sách (receiver, shareBps) - tổng shareBps phải = 10000.
     */
    function mintWithRoyalties(
        address to,
        string calldata tokenURI_,
        uint96 royaltyBps,
        RoyaltyShare[] calldata shares
    ) external onlyOwner returns (uint256 tokenId) {
        if (royaltyBps > MAX_ROYALTY_BPS) revert RoyaltyTooHigh(royaltyBps);
        if (shares.length == 0) revert EmptyShares();

        tokenId = ++_nextTokenId;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, tokenURI_);

        _setRoyaltyShares(tokenId, royaltyBps, shares);

        // Đặt default royaltyInfo về chính contract để tương thích với
        // các marketplace EIP-2981 (tiền sẽ đi qua contract rồi chia).
        _setTokenRoyalty(tokenId, address(this), royaltyBps);
    }

    function _setRoyaltyShares(uint256 tokenId, uint96 royaltyBps, RoyaltyShare[] calldata shares) internal {
        delete _royaltyShares[tokenId];

        uint256 totalBps;
        for (uint256 i = 0; i < shares.length; ++i) {
            if (shares[i].receiver == address(0)) revert ZeroReceiver();
            totalBps += shares[i].shareBps;
            _royaltyShares[tokenId].push(shares[i]);
        }
        if (totalBps != BPS_DENOMINATOR) revert InvalidShareTotal(totalBps);

        _royaltyBps[tokenId] = royaltyBps;

        emit RoyaltySharesSet(tokenId, royaltyBps, shares);
    }

    /// @inheritdoc IMultiRoyalty
    function royaltyShares(uint256 tokenId, uint256 salePrice)
        external
        view
        override
        returns (uint256 totalAmount, RoyaltyShare[] memory shares)
    {
        _requireOwned(tokenId);
        shares = _royaltyShares[tokenId];
        totalAmount = (salePrice * _royaltyBps[tokenId]) / BPS_DENOMINATOR;
    }

    function getRoyaltyBps(uint256 tokenId) external view returns (uint96) {
        _requireOwned(tokenId);
        return _royaltyBps[tokenId];
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721URIStorage, ERC2981)
        returns (bool)
    {
        return
            interfaceId == type(IMultiRoyalty).interfaceId ||
            super.supportsInterface(interfaceId);
    }
}
