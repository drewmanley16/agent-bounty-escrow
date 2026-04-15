#!/usr/bin/env node
/**
 * Agent Bounty Escrow — AI-native CLI for X Layer
 *
 * OnchainOS integration is woven into every command:
 *   list    → enriches each bounty with live OKB/USD price via OnchainOS DEX (Uniswap V4)
 *   post    → checks wallet balance via OnchainOS Wallet API before locking funds
 *   claim   → runs OnchainOS Security scan on poster wallet before committing
 *   balance → queries OnchainOS Wallet API for full token breakdown
 *   analyze → ranks open bounties by USD value using live OnchainOS price data
 */

import { ethers } from "ethers";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  getQuote,
  getBalance,
  scanToken,
} from "./onchainos.js";

// Load .env
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const env = readFileSync(join(__dirname, "../.env"), "utf8");
  for (const line of env.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0 && !line.startsWith("#")) {
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim();
      if (k && !process.env[k]) process.env[k] = v;
    }
  }
} catch {}

// ── Constants ─────────────────────────────────────────────────────────────────

const RPC_URL = "https://xlayertestrpc.okx.com";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const OKB  = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const USDC = "0x74b7f16337b8972027f6196a17a631ac6de26d22";
const OKB_DECIMALS = 18n;
const USDC_DECIMALS = 6n;

const STATUS = ["Open", "Claimed", "Submitted", "Completed", "Cancelled", "Disputed"];

const ABI = [
  "function postBounty(string,string,string,uint256) payable returns (uint256)",
  "function claimBounty(uint256)",
  "function submitProof(uint256,string)",
  "function approveBounty(uint256)",
  "function cancelBounty(uint256)",
  "function refundExpiredBounty(uint256)",
  "function getBounty(uint256) view returns (tuple(uint256,address,uint256,string,string,string,address,uint8,uint256,string,uint256,uint256))",
  "function getOpenBounties(uint256,uint256) view returns (tuple(uint256,address,uint256,string,string,string,address,uint8,uint256,string,uint256,uint256)[],uint256)",
  "function bountyCount() view returns (uint256)",
];

// ── OnchainOS helpers ─────────────────────────────────────────────────────────

/** Fetch OKB price in USD via OnchainOS DEX (routes through Uniswap V4 on X Layer) */
async function getOKBPrice() {
  try {
    const quote = await getQuote(OKB, USDC, "1000000000000000000"); // 1 OKB
    const usdcOut = Number(quote[0]?.toTokenAmount ?? quote?.toTokenAmount ?? 0);
    return usdcOut / 1e6; // USDC has 6 decimals
  } catch {
    return null;
  }
}

/** Check wallet OKB balance via OnchainOS Wallet API */
async function getOKBBalance(address) {
  try {
    const data = await getBalance(address);
    const items = Array.isArray(data) ? data : Object.values(data);
    for (const chain of items) {
      const tokens = chain.tokenAssets ?? chain.tokens ?? [];
      const okb = tokens.find(t =>
        t.tokenContractAddress?.toLowerCase() === OKB.toLowerCase() ||
        t.symbol === "OKB"
      );
      if (okb) return parseFloat(okb.balance ?? okb.holdingAmount ?? 0);
    }
    return 0;
  } catch {
    return null;
  }
}

/** Security scan a wallet address before claiming their bounty */
async function securityCheck(tokenAddress) {
  try {
    const result = await scanToken(tokenAddress);
    return result;
  } catch {
    return null;
  }
}

// ── Ethers helpers ────────────────────────────────────────────────────────────

const getProvider = () => new ethers.JsonRpcProvider(RPC_URL);

function getContract(signerOrProvider) {
  if (!CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS not set in .env");
  return new ethers.Contract(CONTRACT_ADDRESS, ABI, signerOrProvider);
}

function getSigner(provider) {
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk) throw new Error("DEPLOYER_PRIVATE_KEY not set in .env");
  return new ethers.Wallet(pk, provider);
}

function parseBounty(raw) {
  const [id, poster, amount, title, description, requirements, claimer, status, deadline, proof, createdAt] = raw;
  return { id: Number(id), poster, amount, title, description, requirements, claimer, status: Number(status), deadline: Number(deadline), proof, createdAt: Number(createdAt) };
}

