/* ============================================================
   FRNFT — NFT Marketplace with Fractional Royalties
   Pure Vanilla JS + ethers.js v6
   ============================================================ */

// ─── Contract ABIs (minimal) ────────────────────────────────
const ROYALTY_NFT_ABI = [
  "constructor(string name_, string symbol_, address owner_)",
  "function mintWithRoyalties(address to, string tokenURI_, uint96 royaltyBps, tuple(address receiver, uint96 shareBps)[] shares) returns (uint256 tokenId)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function balanceOf(address owner) view returns (uint256)",
  "function getRoyaltyBps(uint256 tokenId) view returns (uint96)",
  "function royaltyShares(uint256 tokenId, uint256 salePrice) view returns (uint256 totalAmount, tuple(address receiver, uint96 shareBps)[] shares)",
  "function approve(address to, uint256 tokenId)",
  "function getApproved(uint256 tokenId) view returns (address)",
  "function setApprovalForAll(address operator, bool approved)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function owner() view returns (address)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "event RoyaltySharesSet(uint256 indexed tokenId, uint96 royaltyBps, tuple(address receiver, uint96 shareBps)[] shares)"
];

const MARKETPLACE_ABI = [
  "function list(address nft, uint256 tokenId, uint256 price)",
  "function unlist(address nft, uint256 tokenId)",
  "function buy(address nft, uint256 tokenId) payable",
  "function getListing(address nft, uint256 tokenId) view returns (tuple(address seller, uint256 price, bool active))",
  "function splitter() view returns (address)",
  "function marketplaceFeeBps() view returns (uint96)",
  "function feeRecipient() view returns (address)",
  "event Listed(address indexed nft, uint256 indexed tokenId, address indexed seller, uint256 price)",
  "event Unlisted(address indexed nft, uint256 indexed tokenId, address indexed seller)",
  "event Sold(address indexed nft, uint256 indexed tokenId, address indexed buyer, address seller, uint256 price, uint256 royaltyPaid, uint256 feePaid, uint256 sellerProceeds)"
];

const SPLITTER_ABI = [
  "function withdraw()",
  "function withdrawFor(address payable payee)",
  "function balanceOf(address account) view returns (uint256)",
  "function totalPending() view returns (uint256)",
  "event PaymentDeposited(address indexed payee, uint256 amount, address indexed from)",
  "event PaymentWithdrawn(address indexed payee, uint256 amount)"
];

// ─── State ──────────────────────────────────────────────────
let provider = null;
let signer = null;
let currentAccount = null;

let nftContract = null;
let marketContract = null;
let splitterContract = null;

// Auto-detected or manual addresses
let NFT_ADDRESS = "";
let MARKETPLACE_ADDRESS = "";
let SPLITTER_ADDRESS = "";

// Cache discovered tokens
let discoveredTokens = [];
let currentDetailToken = null;
let listingTokenId = null;

// ─── Config ─────────────────────────────────────────────────
const LOCALHOST_RPC = "http://127.0.0.1:8545";
const CHAIN_ID_LOCALHOST = 31337;

// ─── Helpers ────────────────────────────────────────────────
function shortAddr(addr) {
  if (!addr) return "—";
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function weiToEth(wei) {
  return parseFloat(ethers.formatEther(wei));
}

function bpsToPercent(bps) {
  return (Number(bps) / 100).toFixed(1) + "%";
}

// ─── Toast ──────────────────────────────────────────────────
function showToast(type, title, message) {
  const icons = { success: "✅", error: "❌", info: "ℹ️", warning: "⚠️" };
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || "ℹ️"}</span>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("removing");
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

// ─── Page Navigation ────────────────────────────────────────
document.querySelectorAll("[data-page]").forEach(link => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    const pageId = link.dataset.page;
    switchPage(pageId);
  });
});

