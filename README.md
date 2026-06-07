# NFT Marketplace with Fractional Royalties

Bộ khung Solidity cho một digital asset marketplace tự động chia royalty tới nhiều
stakeholder ở mỗi lần giao dịch.

## Kiến trúc

```
contracts/
├── interfaces/
│   └── IMultiRoyalty.sol        # Mở rộng EIP-2981: nhiều receiver theo bps
├── RoyaltyNFT.sol               # ERC-721 + ERC2981 + IMultiRoyalty
├── PullPaymentSplitter.sol      # Claim-based splitter (ReentrancyGuard)
└── Marketplace.sol              # Atomic buy + royalty resolver
```

Các yêu cầu kỹ thuật của đề bài được thực hiện tương ứng:

| Yêu cầu                                                                           | Thực hiện                                                                                                         |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Advanced ERC-721 mở rộng EIP-2981 với mảng multi-receiver                         | `RoyaltyNFT` kế thừa `ERC721URIStorage` + `ERC2981` và implement `IMultiRoyalty`                                  |
| Payment Splitter theo "Pull-payment" (claim-based), chống Reentrancy và Out-of-Gas | `PullPaymentSplitter` dùng `ReentrancyGuard` + CEI, deposit chỉ ghi mapping, withdraw dùng `Address.sendValue`    |
| Atomic swap: chuyển NFT và chia tiền trong 1 tx                                   | `Marketplace.buy()` trong một tx duy nhất: deposit vào splitter và `safeTransferFrom` NFT; bất kỳ revert nào rollback cả giao dịch |

## Cài đặt

```bash
npm install
npx hardhat compile
npx hardhat test
```

## Biến môi trường

Copy `.env.example` thành `.env` và điền:

- `SEPOLIA_RPC_URL`
- `PRIVATE_KEY`
- `ETHERSCAN_API_KEY`

## Deploy local

```bash
npx hardhat node        # terminal 1
npm run deploy:local    # terminal 2
```

## Luồng hoạt động

1. **Mint**: owner gọi `RoyaltyNFT.mintWithRoyalties(to, uri, royaltyBps, shares[])`.
   `shares[]` là mảng `(receiver, shareBps)` với tổng `shareBps == 10000`.
2. **List**: seller `approve` NFT cho `Marketplace` rồi gọi `list(nft, tokenId, price)`.
3. **Buy (atomic)**: buyer gọi `buy(nft, tokenId)` với `msg.value == price`:
   - Marketplace tính: `fee` (bps), `royalty` (chia theo shares), `sellerProceeds`.
   - Gọi `splitter.deposit{value: price}(payees, amounts)` → ghi credit.
   - `safeTransferFrom` NFT từ seller sang buyer.
   - Nếu bất kỳ bước nào revert, toàn bộ tx rollback → đảm bảo atomic.
4. **Withdraw**: mỗi stakeholder tự gọi `splitter.withdraw()` để rút ETH đã được ghi credit.

## Bảo mật

- **Reentrancy**: `ReentrancyGuard` trên `buy`, `list`, `unlist`, `withdraw`, `withdrawFor`.
- **Out of Gas / DoS**: deposit chỉ ghi mapping (`O(n)` không external calls);
  từng stakeholder tự rút → một receiver lỗi không ảnh hưởng người khác.
- **Checks-Effects-Interactions**: listing bị xoá và credit được ghi trước khi
  `safeTransferFrom` NFT.
- **Dust làm tròn**: phần dư do chia bps được cộng vào receiver cuối cùng.

## TODO cho giai đoạn tiếp theo

- Hỗ trợ auction (English/Dutch).
- Listing bằng ERC-20 (ngoài ETH).
- Batch listing/buy.
- Off-chain signed orders (à la Seaport).
"# Blockchain" 
