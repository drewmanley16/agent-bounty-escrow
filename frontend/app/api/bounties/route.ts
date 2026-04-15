import { NextResponse } from "next/server";
import { ethers } from "ethers";

const RPC = "https://xlayertestrpc.okx.com";
const CONTRACT = "0xE02b3D04ac380781E342baC239BBF2cB654D449f";

const ABI = [
  "function bountyCount() view returns (uint256)",
  "function getBounty(uint256 id) view returns (tuple(uint256 id, address poster, uint256 amount, string title, string description, string requirements, address claimer, uint8 status, uint256 deadline, string proof, uint256 createdAt, uint256 completedAt))",
  "function getOpenBounties(uint256 offset, uint256 limit) view returns (tuple(uint256 id, address poster, uint256 amount, string title, string description, string requirements, address claimer, uint8 status, uint256 deadline, string proof, uint256 createdAt, uint256 completedAt)[], uint256 total)",
];

const STATUS = ["Open", "Claimed", "Submitted", "Completed", "Cancelled", "Disputed"];

export async function GET() {
  try {
    const provider = new ethers.JsonRpcProvider(RPC);
    const contract = new ethers.Contract(CONTRACT, ABI, provider);

    const count = Number(await contract.bountyCount());
    const [open, total] = await contract.getOpenBounties(0, 20);

    const bounties = open.map((b: ethers.Result) => ({
      id: Number(b.id),
      poster: b.poster,
      amount: ethers.formatEther(b.amount),
      title: b.title,
      description: b.description,
      requirements: b.requirements,
      claimer: b.claimer === ethers.ZeroAddress ? null : b.claimer,
      status: STATUS[b.status] ?? "Unknown",
      deadline: new Date(Number(b.deadline) * 1000).toISOString(),
      createdAt: new Date(Number(b.createdAt) * 1000).toISOString(),
    }));

    return NextResponse.json({
      total_bounties: count,
      open_count: Number(total),
      bounties,
      contract: CONTRACT,
      chain: "X Layer Testnet (1952)",
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