function switchPage(pageId) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll("[data-page]").forEach(l => l.classList.remove("active"));

  const page = document.getElementById(`page-${pageId}`);
  const link = document.querySelector(`[data-page="${pageId}"]`);
  if (page) page.classList.add("active");
  if (link) link.classList.add("active");

  // Refresh data when switching pages
  if (pageId === "marketplace") refreshMarketplace();
  if (pageId === "my-nfts") refreshMyNFTs();
  if (pageId === "withdraw") refreshWithdrawBalance();
}

// ─── Wallet Connection ──────────────────────────────────────
async function connectWallet() {
  try {
    if (!window.ethereum) {
      // Fallback to localhost JSON-RPC
      showToast("info", "No MetaMask", "Connecting to localhost:8545...");
      provider = new ethers.JsonRpcProvider(LOCALHOST_RPC);
      const accounts = await provider.listAccounts();
      if (accounts.length === 0) {
        showToast("error", "No Accounts", "Start Hardhat node: npx hardhat node");
        return;
      }
      signer = accounts[0];
      currentAccount = await signer.getAddress();
    } else {
      provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      signer = await provider.getSigner();
      currentAccount = await signer.getAddress();
    }

    updateWalletUI(currentAccount);
    await initContracts();
    showToast("success", "Wallet Connected", shortAddr(currentAccount));
  } catch (err) {
    console.error(err);
    showToast("error", "Connection Failed", err.message || "Could not connect wallet.");
  }
}

function updateWalletUI(addr) {
  const btn = document.getElementById("btn-connect-wallet");
  const label = document.getElementById("wallet-label");
  btn.classList.add("connected");
  label.textContent = shortAddr(addr);

  // Pre-fill mint-to
  const mintTo = document.getElementById("mint-to");
  if (mintTo && !mintTo.value) mintTo.placeholder = addr;
}

// ─── Contract Init ──────────────────────────────────────────
async function initContracts() {
  // Try to auto-detect deployed addresses from deploy artifacts
  const detected = await detectDeployedAddresses();
  if (!detected) {
    showToast("warning", "No Contracts", "Deploy contracts first: npm run deploy:local");
    return;
  }

  nftContract = new ethers.Contract(NFT_ADDRESS, ROYALTY_NFT_ABI, signer);
  marketContract = new ethers.Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, signer);

  // Get splitter address
  try {
    SPLITTER_ADDRESS = await marketContract.splitter();
    splitterContract = new ethers.Contract(SPLITTER_ADDRESS, SPLITTER_ABI, signer);
  } catch (e) {
    console.error("Failed to get splitter:", e);
  }

  // Update stats
  await updateStats();
  // Load pages
  await refreshMarketplace();

  // Show network
  try {
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);
    const names = { 31337: "Localhost", 11155111: "Sepolia", 1: "Mainnet" };
    document.getElementById("stat-network").textContent = names[chainId] || `Chain ${chainId}`;
    document.getElementById("network-name").textContent = names[chainId] || `Chain ${chainId}`;
    document.getElementById("network-badge").style.display = "inline-flex";
  } catch (_) {}

  // Setup event listeners
  setupEventListeners();
}

