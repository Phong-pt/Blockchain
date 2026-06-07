const hre = require("hardhat");

async function main() {
  const [owner, addr1, addr2, addr3] = await hre.ethers.getSigners();
  console.log("Seeder:", owner.address);

  // Get deployed contracts
  const nftAddr = process.env.NFT_ADDRESS || "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  const marketAddr = process.env.MARKET_ADDRESS || "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";

  const nft = await hre.ethers.getContractAt("RoyaltyNFT", nftAddr);
  const market = await hre.ethers.getContractAt("Marketplace", marketAddr);

  console.log("\n--- Minting 3 demo NFTs ---\n");

  // NFT #1: Artist + Charity (70/30), royalty 5%
  const tx1 = await nft.mintWithRoyalties(
    owner.address,
    "https://raw.githubusercontent.com/example/nft-metadata/main/1.json",
    500, // 5%
    [
      { receiver: addr1.address, shareBps: 7000 },
      { receiver: addr2.address, shareBps: 3000 },
    ]
  );
  await tx1.wait();
  console.log("✅ NFT #1 minted → owner:", owner.address);
  console.log("   Royalty: 5%, Shares: addr1 70% + addr2 30%");

  // NFT #2: 3 receivers (50/30/20), royalty 10%
  const tx2 = await nft.mintWithRoyalties(
    owner.address,
    "https://raw.githubusercontent.com/example/nft-metadata/main/2.json",
    1000, // 10%
    [
      { receiver: addr1.address, shareBps: 5000 },
      { receiver: addr2.address, shareBps: 3000 },
      { receiver: addr3.address, shareBps: 2000 },
    ]
  );
  await tx2.wait();
  console.log("✅ NFT #2 minted → owner:", owner.address);
  console.log("   Royalty: 10%, Shares: addr1 50% + addr2 30% + addr3 20%");

  // NFT #3: Single receiver, royalty 3%
  const tx3 = await nft.mintWithRoyalties(
    addr1.address,
    "https://raw.githubusercontent.com/example/nft-metadata/main/3.json",
    300, // 3%
    [
      { receiver: owner.address, shareBps: 10000 },
    ]
  );
  await tx3.wait();
  console.log("✅ NFT #3 minted → addr1:", addr1.address);
  console.log("   Royalty: 3%, Shares: owner 100%");

  console.log("\n--- Listing NFT #1 and #2 on Marketplace ---\n");

  const marketAddress = await market.getAddress();
  const nftAddress = await nft.getAddress();

  // Approve + List NFT #1 at 0.5 ETH
  const listing1 = await market.getListing(nftAddress, 1);
  if (!listing1.active) {
    await (await nft.approve(marketAddress, 1)).wait();
    await (await market.list(nftAddress, 1, hre.ethers.parseEther("0.5"))).wait();
    console.log("📋 NFT #1 listed at 0.5 ETH");
  } else {
    console.log("📋 NFT #1 is already listed");
  }

  // Approve + List NFT #2 at 1 ETH
  const listing2 = await market.getListing(nftAddress, 2);
  if (!listing2.active) {
    await (await nft.approve(marketAddress, 2)).wait();
    await (await market.list(nftAddress, 2, hre.ethers.parseEther("1"))).wait();
    console.log("📋 NFT #2 listed at 1.0 ETH");
  } else {
    console.log("📋 NFT #2 is already listed");
  }

  console.log("\n✨ Seed complete! 3 NFTs minted, 2 listed.\n");
  console.log("Addresses:");
  console.log("  RoyaltyNFT:", nftAddress);
  console.log("  Marketplace:", marketAddress);
  console.log("  Splitter:", await market.splitter());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
