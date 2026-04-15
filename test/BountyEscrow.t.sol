// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {BountyEscrow} from "../src/BountyEscrow.sol";

contract BountyEscrowTest is Test {
    BountyEscrow public escrow;
    address poster = makeAddr("poster");
    address claimer = makeAddr("claimer");

    function setUp() public {
        escrow = new BountyEscrow();
        vm.deal(poster, 10 ether);
        vm.deal(claimer, 1 ether);
    }

    function test_PostBounty() public {
        vm.prank(poster);
        uint256 id = escrow.postBounty{value: 1 ether}(
            "Test Bounty",
            "Description",
            "Requirements",
            1 days
        );
        assertEq(id, 0);
        BountyEscrow.Bounty memory b = escrow.getBounty(0);
        assertEq(b.poster, poster);
        assertEq(b.amount, 1 ether);
        assertEq(uint8(b.status), uint8(BountyEscrow.Status.Open));
    }

    function test_FullLifecycle() public {
        // Post
        vm.prank(poster);
        escrow.postBounty{value: 1 ether}("Task", "Desc", "Req", 1 days);

        // Claim
        vm.prank(claimer);
        escrow.claimBounty(0);
        assertEq(uint8(escrow.getBounty(0).status), uint8(BountyEscrow.Status.Claimed));

        // Submit proof
        vm.prank(claimer);
        escrow.submitProof(0, "https://github.com/claimer/proof");
        assertEq(uint8(escrow.getBounty(0).status), uint8(BountyEscrow.Status.Submitted));

        // Approve — payment released
        uint256 claimerBefore = claimer.balance;
        vm.prank(poster);
        escrow.approveBounty(0);
        assertEq(uint8(escrow.getBounty(0).status), uint8(BountyEscrow.Status.Completed));
        assertEq(claimer.balance, claimerBefore + 1 ether);
    }

    function test_CancelOpenBounty() public {
        vm.prank(poster);
        escrow.postBounty{value: 1 ether}("Task", "Desc", "Req", 1 days);
        uint256 before = poster.balance;
        vm.prank(poster);
        escrow.cancelBounty(0);
        assertEq(poster.balance, before + 1 ether);
        assertEq(uint8(escrow.getBounty(0).status), uint8(BountyEscrow.Status.Cancelled));
    }

    function test_RefundExpiredBounty() public {
        vm.prank(poster);
        escrow.postBounty{value: 1 ether}("Task", "Desc", "Req", 1 days);
        vm.prank(claimer);
        escrow.claimBounty(0);

        // Fast-forward past deadline
        vm.warp(block.timestamp + 2 days);
        uint256 before = poster.balance;
        escrow.refundExpiredBounty(0);
        assertEq(poster.balance, before + 1 ether);
    }

    function test_RevertClaimNonOpen() public {
        vm.prank(poster);
        escrow.postBounty{value: 1 ether}("Task", "Desc", "Req", 1 days);
        vm.prank(claimer);
        escrow.claimBounty(0);
        // Second claim should revert
        vm.prank(makeAddr("other"));
        vm.expectRevert(BountyEscrow.BountyNotOpen.selector);
        escrow.claimBounty(0);
    }

    function test_RevertDeadlinePassed() public {
        vm.prank(poster);
        escrow.postBounty{value: 1 ether}("Task", "Desc", "Req", 1 days);
        vm.warp(block.timestamp + 2 days);
        vm.prank(claimer);
        vm.expectRevert(BountyEscrow.DeadlinePassed.selector);
        escrow.claimBounty(0);
    }

    function test_RevertApproveByNonPoster() public {
        vm.prank(poster);
        escrow.postBounty{value: 1 ether}("Task", "Desc", "Req", 1 days);
        vm.prank(claimer);
        escrow.claimBounty(0);
        vm.prank(claimer);
        escrow.submitProof(0, "https://proof.url");
        vm.prank(claimer); // wrong caller
        vm.expectRevert(BountyEscrow.NotPoster.selector);
        escrow.approveBounty(0);
    }

    function test_GetOpenBounties() public {
        vm.startPrank(poster);
        escrow.postBounty{value: 1 ether}("Task A", "Desc", "Req", 1 days);
        escrow.postBounty{value: 2 ether}("Task B", "Desc", "Req", 1 days);
        escrow.postBounty{value: 3 ether}("Task C", "Desc", "Req", 1 days);
        vm.stopPrank();

        (BountyEscrow.Bounty[] memory results, uint256 total) = escrow.getOpenBounties(0, 10);
        assertEq(total, 3);
        assertEq(results.length, 3);
    }

    function test_ZeroAmountReverts() public {
        vm.prank(poster);
        vm.expectRevert(BountyEscrow.InvalidAmount.selector);
        escrow.postBounty{value: 0}("Task", "Desc", "Req", 1 days);
    }

    function test_InvalidDeadlineReverts() public {
        vm.prank(poster);
        vm.expectRevert(BountyEscrow.InvalidDeadline.selector);
        escrow.postBounty{value: 1 ether}("Task", "Desc", "Req", 30 minutes); // too short
    }
}