async function detectDeployedAddresses() {
  // First check if addresses are already set (user can set them manually)
  if (NFT_ADDRESS && MARKETPLACE_ADDRESS) return true;

  // Try to prompt or auto-detect by scanning recent deploy events
  // For local dev, we attempt to read from well-known addresses or events
  try {
    // We'll scan the blockchain for contract creation from the deployer
    const latest = await provider.getBlockNumber();
    const startBlock = Math.max(0, latest - 1000);

    // Look for Listed events or try common deployment patterns
    // For now, let user input via prompt or scan for contracts
    const deployerAddr = currentAccount;

    // Scan blocks for contract creation
    for (let b = startBlock; b <= latest; b++) {
      const block = await provider.getBlock(b, true);
      if (!block || !block.prefetchedTransactions) continue;
      for (const tx of block.prefetchedTransactions) {
        if (tx.to === null && tx.from.toLowerCase() === deployerAddr.toLowerCase()) {
          const receipt = await provider.getTransactionReceipt(tx.hash);
          if (receipt && receipt.contractAddress) {
            // Check if it's our NFT contract
            const code = await provider.getCode(receipt.contractAddress);
            if (code.length > 100) {
              try {
                const testContract = new ethers.Contract(receipt.contractAddress, ROYALTY_NFT_ABI, provider);
                const name = await testContract.name();
                if (name === "Fractional Royalty NFT") {
                  NFT_ADDRESS = receipt.contractAddress;
                  continue;
                }
              } catch (_) {}

              try {
                const testContract = new ethers.Contract(receipt.contractAddress, MARKETPLACE_ABI, provider);
                await testContract.splitter();
                MARKETPLACE_ADDRESS = receipt.contractAddress;
                continue;
              } catch (_) {}
            }
          }
        }
      }
    }

    if (NFT_ADDRESS && MARKETPLACE_ADDRESS) {
      showToast("success", "Contracts Detected", `NFT: ${shortAddr(NFT_ADDRESS)} | Market: ${shortAddr(MARKETPLACE_ADDRESS)}`);
      return true;
    }

    // If not found, try manual entry
    const nftAddr = prompt("Enter RoyaltyNFT contract address:", "");
    const marketAddr = prompt("Enter Marketplace contract address:", "");
    if (nftAddr && marketAddr) {
      NFT_ADDRESS = nftAddr;
      MARKETPLACE_ADDRESS = marketAddr;
      return true;
    }

    return false;
  } catch (e) {
    console.error("detectDeployedAddresses error:", e);
    // Fallback to manual
    const nftAddr = prompt("Enter RoyaltyNFT contract address:");
    const marketAddr = prompt("Enter Marketplace contract address:");
    if (nftAddr && marketAddr) {
      NFT_ADDRESS = nftAddr;
      MARKETPLACE_ADDRESS = marketAddr;
      return true;
    }
    return false;
  }
}

// ─── Event Listeners ────────────────────────────────────────
function setupEventListeners() {
  if (!nftContract || !marketContract) return;

  // Listen for new mints (Transfer from 0x0)
  nftContract.on("Transfer", (from, to, tokenId) => {
    if (from === ethers.ZeroAddress) {
      showToast("success", "NFT Minted!", `Token #${tokenId} minted to ${shortAddr(to)}`);
      discoverToken(Number(tokenId));
    }
  });

  // Listed
  marketContract.on("Listed", (nft, tokenId, seller, price) => {
    showToast("info", "NFT Listed", `Token #${tokenId} listed for ${ethers.formatEther(price)} ETH`);
    refreshMarketplace();
  });

  // Sold
  marketContract.on("Sold", (nft, tokenId, buyer, seller, price) => {
    showToast("success", "NFT Sold!", `Token #${tokenId} sold for ${ethers.formatEther(price)} ETH`);
    refreshMarketplace();
    refreshMyNFTs();
    refreshWithdrawBalance();
  });

  // MetaMask account changes
  if (window.ethereum) {
    window.ethereum.on("accountsChanged", (accounts) => {
      if (accounts.length === 0) {
        currentAccount = null;
        document.getElementById("btn-connect-wallet").classList.remove("connected");
        document.getElementById("wallet-label").textContent = "Connect Wallet";
      } else {
        window.location.reload();
      }
    });
  }
}

// ─── Stats ──────────────────────────────────────────────────
async function updateStats() {
  try {
    const feeBps = await marketContract.marketplaceFeeBps();
    document.getElementById("stat-fee").textContent = bpsToPercent(feeBps);
  } catch (_) {}

  document.getElementById("stat-total-nfts").textContent = discoveredTokens.length.toString();
}