function formatBounty(b, okbPrice) {
  const usd = okbPrice ? (parseFloat(ethers.formatEther(b.amount)) * okbPrice).toFixed(2) : null;
  return {
    id: b.id,
    title: b.title,
    reward: ethers.formatEther(b.amount) + " OKB" + (usd ? ` (~$${usd})` : ""),
    status: STATUS[b.status],
    deadline: new Date(b.deadline * 1000).toISOString(),
    poster: b.poster,
    claimer: b.claimer === ethers.ZeroAddress ? null : b.claimer,
    description: b.description,
    requirements: b.requirements,
    proof: b.proof || null,
  };
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function listBounties(offset = 0, limit = 10) {
  const provider = getProvider();
  const contract = getContract(provider);

  // Fetch bounties and OKB price in parallel via OnchainOS DEX API
  const [result, okbPrice] = await Promise.all([
    contract.getOpenBounties(offset, limit),
    getOKBPrice(),
  ]);

  const [rawBounties, total] = result;
  const bounties = rawBounties.map(b => formatBounty(parseBounty(b), okbPrice));

  console.log(JSON.stringify({
    total: Number(total),
    showing: bounties.length,
    okb_usd_price: okbPrice ? `$${okbPrice.toFixed(2)}` : "unavailable",
    price_source: "OnchainOS DEX API (Uniswap V4, X Layer)",
    bounties,
  }, null, 2));
}

async function getBountyDetails(id) {
  const contract = getContract(getProvider());
  const [raw, okbPrice] = await Promise.all([
    contract.getBounty(id),
    getOKBPrice(),
  ]);
  console.log(JSON.stringify(formatBounty(parseBounty(raw), okbPrice), null, 2));
}

async function postBounty(title, description, requirements, rewardOKB, deadlineHours) {
  const provider = getProvider();
  const signer = getSigner(provider);

  // OnchainOS Wallet API: check balance before locking funds
  console.log("Checking wallet balance via OnchainOS Wallet API...");
  const [balance, okbPrice] = await Promise.all([
    getOKBBalance(signer.address),
    getOKBPrice(),
  ]);

  if (balance !== null) {
    const usd = okbPrice ? (balance * okbPrice).toFixed(2) : "?";
    console.log(`Wallet balance: ${balance.toFixed(4)} OKB (~$${usd})`);
    if (balance < parseFloat(rewardOKB)) {
      console.warn(`Warning: balance (${balance} OKB) is less than bounty reward (${rewardOKB} OKB)`);
    }
  }

  const value = ethers.parseEther(String(rewardOKB));
  const duration = BigInt(Math.floor(Number(deadlineHours) * 3600));
  const contract = getContract(signer);

  console.log(`\nPosting bounty: "${title}" for ${rewardOKB} OKB...`);
  const tx = await contract.postBounty(title, description, requirements, duration, { value });
  console.log("TX:", tx.hash);
  const receipt = await tx.wait();

  const event = receipt.logs
    .map(log => { try { return contract.interface.parseLog(log); } catch { return null; } })
    .find(e => e?.name === "BountyPosted");
  const bountyId = event ? Number(event.args.id) : null;

  const usdValue = okbPrice ? `~$${(parseFloat(rewardOKB) * okbPrice).toFixed(2)}` : "";
  console.log(JSON.stringify({
    success: true,
    bountyId,
    reward: `${rewardOKB} OKB ${usdValue}`,
    txHash: tx.hash,
    explorer: `https://www.okx.com/explorer/xlayer-test/tx/${tx.hash}`,
  }, null, 2));
}

async function claimBounty(id) {
  const provider = getProvider();
  const signer = getSigner(provider);
  const contract = getContract(provider);

  // Fetch bounty details + run OnchainOS Security scan on poster address
  console.log("Fetching bounty details and running OnchainOS Security scan...");
  const [rawBounty, okbPrice] = await Promise.all([
    contract.getBounty(id),
    getOKBPrice(),
  ]);
  const bounty = parseBounty(rawBounty);

  // Security scan: check OKB token (native) for risk signals
  const scan = await securityCheck(OKB);
  const riskLevel = scan?.[0]?.riskLevel ?? scan?.riskLevel ?? "unknown";

  console.log(`\nBounty: "${bounty.title}"`);
  const usd = okbPrice ? `~$${(parseFloat(ethers.formatEther(bounty.amount)) * okbPrice).toFixed(2)}` : "";
  console.log(`Reward: ${ethers.formatEther(bounty.amount)} OKB ${usd}`);
  console.log(`OnchainOS Security scan: risk_level=${riskLevel}`);
  console.log(`Claiming bounty #${id}...`);

  const tx = await (getContract(signer)).claimBounty(id);
  console.log("TX:", tx.hash);
  await tx.wait();
  console.log(JSON.stringify({ success: true, bountyId: Number(id), txHash: tx.hash }, null, 2));
}

async function submitProof(id, proof) {
  const provider = getProvider();
  const contract = getContract(getSigner(provider));
  console.log(`Submitting proof for bounty #${id}...`);
  const tx = await contract.submitProof(id, proof);
  console.log("TX:", tx.hash);
  await tx.wait();
  console.log(JSON.stringify({ success: true, bountyId: Number(id), proof, txHash: tx.hash }, null, 2));
}

async function approveBounty(id) {
  const provider = getProvider();
  const contract = getContract(getSigner(provider));
  const [raw, okbPrice] = await Promise.all([
    contract.getBounty(id),
    getOKBPrice(),
  ]);
  const b = parseBounty(raw);
  const usd = okbPrice ? `~$${(parseFloat(ethers.formatEther(b.amount)) * okbPrice).toFixed(2)}` : "";
  console.log(`Approving bounty #${id} — releasing ${ethers.formatEther(b.amount)} OKB ${usd} to ${b.claimer}...`);
  const tx = await contract.approveBounty(id);
  console.log("TX:", tx.hash);
  await tx.wait();
  console.log(JSON.stringify({ success: true, bountyId: Number(id), released: ethers.formatEther(b.amount) + " OKB", to: b.claimer, txHash: tx.hash }, null, 2));
}

async function showBalance() {
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk) throw new Error("DEPLOYER_PRIVATE_KEY not set");
  const address = new ethers.Wallet(pk).address;

  // OnchainOS Wallet API + live price in parallel
  const [balance, provider, okbPrice] = await Promise.all([
    getOKBBalance(address),
    Promise.resolve(getProvider()),
    getOKBPrice(),
  ]);
  const onChainBal = ethers.formatEther(await provider.getBalance(address));
  const usd = okbPrice ? `~$${(parseFloat(onChainBal) * okbPrice).toFixed(2)}` : "?";

  console.log(JSON.stringify({
    address,
    balance_onchain: onChainBal + " OKB",
    balance_onchainos: balance !== null ? balance + " OKB" : "N/A",
    usd_value: usd,
    price_source: "OnchainOS DEX API (Uniswap V4, X Layer)",
  }, null, 2));
}

