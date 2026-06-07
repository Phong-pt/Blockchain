const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const RoyaltyNFT = await hre.ethers.getContractFactory("RoyaltyNFT");
  const nft = await RoyaltyNFT.deploy("Fractional Royalty NFT", "FRNFT", deployer.address);
  await nft.waitForDeployment();
  console.log("RoyaltyNFT:", await nft.getAddress());

  const Marketplace = await hre.ethers.getContractFactory("Marketplace");
  const market = await Marketplace.deploy(deployer.address, deployer.address);
  await market.waitForDeployment();
  console.log("Marketplace:", await market.getAddress());
  console.log("PullPaymentSplitter:", await market.splitter());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