// ─── Token Discovery ───────────────────────────────────────
async function discoverAllTokens() {
  if (!nftContract) return;

  discoveredTokens = [];

  try {
    // Scan Transfer events from zero address (mints)
    const filter = nftContract.filters.Transfer(ethers.ZeroAddress);
    const events = await nftContract.queryFilter(filter, 0, "latest");

    for (const ev of events) {
      const tokenId = Number(ev.args.tokenId);
      if (!discoveredTokens.includes(tokenId)) {
        discoveredTokens.push(tokenId);
      }
    }
  } catch (e) {
    console.error("discoverAllTokens error:", e);
    // Fallback: try sequential ids
    for (let i = 1; i <= 100; i++) {
      try {
        await nftContract.ownerOf(i);
        if (!discoveredTokens.includes(i)) discoveredTokens.push(i);
      } catch (_) {
        break;
      }
    }
  }

  document.getElementById("stat-total-nfts").textContent = discoveredTokens.length.toString();
}

function discoverToken(tokenId) {
  if (!discoveredTokens.includes(tokenId)) {
    discoveredTokens.push(tokenId);
    discoveredTokens.sort((a, b) => a - b);
    document.getElementById("stat-total-nfts").textContent = discoveredTokens.length.toString();
  }
}

// ─── Token Data ─────────────────────────────────────────────
async function getTokenData(tokenId) {
  const data = {
    tokenId,
    owner: null,
    tokenURI: "",
    royaltyBps: 0,
    royaltyShares: [],
    listing: null,
    metadata: null
  };

  try {
    data.owner = await nftContract.ownerOf(tokenId);
  } catch (_) { return null; }

  try { data.tokenURI = await nftContract.tokenURI(tokenId); } catch (_) {}
  try { data.royaltyBps = Number(await nftContract.getRoyaltyBps(tokenId)); } catch (_) {}

  try {
    const [totalAmt, shares] = await nftContract.royaltyShares(tokenId, ethers.parseEther("1"));
    data.royaltyShares = shares.map(s => ({
      receiver: s.receiver,
      shareBps: Number(s.shareBps)
    }));
  } catch (_) {}

  try {
    const listing = await marketContract.getListing(NFT_ADDRESS, tokenId);
    if (listing.active) {
      data.listing = {
        seller: listing.seller,
        price: listing.price,
        active: true
      };
    }
  } catch (_) {}

  // Try to fetch metadata
  try {
    if (data.tokenURI) {
      let url = data.tokenURI;
      if (url.startsWith("ipfs://")) {
        url = "https://ipfs.io/ipfs/" + url.slice(7);
      }
      const resp = await fetch(url);
      if (resp.ok) {
        data.metadata = await resp.json();
      }
    }
  } catch (_) {}

  return data;
}

// ─── Render Helpers ─────────────────────────────────────────
function generateNFTColor(tokenId) {
  const hue = (tokenId * 137) % 360;
  return `hsl(${hue}, 60%, 25%)`;
}

function renderNFTCard(data, context = "marketplace") {
  const card = document.createElement("div");
  card.className = "nft-card";
  card.onclick = () => openDetailModal(data.tokenId);

  const imageHTML = data.metadata && data.metadata.image
    ? `<img src="${data.metadata.image.startsWith('ipfs://') ? 'https://ipfs.io/ipfs/' + data.metadata.image.slice(7) : data.metadata.image}" alt="NFT #${data.tokenId}" loading="lazy" />`
    : `<div class="nft-placeholder" style="background: linear-gradient(135deg, ${generateNFTColor(data.tokenId)}, ${generateNFTColor(data.tokenId + 50)});">
         <span style="font-size:2.5rem;">🎨</span>
       </div>`;

  const name = data.metadata?.name || `NFT #${data.tokenId}`;
  const desc = data.metadata?.description || `Token ID: ${data.tokenId}`;
  const isOwner = currentAccount && data.owner?.toLowerCase() === currentAccount.toLowerCase();

  let badge = "";
  if (data.listing?.active) {
    badge = `<div class="card-badge listed">Listed</div>`;
  } else if (isOwner) {
    badge = `<div class="card-badge owned">Owned</div>`;
  }

  let priceHTML = "";
  if (data.listing?.active) {
    priceHTML = `<span class="eth-icon">Ξ</span>${weiToEth(data.listing.price).toFixed(4)}`;
  } else {
    priceHTML = `<span style="color: var(--text-muted)">Not listed</span>`;
  }

  card.innerHTML = `
    <div class="card-image">
      ${imageHTML}
      ${badge}
    </div>
    <div class="card-body">
      <div class="card-title">${name}</div>
      <div class="card-subtitle">${shortAddr(data.owner)}</div>
      <div class="card-footer">
        <div class="card-price">${priceHTML}</div>
        <div class="card-royalty">
          <span class="royalty-dot"></span>
          ${bpsToPercent(data.royaltyBps)} royalty
        </div>
      </div>
    </div>
  `;

  return card;
}

