// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title BountyEscrow
 * @notice Autonomous agent labor market on X Layer.
 *         Agents post tasks with OKB locked in escrow.
 *         Other agents claim, complete, and collect — no humans required.
 */
contract BountyEscrow {
    enum Status { Open, Claimed, Submitted, Completed, Cancelled, Disputed }

    struct Bounty {
        uint256 id;
        address poster;
        uint256 amount;
        string title;
        string description;
        string requirements;
        address claimer;
        Status status;
        uint256 deadline;
        string proof;
        uint256 createdAt;
        uint256 completedAt;
    }

    uint256 public bountyCount;
    mapping(uint256 => Bounty) public bounties;
    mapping(address => uint256[]) public posterBounties;
    mapping(address => uint256[]) public claimerBounties;

    uint256 public constant MIN_DEADLINE = 1 hours;
    uint256 public constant MAX_DEADLINE = 30 days;
    uint256 public constant DISPUTE_WINDOW = 24 hours;

    event BountyPosted(uint256 indexed id, address indexed poster, uint256 amount, string title, uint256 deadline);
    event BountyClaimed(uint256 indexed id, address indexed claimer);
    event ProofSubmitted(uint256 indexed id, address indexed claimer, string proof);
    event BountyCompleted(uint256 indexed id, address indexed claimer, uint256 amount);
    event BountyCancelled(uint256 indexed id, address indexed poster, uint256 refund);
    event BountyDisputed(uint256 indexed id, address indexed poster);
    event DeadlineExpiredRefund(uint256 indexed id, address indexed poster, uint256 refund);

    error InvalidAmount();
    error InvalidDeadline();
    error BountyNotOpen();
    error BountyNotClaimed();
    error BountyNotSubmitted();
    error NotPoster();
    error NotClaimer();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error AlreadyClaimed();

    function postBounty(
        string calldata title,
        string calldata description,
        string calldata requirements,
        uint256 deadlineDuration
    ) external payable returns (uint256 id) {
        if (msg.value == 0) revert InvalidAmount();
        if (deadlineDuration < MIN_DEADLINE || deadlineDuration > MAX_DEADLINE) revert InvalidDeadline();

        id = bountyCount++;
        bounties[id] = Bounty({
            id: id,
            poster: msg.sender,
            amount: msg.value,
            title: title,
            description: description,
            requirements: requirements,
            claimer: address(0),
            status: Status.Open,
            deadline: block.timestamp + deadlineDuration,
            proof: "",
            createdAt: block.timestamp,
            completedAt: 0
        });

        posterBounties[msg.sender].push(id);
        emit BountyPosted(id, msg.sender, msg.value, title, block.timestamp + deadlineDuration);
    }

    function claimBounty(uint256 id) external {
        Bounty storage b = bounties[id];
        if (b.status != Status.Open) revert BountyNotOpen();
        if (block.timestamp >= b.deadline) revert DeadlinePassed();
        if (b.claimer != address(0)) revert AlreadyClaimed();

        b.claimer = msg.sender;
        b.status = Status.Claimed;
        claimerBounties[msg.sender].push(id);
        emit BountyClaimed(id, msg.sender);
    }

    function submitProof(uint256 id, string calldata proof) external {
        Bounty storage b = bounties[id];
        if (b.status != Status.Claimed) revert BountyNotClaimed();
        if (msg.sender != b.claimer) revert NotClaimer();

        b.proof = proof;
        b.status = Status.Submitted;
        emit ProofSubmitted(id, msg.sender, proof);
    }

    function approveBounty(uint256 id) external {
        Bounty storage b = bounties[id];
        if (b.status != Status.Submitted) revert BountyNotSubmitted();
        if (msg.sender != b.poster) revert NotPoster();

        b.status = Status.Completed;
        b.completedAt = block.timestamp;
        payable(b.claimer).transfer(b.amount);
        emit BountyCompleted(id, b.claimer, b.amount);
    }

    function disputeBounty(uint256 id) external {
        Bounty storage b = bounties[id];
        if (b.status != Status.Submitted) revert BountyNotSubmitted();
        if (msg.sender != b.poster) revert NotPoster();

        b.status = Status.Disputed;
        emit BountyDisputed(id, msg.sender);
    }

    /// @notice Poster can cancel an open bounty and get a refund
    function cancelBounty(uint256 id) external {
        Bounty storage b = bounties[id];
        if (b.status != Status.Open) revert BountyNotOpen();
        if (msg.sender != b.poster) revert NotPoster();

        b.status = Status.Cancelled;
        uint256 refund = b.amount;
        b.amount = 0;
        payable(b.poster).transfer(refund);
        emit BountyCancelled(id, msg.sender, refund);
    }

    /// @notice Anyone can trigger a refund if deadline passed and bounty is still claimed (claimer didn't submit)
    function refundExpiredBounty(uint256 id) external {
        Bounty storage b = bounties[id];
        if (b.status != Status.Claimed) revert BountyNotClaimed();
        if (block.timestamp < b.deadline) revert DeadlineNotPassed();

        b.status = Status.Cancelled;
        uint256 refund = b.amount;
        b.amount = 0;
        payable(b.poster).transfer(refund);
        emit DeadlineExpiredRefund(id, b.poster, refund);
    }

    // ── View helpers ────────────────────────────────────────────────────────────

    function getBounty(uint256 id) external view returns (Bounty memory) {
        return bounties[id];
    }

    function getOpenBounties(uint256 offset, uint256 limit) external view returns (Bounty[] memory results, uint256 total) {
        uint256 count = 0;
        for (uint256 i = 0; i < bountyCount; i++) {
            if (bounties[i].status == Status.Open && block.timestamp < bounties[i].deadline) count++;
        }
        total = count;

        results = new Bounty[](limit);
        uint256 found = 0;
        uint256 skipped = 0;
        for (uint256 i = 0; i < bountyCount && found < limit; i++) {
            if (bounties[i].status == Status.Open && block.timestamp < bounties[i].deadline) {
                if (skipped < offset) { skipped++; continue; }
                results[found++] = bounties[i];
            }
        }
        assembly { mstore(results, found) }
    }

    function getPosterBounties(address poster) external view returns (uint256[] memory) {
        return posterBounties[poster];
    }

    function getClaimerBounties(address claimer) external view returns (uint256[] memory) {
        return claimerBounties[claimer];
    }
}
