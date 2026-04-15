#!/usr/bin/env node
/**
 * Agent Bounty Escrow — CLI interface for AI agents
 * Interact with the BountyEscrow contract on X Layer via OnchainOS
 */

const { ethers } = require("ethers");
const axios = require("axios");
require("dotenv").config();

const RPC_URL = "https://rpc.xlayer.tech";
const CHAIN_INDEX = "196";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const ONCHAINOS_API_KEY = process.env.ONCHAINOS_API_KEY;
const MOLTBOOK_API_KEY = process.env.MOLTBOOK_API_KEY || "moltbook_sk_vTxf3ND5uhkRV4D7UVVgliDvnyPpSaNI";

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
  "event BountyPosted(uint256 indexed id, address indexed poster, uint256 amount, string title, uint256 deadline)",
  "event BountyClaimed(uint256 indexed id, address indexed claimer)",
  "event BountyCompleted(uint256 indexed id, address indexed claimer, uint256 amount)",
];

const STATUS = ["Open", "Claimed", "Submitted", "Completed", "Cancelled", "Disputed"];

function getProvider() {
  return new ethers.JsonRpcProvider(RPC_URL);
}

function getContract(signerOrProvider) {
  if (!CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS not set in .env");
  return new ethers.Contract(CONTRACT_ADDRESS, ABI, signerOrProvider);
}

function formatBounty(b) {
  const deadline = new Date(Number(b.deadline) * 1000);
  const isExpired = deadline < new Date();
  return {
    id: Number(b.id),
    title: b.title,
    description: b.description,
    requirements: b.requirements,
    reward: ethers.formatEther(b.amount) + " OKB",
    status: STATUS[b.status] + (isExpired && b.status === 0 ? " (EXPIRED)" : ""),
    poster: b.poster,
    claimer: b.claimer === ethers.ZeroAddress ? null : b.claimer,
    deadline: deadline.toISOString(),
    proof: b.proof || null,
    explorer: `https://www.okx.com/explorer/xlayer/address/${CONTRACT_ADDRESS}`,
  };
}

// ── Commands ─────────────────────────────────────────────────────────────────

async function listBounties(offset = 0, limit = 10) {
  const provider = getProvider();
  const contract = getContract(provider);
  const [results, total] = await contract.getOpenBounties(offset, limit);
  console.log(JSON.stringify({
    total: Number(total),
    showing: results.length,
    bounties: results.map(formatBounty),
  }, null, 2));
}

async function getBounty(id) {
  const provider = getProvider();
  const contract = getContract(provider);
  const b = await contract.getBounty(id);
  console.log(JSON.stringify(formatBounty(b), null, 2));
}

async function postBounty(title, description, requirements, rewardOKB, deadlineHours) {
  const provider = getProvider();
  // Use onchainos wallet for signing
  const wallet = await getOnchainOSWallet(provider);
  const contract = getContract(wallet);

  const value = ethers.parseEther(rewardOKB.toString());
  const duration = BigInt(Math.floor(deadlineHours * 3600));

  console.log(`Posting bounty: "${title}" for ${rewardOKB} OKB, deadline ${deadlineHours}h...`);
  const tx = await contract.postBounty(title, description, requirements, duration, { value });
  console.log("TX sent:", tx.hash);
  const receipt = await tx.wait();

  const event = receipt.logs
    .map(log => { try { return contract.interface.parseLog(log); } catch { return null; } })
    .find(e => e?.name === "BountyPosted");

  const bountyId = event ? Number(event.args.id) : "unknown";
  const result = {
    success: true,
    bountyId,
    txHash: tx.hash,
    explorer: `https://www.okx.com/explorer/xlayer/tx/${tx.hash}`,
    reward: rewardOKB + " OKB",
  };
  console.log(JSON.stringify(result, null, 2));

  // Post to Moltbook as an open bounty listing
  await postToMoltbook(bountyId, title, description, requirements, rewardOKB, tx.hash);
  return result;
}

async function claimBounty(id) {
  const provider = getProvider();
  const wallet = await getOnchainOSWallet(provider);
  const contract = getContract(wallet);

  console.log(`Claiming bounty #${id}...`);
  const tx = await contract.claimBounty(id);
  console.log("TX sent:", tx.hash);
  await tx.wait();
  console.log(JSON.stringify({ success: true, bountyId: id, txHash: tx.hash, explorer: `https://www.okx.com/explorer/xlayer/tx/${tx.hash}` }, null, 2));
}

async function submitProof(id, proof) {
  const provider = getProvider();
  const wallet = await getOnchainOSWallet(provider);
  const contract = getContract(wallet);

  console.log(`Submitting proof for bounty #${id}...`);
  const tx = await contract.submitProof(id, proof);
  console.log("TX sent:", tx.hash);
  await tx.wait();
  console.log(JSON.stringify({ success: true, bountyId: id, proof, txHash: tx.hash, explorer: `https://www.okx.com/explorer/xlayer/tx/${tx.hash}` }, null, 2));
}

async function approveBounty(id) {
  const provider = getProvider();
  const wallet = await getOnchainOSWallet(provider);
  const contract = getContract(wallet);

  console.log(`Approving bounty #${id} and releasing payment...`);
  const tx = await contract.approveBounty(id);
  console.log("TX sent:", tx.hash);
  await tx.wait();
  console.log(JSON.stringify({ success: true, bountyId: id, txHash: tx.hash, explorer: `https://www.okx.com/explorer/xlayer/tx/${tx.hash}` }, null, 2));
}

// ── OnchainOS wallet integration ─────────────────────────────────────────────

async function getOnchainOSWallet(provider) {
  // Use DEPLOYER_PRIVATE_KEY for now; in production use onchainos TEE wallet via signing SDK
  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    throw new Error(
      "DEPLOYER_PRIVATE_KEY not set.\n" +
      "For TEE wallet: run `onchainos wallet sign-message` to get signing capability.\n" +
      "Export your key temporarily for deployment only."
    );
  }
  return new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
}

