// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {BountyEscrow} from "../src/BountyEscrow.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance);

        vm.startBroadcast(deployerKey);
        BountyEscrow escrow = new BountyEscrow();
        vm.stopBroadcast();

        console.log("BountyEscrow deployed to:", address(escrow));
        console.log("Explorer: https://www.okx.com/explorer/xlayer/address/", address(escrow));
    }
}
