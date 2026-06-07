// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IMultiRoyalty} from "./interfaces/IMultiRoyalty.sol";
import {PullPaymentSplitter} from "./PullPaymentSplitter.sol";

/**
 * @title Marketplace
 * @notice Digital asset marketplace với tính năng:
 *   1. Listing NFT theo giá cố định (fixed-price).
 *   2. Atomic swap: trong cùng 1 tx `buy()`:
 *        - Transfer ETH tới splitter (ghi credit cho seller + tất cả
 *          royalty receivers).
 *        - Transfer NFT từ seller -> buyer.
 *        Nếu bất kỳ bước nào revert, toàn bộ tx revert => atomic.
 *   3. Royalty chia tới nhiều người theo `IMultiRoyalty` (nếu NFT hỗ trợ),
 *      fallback về EIP-2981 chuẩn 1 receiver.
 *   4. Payment theo pull-payment pattern: tất cả tiền ghi credit trong
 *      `PullPaymentSplitter`; người nhận tự withdraw sau.
 *
 * Bảo mật:
 *   - ReentrancyGuard trên mọi hàm mutate ngoài.
 *   - Checks-Effects-Interactions: xoá listing trước khi external calls.
 *   - Không dùng vòng lặp `.call` trong `buy()` -> tránh "Out of Gas"
 *     và DoS bởi receiver độc hại.
 */
