const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NFT Marketplace with Fractional Royalties", function () {
  async function deployFixture() {
    const [owner, seller, buyer, artist, charity, investor] = await ethers.getSigners();

    const RoyaltyNFT = await ethers.getContractFactory("RoyaltyNFT");
    const nft = await RoyaltyNFT.deploy("FRNFT", "FR", owner.address);

    const Marketplace = await ethers.getContractFactory("Marketplace");
    const market = await Marketplace.deploy(owner.address, owner.address);

    const splitterAddr = await market.splitter();
    const splitter = await ethers.getContractAt("PullPaymentSplitter", splitterAddr);

    // Mint cho seller: royalty 10%, chia 50/30/20 cho artist/charity/investor.
    const shares = [
      { receiver: artist.address, shareBps: 5000 },
      { receiver: charity.address, shareBps: 3000 },
      { receiver: investor.address, shareBps: 2000 },
    ];
    await nft.mintWithRoyalties(seller.address, "ipfs://token/1", 1000, shares);

    return { owner, seller, buyer, artist, charity, investor, nft, market, splitter };
  }

  it("mints NFT with multi-receiver royalty metadata", async function () {
    const { nft } = await deployFixture();
    const [total, shares] = await nft.royaltyShares(1, ethers.parseEther("1"));
    expect(total).to.equal(ethers.parseEther("0.1")); // 10%
    expect(shares.length).to.equal(3);
  });

  it("executes atomic sale: NFT moves, funds credited to splitter", async function () {
    const { seller, buyer, artist, charity, investor, nft, market, splitter, owner } =
      await deployFixture();

    const price = ethers.parseEther("1");
    await nft.connect(seller).approve(await market.getAddress(), 1);
    await market.connect(seller).list(await nft.getAddress(), 1, price);

    await expect(market.connect(buyer).buy(await nft.getAddress(), 1, { value: price }))
      .to.emit(market, "Sold");

    // NFT transferred.
    expect(await nft.ownerOf(1)).to.equal(buyer.address);

    // Tính: fee 2.5% = 0.025; royalty 10% = 0.1 chia 50/30/20
    // => artist 0.05, charity 0.03, investor 0.02
    // seller = 1 - 0.025 - 0.1 = 0.875
    expect(await splitter.balanceOf(artist.address)).to.equal(ethers.parseEther("0.05"));
    expect(await splitter.balanceOf(charity.address)).to.equal(ethers.parseEther("0.03"));
    expect(await splitter.balanceOf(investor.address)).to.equal(ethers.parseEther("0.02"));
    expect(await splitter.balanceOf(seller.address)).to.equal(ethers.parseEther("0.875"));
    expect(await splitter.balanceOf(owner.address)).to.equal(ethers.parseEther("0.025"));
  });

  it("allows each stakeholder to pull-payment independently", async function () {
    const { seller, buyer, artist, nft, market, splitter } = await deployFixture();

    const price = ethers.parseEther("1");
    await nft.connect(seller).approve(await market.getAddress(), 1);
    await market.connect(seller).list(await nft.getAddress(), 1, price);
    await market.connect(buyer).buy(await nft.getAddress(), 1, { value: price });

    const before = await ethers.provider.getBalance(artist.address);
    const tx = await splitter.connect(artist).withdraw();
    const rcpt = await tx.wait();
    const gas = rcpt.gasUsed * rcpt.gasPrice;
    const after = await ethers.provider.getBalance(artist.address);
    expect(after - before + gas).to.equal(ethers.parseEther("0.05"));
  });

  it("reverts atomically when payment is incorrect", async function () {
    const { seller, buyer, nft, market } = await deployFixture();
    const price = ethers.parseEther("1");
    await nft.connect(seller).approve(await market.getAddress(), 1);
    await market.connect(seller).list(await nft.getAddress(), 1, price);

    await expect(
      market.connect(buyer).buy(await nft.getAddress(), 1, { value: ethers.parseEther("0.5") })
    ).to.be.revertedWithCustomError(market, "IncorrectPayment");
  });
});
