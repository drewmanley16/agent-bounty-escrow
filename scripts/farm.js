#!/usr/bin/env node
/**
 * Transaction farming script — cycles full bounty lifecycle to maximize on-chain activity.
 * Post → Claim → SubmitProof → Approve → repeat
 * OKB circulates back each cycle; only gas is consumed.
 */

import { ethers } from "ethers";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

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

const RPC_URL = "https://xlayertestrpc.okx.com";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const ABI = [
  "function postBounty(string,string,string,uint256) payable returns (uint256)",
  "function claimBounty(uint256)",
  "function submitProof(uint256,string)",
  "function approveBounty(uint256)",
  "function bountyCount() view returns (uint256)",
];

const REWARD = ethers.parseEther("0.001"); // 0.001 OKB per cycle — small to preserve gas
const DEADLINE = BigInt(2 * 3600);         // 2 hour deadline
const CYCLES = parseInt(process.argv[2] ?? "50");
const DELAY_MS = 1500; // ms between txs to avoid nonce collisions

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function sendTx(contract, method, args, value) {
  const fn = contract[method];
  const opts = value ? { value } : {};
  const tx = await fn(...args, opts);
  process.stdout.write(`  ${method} tx=${tx.hash.slice(0,12)}...`);
  const receipt = await tx.wait();
  process.stdout.write(` gas=${receipt.gasUsed}\n`);
  return receipt;
}

(async () => {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

  const startBal = await provider.getBalance(wallet.address);
  console.log(`\nFarming ${CYCLES} cycles on X Layer testnet`);
  console.log(`Wallet: ${wallet.address}`);
  console.log(`Start balance: ${ethers.formatEther(startBal)} OKB`);
  console.log(`Reward per cycle: ${ethers.formatEther(REWARD)} OKB\n`);

  let completed = 0;
  let totalGas = 0n;

  for (let i = 0; i < CYCLES; i++) {
    const bal = await provider.getBalance(wallet.address);
    if (bal < REWARD + ethers.parseEther("0.01")) {
      console.log(`Low balance (${ethers.formatEther(bal)} OKB), stopping after ${completed} cycles.`);
      break;
    }

    console.log(`[Cycle ${i + 1}/${CYCLES}] balance=${ethers.formatEther(bal)} OKB`);

    try {
      // Post
      await sleep(DELAY_MS);
      const postReceipt = await sendTx(contract, "postBounty",
        [`AgentTask-${i + 1}`, `Auto-generated task ${i + 1}`, `Complete task ${i + 1} requirements`, DEADLINE],
        REWARD);
      totalGas += postReceipt.gasUsed;

      // Read bounty ID from the receipt log (no extra RPC, no race condition)
      const postedTopic = contract.interface.getEvent("BountyPosted").topicHash;
      const postLog = postReceipt.logs.find(l =>
        l.address.toLowerCase() === CONTRACT_ADDRESS.toLowerCase() &&
        l.topics[0] === postedTopic
      );
      const id = postLog ? Number(BigInt(postLog.topics[1])) : Number((await contract.bountyCount()) - 1n);

      // Claim
      await sleep(DELAY_MS);
      const claimReceipt = await sendTx(contract, "claimBounty", [id]);
      totalGas += claimReceipt.gasUsed;

      // Submit proof
      await sleep(DELAY_MS);
      const proofReceipt = await sendTx(contract, "submitProof", [id, `https://github.com/drewmanley16/agent-bounty-escrow/commit/farm-${i}`]);
      totalGas += proofReceipt.gasUsed;

      // Approve
      await sleep(DELAY_MS);
      const approveReceipt = await sendTx(contract, "approveBounty", [id]);
      totalGas += approveReceipt.gasUsed;

      completed++;
      console.log(`  ✓ Cycle ${i + 1} done — bounty #${id} completed\n`);

    } catch (err) {
      console.error(`  ✗ Cycle ${i + 1} failed: ${err.message}\n`);
      await sleep(5000);
    }
  }

  const endBal = await provider.getBalance(wallet.address);
  const gasCost = startBal - endBal;
  console.log(`\n═══ Farm complete ═══`);
  console.log(`Cycles completed: ${completed}`);
  console.log(`Total gas used:   ${totalGas.toLocaleString()} units`);
  console.log(`Total OKB spent:  ${ethers.formatEther(gasCost)} OKB`);
  console.log(`End balance:      ${ethers.formatEther(endBal)} OKB`);
  console.log(`On-chain txs:     ${completed * 4} (post + claim + proof + approve)`);
  console.log(`Explorer: https://www.okx.com/explorer/xlayer-test/address/${wallet.address}`);
})().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