// ─── Marketplace ────────────────────────────────────────────
async function refreshMarketplace() {
  if (!nftContract || !marketContract) return;

  const grid = document.getElementById("marketplace-grid");
  grid.innerHTML = `<div class="empty-state"><div class="spinner" style="margin:0 auto;"></div><p class="mt-md">Loading marketplace...</p></div>`;

  await discoverAllTokens();

  const cards = [];
  let listedCount = 0;

  for (const tokenId of discoveredTokens) {
    const data = await getTokenData(tokenId);
    if (!data) continue;
    if (data.listing?.active) {
      listedCount++;
      cards.push(renderNFTCard(data, "marketplace"));
    }
  }

  document.getElementById("stat-listed").textContent = listedCount.toString();

  grid.innerHTML = "";
  if (cards.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🏪</div>
        <h3>No NFTs listed</h3>
        <p>Be the first to list your NFT for sale!</p>
      </div>
    `;
  } else {
    cards.forEach(c => grid.appendChild(c));
  }
}

// ─── My NFTs ────────────────────────────────────────────────
async function refreshMyNFTs() {
  if (!nftContract || !currentAccount) return;

  const grid = document.getElementById("my-nfts-grid");
  grid.innerHTML = `<div class="empty-state"><div class="spinner" style="margin:0 auto;"></div><p class="mt-md">Loading your NFTs...</p></div>`;

  await discoverAllTokens();

  const cards = [];
  for (const tokenId of discoveredTokens) {
    const data = await getTokenData(tokenId);
    if (!data) continue;
    if (data.owner.toLowerCase() === currentAccount.toLowerCase()) {
      cards.push(renderNFTCard(data, "my-nfts"));
    }
  }

  grid.innerHTML = "";
  if (cards.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎨</div>
        <h3>No NFTs found</h3>
        <p>Mint your first NFT to get started!</p>
      </div>
    `;
  } else {
    cards.forEach(c => grid.appendChild(c));
  }
}

