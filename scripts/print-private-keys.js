const { ethers } = require("ethers");

async function main() {
  const mnemonic = "test test test test test test test test test test test junk";
  const path = "m/44'/60'/0'/0/";
  
  for (let i = 0; i < 5; i++) {
    const wallet = ethers.HDNodeWallet.fromMnemonic(
      ethers.Mnemonic.fromPhrase(mnemonic),
      path + i
    );
    console.log(`Account #${i}: ${wallet.address}`);
    console.log(`Private Key: ${wallet.privateKey}`);
  }
}

main().catch(console.error);