contract Marketplace is ReentrancyGuard, Ownable {
    struct Listing {
        address seller;
        uint256 price; // wei
        bool active;
    }

    PullPaymentSplitter public immutable splitter;

    // Phí marketplace (bps), mặc định 250 = 2.5%.
    uint96 public marketplaceFeeBps = 250;
    uint96 public constant BPS = 10_000;
    address public feeRecipient;

    // nftContract => tokenId => Listing
    mapping(address => mapping(uint256 => Listing)) private _listings;

    event Listed(
        address indexed nft,
        uint256 indexed tokenId,
        address indexed seller,
        uint256 price
    );
    event Unlisted(address indexed nft, uint256 indexed tokenId, address indexed seller);
    event Sold(
        address indexed nft,
        uint256 indexed tokenId,
        address indexed buyer,
        address seller,
        uint256 price,
        uint256 royaltyPaid,
        uint256 feePaid,
        uint256 sellerProceeds
    );
    event MarketplaceFeeUpdated(uint96 newBps, address newRecipient);

    error NotOwner();
    error NotApproved();
    error PriceZero();
    error NotListed();
    error AlreadyListed();
    error IncorrectPayment(uint256 expected, uint256 actual);
    error FeeTooHigh(uint96 bps);
    error CannotBuyOwn();

    constructor(address owner_, address feeRecipient_) Ownable(owner_) {
        require(feeRecipient_ != address(0), "fee recipient 0");
        feeRecipient = feeRecipient_;
        splitter = new PullPaymentSplitter();
    }

    // ---------- Admin ----------

    function setMarketplaceFee(uint96 newBps, address newRecipient) external onlyOwner {
        if (newBps > 1_000) revert FeeTooHigh(newBps); // tối đa 10%
        require(newRecipient != address(0), "fee recipient 0");
        marketplaceFeeBps = newBps;
        feeRecipient = newRecipient;
        emit MarketplaceFeeUpdated(newBps, newRecipient);
    }

    // ---------- Listing ----------

    function list(address nft, uint256 tokenId, uint256 price) external nonReentrant {
        if (price == 0) revert PriceZero();

        IERC721 token = IERC721(nft);
        if (token.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (
            token.getApproved(tokenId) != address(this) &&
            !token.isApprovedForAll(msg.sender, address(this))
        ) revert NotApproved();

        Listing storage l = _listings[nft][tokenId];
        if (l.active) revert AlreadyListed();

        _listings[nft][tokenId] = Listing({seller: msg.sender, price: price, active: true});
        emit Listed(nft, tokenId, msg.sender, price);
    }

    function unlist(address nft, uint256 tokenId) external nonReentrant {
        Listing memory l = _listings[nft][tokenId];
        if (!l.active) revert NotListed();
        if (l.seller != msg.sender) revert NotOwner();

        delete _listings[nft][tokenId];
        emit Unlisted(nft, tokenId, msg.sender);
    }

    function getListing(address nft, uint256 tokenId) external view returns (Listing memory) {
        return _listings[nft][tokenId];
    }

    // ---------- Buy (atomic) ----------

    /**
     * @notice Mua NFT đang list. Trong 1 tx duy nhất:
     *   - Ghi credit vào splitter: (royalty receivers), feeRecipient, seller.
     *   - Chuyển NFT từ seller sang buyer.
     *   - Revert ở bất kỳ bước nào => toàn bộ tx revert => tính atomic.
     */
    function buy(address nft, uint256 tokenId) external payable nonReentrant {
        Listing memory l = _listings[nft][tokenId];
        if (!l.active) revert NotListed();
        if (msg.value != l.price) revert IncorrectPayment(l.price, msg.value);
        if (msg.sender == l.seller) revert CannotBuyOwn();

        // Effects: xoá listing trước khi interactions.
        delete _listings[nft][tokenId];

        // ---- Tính toán phân chia tiền ----
        uint256 price = l.price;
        uint256 fee = (price * marketplaceFeeBps) / BPS;

        (uint256 totalRoyalty, address[] memory rcv, uint256[] memory amt) =
            _computeRoyalty(nft, tokenId, price);

        uint256 proceeds = price - fee - totalRoyalty;

        // ---- Gom thành 1 mảng duy nhất để deposit vào splitter ----
        // payees = royaltyReceivers ++ [feeRecipient, seller]
        uint256 n = rcv.length;
        address[] memory payees = new address[](n + 2);
        uint256[] memory amounts = new uint256[](n + 2);
        for (uint256 i = 0; i < n; ++i) {
            payees[i] = rcv[i];
            amounts[i] = amt[i];
        }
        payees[n] = feeRecipient;
        amounts[n] = fee;
        payees[n + 1] = l.seller;
        amounts[n + 1] = proceeds;

        // Interactions 1/2: deposit ETH vào splitter (credit, không send).
        splitter.deposit{value: price}(payees, amounts);

        // Interactions 2/2: transfer NFT. Nếu revert, toàn bộ tx revert => atomic.
        IERC721(nft).safeTransferFrom(l.seller, msg.sender, tokenId);

        emit Sold(nft, tokenId, msg.sender, l.seller, price, totalRoyalty, fee, proceeds);
    }

    // ---------- Royalty resolver ----------

    /**
     * @dev Ưu tiên `IMultiRoyalty` (multi-receiver). Nếu NFT không hỗ trợ,
     *      fallback `IERC2981.royaltyInfo` (1 receiver).
     */
    function _computeRoyalty(address nft, uint256 tokenId, uint256 salePrice)
        internal
        view
        returns (uint256 totalRoyalty, address[] memory receivers, uint256[] memory amounts)
    {
        // 1) Thử IMultiRoyalty
        try IERC165(nft).supportsInterface(type(IMultiRoyalty).interfaceId) returns (bool ok) {
            if (ok) {
                (uint256 total, IMultiRoyalty.RoyaltyShare[] memory shares) =
                    IMultiRoyalty(nft).royaltyShares(tokenId, salePrice);

                uint256 n = shares.length;
                receivers = new address[](n);
                amounts = new uint256[](n);

                uint256 distributed;
                for (uint256 i = 0; i < n; ++i) {
                    receivers[i] = shares[i].receiver;
                    uint256 part = (total * shares[i].shareBps) / 10_000;
                    amounts[i] = part;
                    distributed += part;
                }
                // Nếu có dust do làm tròn, cộng vào receiver cuối.
                if (n > 0 && distributed < total) {
                    amounts[n - 1] += (total - distributed);
                    distributed = total;
                }
                return (distributed, receivers, amounts);
            }
        } catch {}

        // 2) Fallback EIP-2981
        try IERC165(nft).supportsInterface(type(IERC2981).interfaceId) returns (bool ok) {
            if (ok) {
                (address r, uint256 amt) = IERC2981(nft).royaltyInfo(tokenId, salePrice);
                if (r != address(0) && amt > 0) {
                    receivers = new address[](1);
                    amounts = new uint256[](1);
                    receivers[0] = r;
                    amounts[0] = amt;
                    return (amt, receivers, amounts);
                }
            }
        } catch {}

        // 3) Không có royalty
        receivers = new address[](0);
        amounts = new uint256[](0);
        return (0, receivers, amounts);
    }
}
