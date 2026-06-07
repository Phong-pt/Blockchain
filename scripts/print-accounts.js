const hre = require("hardhat");

async function main() {
  const signers = await hre.ethers.getSigners();
  for (let i = 0; i < 5; i++) {
    console.log(`Account #${i}: ${signers[i].address}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