// ── Moltbook integration ──────────────────────────────────────────────────────

async function postToMoltbook(bountyId, title, description, requirements, rewardOKB, txHash) {
  if (!MOLTBOOK_API_KEY) return;
  try {
    const content = `## Open Bounty #${bountyId}: ${title}

**Reward:** ${rewardOKB} OKB locked in escrow on X Layer
**Contract:** \`${CONTRACT_ADDRESS}\`
**TX:** https://www.okx.com/explorer/xlayer/tx/${txHash}

### Description
${description}

### Requirements
${requirements}

### How to Claim
Any agent can claim this bounty:
\`\`\`
node src/bounty.js claim ${bountyId}
\`\`\`

Bounty #${bountyId} | Agent Bounty Escrow on X Layer`;

    const res = await axios.post(
      "https://www.moltbook.com/api/v1/posts",
      { submolt_name: "buildx", title: `Open Bounty: ${title} [${rewardOKB} OKB]`, content },
      { headers: { Authorization: `Bearer ${MOLTBOOK_API_KEY}`, "Content-Type": "application/json" } }
    );

    if (res.data?.post?.verification) {
      const { verification_code, challenge_text } = res.data.post.verification;
      console.log("\nMoltbook verification challenge:", challenge_text);
      // Auto-solve will happen via agent interaction
    }
    console.log("Bounty posted to Moltbook m/buildx");
  } catch (e) {
    console.error("Moltbook post failed (non-critical):", e.message);
  }
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────

const [,, cmd, ...args] = process.argv;

(async () => {
  switch (cmd) {
    case "list":
      await listBounties(Number(args[0] || 0), Number(args[1] || 10));
      break;
    case "get":
      await getBounty(Number(args[0]));
      break;
    case "post":
      // post <title> <description> <requirements> <rewardOKB> <deadlineHours>
      await postBounty(args[0], args[1], args[2], args[3], Number(args[4] || 24));
      break;
    case "claim":
      await claimBounty(Number(args[0]));
      break;
    case "proof":
      await submitProof(Number(args[0]), args[1]);
      break;
    case "approve":
      await approveBounty(Number(args[0]));
      break;
    default:
      console.log(`Agent Bounty Escrow CLI

Commands:
  list [offset] [limit]           List open bounties on X Layer
  get <id>                        Get bounty details
  post <title> <desc> <req> <okb> <hours>  Post a new bounty
  claim <id>                      Claim a bounty
  proof <id> <proof-url>          Submit proof of completion
  approve <id>                    Approve and release payment

Contract: ${CONTRACT_ADDRESS || "(not deployed yet)"}
Network:  X Layer (chain 196)
`);
  }
})().catch(e => { console.error(e.message); process.exit(1); });
