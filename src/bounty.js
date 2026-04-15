#!/usr/bin/env node
/**
 * Agent Bounty Escrow — CLI for AI agents
 * Interact with BountyEscrow contract on X Layer via OnchainOS
 */

import { ethers } from "ethers";
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import * as onchainos from "./onchainos.js";

// Load .env manually (dotenv ESM)
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "../.env");
try {
  const envFile = readFileSync(envPath, "utf8");
  for (const line of envFile.split("\n")) {
    const [k, ...v] = line.split("=");
    if (k && v.length && !k.startsWith("#")) {
      process.env[k.trim()] = v.join("=").trim();
    }
  }
} catch {}

const RPC_URL = "https://xlayertestrpc.okx.com";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

const ABI = [
  "function postBounty(string title, string description, string requirements, uint256 deadlineDuration) payable returns (uint256)",
  "function claimBounty(uint256 id)",
  "function submitProof(uint256 id, string proof)",
  "function approveBounty(uint256 id)",
  "function cancelBounty(uint256 id)",
  "function refundExpiredBounty(uint256 id)",
  "function getBounty(uint256 id) view returns (tuple(uint256 id, address poster, uint256 amount, string title, string description, string requirements, address claimer, uint8 status, uint256 deadline, string proof, uint256 createdAt, uint256 completedAt))",
  "function getOpenBounties(uint256 offset, uint256 limit) view returns (tuple(uint256 id, address poster, uint256 amount, string title, string description, string requirements, address claimer, uint8 status, uint256 deadline, string proof, uint256 createdAt, uint256 completedAt)[], uint256 total)",
  "function bountyCount() view returns (uint256)",
];

const STATUS = ["Open", "Claimed", "Submitted", "Completed", "Cancelled", "Disputed"];

function getProvider() {
  return new ethers.JsonRpcProvider(RPC_URL);
}

function getContract(signerOrProvider) {
  if (!CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS not set in .env");
  return new ethers.Contract(CONTRACT_ADDRESS, ABI, signerOrProvider);
}

function getSigner(provider) {
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk) throw new Error("DEPLOYER_PRIVATE_KEY not set in .env");
  return new ethers.Wallet(pk, provider);
}

function formatBounty(b) {
  const deadline = new Date(Number(b.deadline) * 1000);
  return {
    id: Number(b.id),
    title: b.title,
    description: b.description,
    requirements: b.requirements,
    reward: ethers.formatEther(b.amount) + " OKB",
    status: STATUS[b.status],
    poster: b.poster,
    claimer: b.claimer === ethers.ZeroAddress ? null : b.claimer,
    deadline: deadline.toISOString(),
    proof: b.proof || null,
  };
}

async function listBounties(offset = 0, limit = 10) {
  const contract = getContract(getProvider());
  const [results, total] = await contract.getOpenBounties(offset, limit);
  const out = { total: Number(total), showing: results.length, bounties: results.map(formatBounty) };
  console.log(JSON.stringify(out, null, 2));
}

async function getBounty(id) {
  const contract = getContract(getProvider());
  const b = await contract.getBounty(id);
  console.log(JSON.stringify(formatBounty(b), null, 2));
}

async function postBounty(title, description, requirements, rewardOKB, deadlineHours) {
  const provider = getProvider();
  const signer = getSigner(provider);
  const contract = getContract(signer);
  const value = ethers.parseEther(String(rewardOKB));
  const duration = BigInt(Math.floor(Number(deadlineHours) * 3600));
  console.log(`Posting bounty: "${title}" for ${rewardOKB} OKB...`);
  const tx = await contract.postBounty(title, description, requirements, duration, { value });
  console.log("TX:", tx.hash);
  const receipt = await tx.wait();
  const event = receipt.logs
    .map(log => { try { return contract.interface.parseLog(log); } catch { return null; } })
    .find(e => e?.name === "BountyPosted");
  const bountyId = event ? Number(event.args.id) : "unknown";
  console.log(JSON.stringify({ success: true, bountyId, txHash: tx.hash, reward: rewardOKB + " OKB" }, null, 2));
}

async function claimBounty(id) {
  const provider = getProvider();
  const contract = getContract(getSigner(provider));
  console.log(`Claiming bounty #${id}...`);
  const tx = await contract.claimBounty(id);
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
  console.log(`Approving bounty #${id}...`);
  const tx = await contract.approveBounty(id);
  console.log("TX:", tx.hash);
  await tx.wait();
  console.log(JSON.stringify({ success: true, bountyId: Number(id), txHash: tx.hash }, null, 2));
}

async function checkBalance() {
  const address = process.env.DEPLOYER_PRIVATE_KEY
    ? new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY).address
    : null;
  if (!address) throw new Error("DEPLOYER_PRIVATE_KEY not set");
  const provider = getProvider();
  const balance = await provider.getBalance(address);
  console.log(JSON.stringify({ address, balance: ethers.formatEther(balance) + " OKB" }, null, 2));
}

// CLI entrypoint
const [,, cmd, ...args] = process.argv;

(async () => {
  switch (cmd) {
    case "list":    await listBounties(Number(args[0] || 0), Number(args[1] || 10)); break;
    case "get":     await getBounty(Number(args[0])); break;
    case "post":    await postBounty(args[0], args[1], args[2], args[3], args[4] || 24); break;
    case "claim":   await claimBounty(Number(args[0])); break;
    case "proof":   await submitProof(Number(args[0]), args[1]); break;
    case "approve": await approveBounty(Number(args[0])); break;
    case "balance": await checkBalance(); break;
    default:
      console.log(`Agent Bounty Escrow CLI

Commands:
  list [offset] [limit]                  List open bounties
  get <id>                               Get bounty details
  post <title> <desc> <req> <okb> <hrs>  Post a bounty
  claim <id>                             Claim a bounty
  proof <id> <url>                       Submit proof of work
  approve <id>                           Approve and release payment
  balance                                Show wallet balance

Contract: ${CONTRACT_ADDRESS || "(set CONTRACT_ADDRESS in .env)"}
Network:  X Layer testnet (chain 1952) | https://xlayertestrpc.okx.com
`);
  }
})().catch(e => { console.error("Error:", e.message); process.exit(1); });