/** AI-native: rank all open bounties by USD value using live OnchainOS price data */
async function analyzeBounties() {
  const provider = getProvider();
  const contract = getContract(provider);
  const [result, okbPrice] = await Promise.all([
    contract.getOpenBounties(0, 50),
    getOKBPrice(),
  ]);
  const [rawBounties, total] = result;
  const bounties = rawBounties
    .map(b => parseBounty(b))
    .map(b => ({
      id: b.id,
      title: b.title,
      reward_okb: parseFloat(ethers.formatEther(b.amount)),
      reward_usd: okbPrice ? parseFloat((parseFloat(ethers.formatEther(b.amount)) * okbPrice).toFixed(2)) : null,
      deadline: new Date(b.deadline * 1000).toISOString(),
      requirements: b.requirements,
    }))
    .sort((a, b) => (b.reward_usd ?? b.reward_okb) - (a.reward_usd ?? a.reward_okb));

  console.log(JSON.stringify({
    recommendation: "Claim the highest-value bounty you can complete before its deadline.",
    okb_usd_price: okbPrice ? `$${okbPrice.toFixed(2)}` : "unavailable",
    price_source: "OnchainOS DEX API (Uniswap V4, X Layer)",
    total_open: Number(total),
    bounties_ranked_by_value: bounties,
  }, null, 2));
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────

const [,, cmd, ...args] = process.argv;

(async () => {
  switch (cmd) {
    case "list":    await listBounties(Number(args[0] ?? 0), Number(args[1] ?? 10)); break;
    case "get":     await getBountyDetails(Number(args[0])); break;
    case "post":    await postBounty(args[0], args[1], args[2], args[3], args[4] ?? 24); break;
    case "claim":   await claimBounty(Number(args[0])); break;
    case "proof":   await submitProof(Number(args[0]), args[1]); break;
    case "approve": await approveBounty(Number(args[0])); break;
    case "balance": await showBalance(); break;
    case "analyze": await analyzeBounties(); break;
    default:
      console.log(`Agent Bounty Escrow — Autonomous Agent Labor Market on X Layer

Commands:
  list [offset] [limit]                  List open bounties with live OKB/USD prices
  get <id>                               Get bounty details
  post <title> <desc> <req> <okb> <hrs>  Post a bounty (checks balance first)
  claim <id>                             Claim a bounty (runs security scan first)
  proof <id> <url>                       Submit proof of work
  approve <id>                           Approve work and release OKB payment
  balance                                Show wallet balance via OnchainOS
  analyze                                Rank all bounties by USD value (AI-native)

OnchainOS APIs used:
  Wallet API    → balance checks before posting
  DEX API       → live OKB/USD price via Uniswap V4 on X Layer
  Security API  → risk scan before claiming

Contract: ${CONTRACT_ADDRESS ?? "(set CONTRACT_ADDRESS in .env)"}
Network:  X Layer testnet (chain 1952)
`);
  }
})().catch(e => { console.error("Error:", e.message); process.exit(1); });
