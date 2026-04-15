const { ethers } = require("hardhat");

async function main() {
  console.log("Deploying BountyEscrow to X Layer...");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "OKB");

  const BountyEscrow = await ethers.getContractFactory("BountyEscrow");
  const contract = await BountyEscrow.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("\nBountyEscrow deployed to:", address);
  console.log("X Layer Explorer:", `https://www.okx.com/explorer/xlayer/address/${address}`);
  console.log("\nSave this address to .env as CONTRACT_ADDRESS=" + address);
}

main().catch((e) => { console.error(e); process.exit(1); });