// ─── Detail Modal ───────────────────────────────────────────
async function openDetailModal(tokenId) {
  const overlay = document.getElementById("modal-detail");
  const content = document.getElementById("detail-content");

  overlay.classList.add("active");
  content.innerHTML = `<div class="empty-state" style="grid-column: 1/-1;"><div class="spinner" style="margin:0 auto;"></div><p class="mt-md">Loading...</p></div>`;

  const data = await getTokenData(tokenId);
  if (!data) {
    content.innerHTML = `<p>Token not found.</p>`;
    return;
  }

  currentDetailToken = data;
  const name = data.metadata?.name || `NFT #${tokenId}`;
  const desc = data.metadata?.description || "No description.";
  document.getElementById("detail-modal-title").textContent = name;

  const isOwner = currentAccount && data.owner?.toLowerCase() === currentAccount.toLowerCase();

  const imageHTML = data.metadata && data.metadata.image
    ? `<img src="${data.metadata.image.startsWith('ipfs://') ? 'https://ipfs.io/ipfs/' + data.metadata.image.slice(7) : data.metadata.image}" alt="${name}" />`
    : `<div class="nft-placeholder" style="background: linear-gradient(135deg, ${generateNFTColor(tokenId)}, ${generateNFTColor(tokenId + 50)}); aspect-ratio:1;">
         <span style="font-size:4rem;">🎨</span>
       </div>`;

  let sharesHTML = "";
  if (data.royaltyShares.length > 0) {
    sharesHTML = `
      <table class="royalty-table">
        <thead><tr><th>Receiver</th><th>Share</th></tr></thead>
        <tbody>
          ${data.royaltyShares.map(s => `
            <tr>
              <td class="addr-cell">${shortAddr(s.receiver)}</td>
              <td>
                ${bpsToPercent(s.shareBps)}
                <div class="share-bar"><div class="share-bar-fill" style="width: ${s.shareBps / 100}%"></div></div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  let actionsHTML = "";
  if (isOwner) {
    if (data.listing?.active) {
      actionsHTML = `
        <button class="btn btn-danger btn-lg btn-full" onclick="unlistNFT(${tokenId})">❌ Cancel Listing</button>
      `;
    } else {
      actionsHTML = `
        <button class="btn btn-primary btn-lg btn-full" onclick="openListModal(${tokenId})">📋 List for Sale</button>
      `;
    }
  } else if (data.listing?.active) {
    actionsHTML = `
      <button class="btn btn-success btn-lg btn-full" onclick="buyNFT(${tokenId})">
        🛒 Buy for ${weiToEth(data.listing.price).toFixed(4)} ETH
      </button>
    `;
  }

  content.innerHTML = `
    <div class="detail-image">
      ${imageHTML}
    </div>
    <div class="detail-info">
      <div>
        <div class="detail-title">${name}</div>
        <p style="color: var(--text-secondary); font-size: 0.9rem; margin-top: var(--space-sm);">${desc}</p>
      </div>

      <div class="detail-owner">
        Owner: <span class="addr">${shortAddr(data.owner)}</span>
        ${isOwner ? ' <span style="color: var(--success); font-weight: 600;">(You)</span>' : ''}
      </div>

      <div class="info-chips">
        <div class="info-chip">
          Token ID <span class="chip-value">#${tokenId}</span>
        </div>
        <div class="info-chip">
          Royalty <span class="chip-value">${bpsToPercent(data.royaltyBps)}</span>
        </div>
        ${data.listing?.active ? `
          <div class="info-chip" style="border-color: rgba(0,184,148,0.3);">
            Price <span class="chip-value" style="color: var(--success);">Ξ ${weiToEth(data.listing.price).toFixed(4)}</span>
          </div>
        ` : ""}
      </div>

      ${sharesHTML ? `
        <div>
          <h4 style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: var(--space-sm);">Royalty Shares</h4>
          ${sharesHTML}
        </div>
      ` : ""}

      ${actionsHTML ? `<div class="mt-md">${actionsHTML}</div>` : ""}
    </div>
  `;
}

function closeDetailModal() {
  document.getElementById("modal-detail").classList.remove("active");
  currentDetailToken = null;
}

// ─── List Modal ─────────────────────────────────────────────
function openListModal(tokenId) {
  listingTokenId = tokenId;
  document.getElementById("list-price").value = "";
  document.getElementById("modal-list").classList.add("active");
}

function closeListModal() {
  document.getElementById("modal-list").classList.remove("active");
  listingTokenId = null;
}

// ─── Contract Interactions ──────────────────────────────────

// Mint
async function mintNFT() {
  if (!nftContract || !signer) {
    showToast("error", "Not Connected", "Please connect your wallet first.");
    return;
  }

  const mintTo = document.getElementById("mint-to").value.trim() || currentAccount;
  const tokenURI = document.getElementById("mint-uri").value.trim();
  const royaltyBps = parseInt(document.getElementById("mint-royalty-bps").value) || 0;

  if (!tokenURI) {
    showToast("warning", "Missing URI", "Please enter a Token URI.");
    return;
  }

  // Gather shares
  const shareRows = document.querySelectorAll("#shares-list .share-row");
  const shares = [];
  let totalShareBps = 0;

  for (const row of shareRows) {
    const addr = row.querySelector("[data-share-addr]").value.trim();
    const bps = parseInt(row.querySelector("[data-share-bps]").value) || 0;
    if (!addr) {
      showToast("warning", "Missing Address", "All share receivers must have an address.");
      return;
    }
    if (!ethers.isAddress(addr)) {
      showToast("error", "Invalid Address", `${shortAddr(addr)} is not a valid address.`);
      return;
    }
    shares.push({ receiver: addr, shareBps: bps });
    totalShareBps += bps;
  }

  if (totalShareBps !== 10000) {
    showToast("error", "Invalid Shares", `Total share bps must be 10000, got ${totalShareBps}.`);
    return;
  }

  if (royaltyBps > 1000) {
    showToast("error", "Royalty Too High", "Max royalty is 1000 bps (10%).");
    return;
  }

  const btn = document.getElementById("btn-mint");
  btn.disabled = true;
  btn.innerHTML = `<div class="spinner"></div> Minting...`;

  try {
    const tx = await nftContract.mintWithRoyalties(mintTo, tokenURI, royaltyBps, shares);
    showToast("info", "Transaction Sent", `Hash: ${shortAddr(tx.hash)}`);
    const receipt = await tx.wait();
    showToast("success", "NFT Minted! 🎉", `Block: ${receipt.blockNumber}`);

    // Clear form
    document.getElementById("mint-uri").value = "";

    // Refresh
    await refreshMarketplace();
  } catch (err) {
    console.error("Mint error:", err);
    showToast("error", "Mint Failed", err.reason || err.message || "Unknown error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `✨ Mint NFT`;
  }
}

// List
async function confirmList() {
  if (listingTokenId === null || !marketContract) return;

  const priceInput = document.getElementById("list-price").value;
  const price = parseFloat(priceInput);
  if (!price || price <= 0) {
    showToast("warning", "Invalid Price", "Please enter a valid price.");
    return;
  }

  const priceWei = ethers.parseEther(priceInput);
  const btn = document.getElementById("btn-confirm-list");
  btn.disabled = true;
  btn.innerHTML = `<div class="spinner"></div> Processing...`;

  try {
    // Check approval
    const approved = await nftContract.getApproved(listingTokenId);
    const isApprovedAll = await nftContract.isApprovedForAll(currentAccount, MARKETPLACE_ADDRESS);

    if (approved.toLowerCase() !== MARKETPLACE_ADDRESS.toLowerCase() && !isApprovedAll) {
      showToast("info", "Approving...", "Approving marketplace to transfer your NFT.");
      const approveTx = await nftContract.approve(MARKETPLACE_ADDRESS, listingTokenId);
      await approveTx.wait();
      showToast("success", "Approved", "Marketplace approved. Now listing...");
    }

    const tx = await marketContract.list(NFT_ADDRESS, listingTokenId, priceWei);
    showToast("info", "Listing...", `Transaction: ${shortAddr(tx.hash)}`);
    await tx.wait();
    showToast("success", "Listed! 📋", `Token #${listingTokenId} listed for ${priceInput} ETH`);

    closeListModal();
    closeDetailModal();
    await refreshMarketplace();
  } catch (err) {
    console.error("List error:", err);
    showToast("error", "Listing Failed", err.reason || err.message || "Unknown error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = "Confirm Listing";
  }
}

// Unlist
async function unlistNFT(tokenId) {
  if (!marketContract) return;

  try {
    showToast("info", "Unlisting...", `Cancelling listing for Token #${tokenId}`);
    const tx = await marketContract.unlist(NFT_ADDRESS, tokenId);
    await tx.wait();
    showToast("success", "Unlisted", `Token #${tokenId} removed from marketplace.`);
    closeDetailModal();
    await refreshMarketplace();
  } catch (err) {
    console.error("Unlist error:", err);
    showToast("error", "Unlist Failed", err.reason || err.message || "Unknown error");
  }
}

// Buy
async function buyNFT(tokenId) {
  if (!marketContract || !currentAccount) return;

  try {
    const listing = await marketContract.getListing(NFT_ADDRESS, tokenId);
    if (!listing.active) {
      showToast("error", "Not Listed", "This NFT is no longer listed.");
      return;
    }

    showToast("info", "Buying...", `Purchasing Token #${tokenId} for ${ethers.formatEther(listing.price)} ETH`);
    const tx = await marketContract.buy(NFT_ADDRESS, tokenId, { value: listing.price });
    await tx.wait();
    showToast("success", "Purchased! 🎉", `You now own Token #${tokenId}`);
    closeDetailModal();
    await refreshMarketplace();
    await refreshMyNFTs();
  } catch (err) {
    console.error("Buy error:", err);
    showToast("error", "Purchase Failed", err.reason || err.message || "Unknown error");
  }
}

// Withdraw
async function refreshWithdrawBalance() {
  if (!splitterContract || !currentAccount) {
    document.getElementById("withdraw-balance").textContent = "— ETH";
    return;
  }

  try {
    const balance = await splitterContract.balanceOf(currentAccount);
    document.getElementById("withdraw-balance").textContent = `${weiToEth(balance).toFixed(6)} ETH`;
  } catch (e) {
    console.error("Balance check error:", e);
  }
}

async function withdrawFunds() {
  if (!splitterContract) {
    showToast("error", "Not Connected", "Please connect your wallet first.");
    return;
  }

  const btn = document.getElementById("btn-withdraw");
  btn.disabled = true;
  btn.innerHTML = `<div class="spinner"></div> Withdrawing...`;

  try {
    const balance = await splitterContract.balanceOf(currentAccount);
    if (balance === 0n) {
      showToast("warning", "No Balance", "You have no funds to withdraw.");
      return;
    }

    const tx = await splitterContract.withdraw();
    showToast("info", "Withdrawing...", `Transaction: ${shortAddr(tx.hash)}`);
    await tx.wait();
    showToast("success", "Withdrawn! 💰", `${ethers.formatEther(balance)} ETH sent to your wallet.`);
    await refreshWithdrawBalance();
  } catch (err) {
    console.error("Withdraw error:", err);
    showToast("error", "Withdraw Failed", err.reason || err.message || "Unknown error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `💰 Withdraw All`;
  }
}

// ─── Royalty Shares Form ────────────────────────────────────
function addShareRow() {
  const list = document.getElementById("shares-list");
  const row = document.createElement("div");
  row.className = "share-row";
  row.innerHTML = `
    <input type="text" class="form-input" placeholder="0x... receiver" data-share-addr />
    <input type="number" class="form-input share-bps" placeholder="bps" data-share-bps value="0" />
    <button class="btn btn-danger btn-sm" onclick="removeShareRow(this)" title="Remove">✕</button>
  `;
  list.appendChild(row);
}

function removeShareRow(btn) {
  const list = document.getElementById("shares-list");
  if (list.children.length <= 1) {
    showToast("warning", "Min 1 Share", "At least one royalty receiver is required.");
    return;
  }
  btn.closest(".share-row").remove();
}

// ─── Close Modals on Overlay Click ──────────────────────────
document.querySelectorAll(".modal-overlay").forEach(overlay => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      overlay.classList.remove("active");
    }
  });
});

// ─── Keyboard shortcuts ─────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal-overlay.active").forEach(o => o.classList.remove("active"));
  }
});

// ─── Auto-connect on load ───────────────────────────────────
window.addEventListener("load", () => {
  if (window.ethereum?.selectedAddress) {
    connectWallet();
  }
});
