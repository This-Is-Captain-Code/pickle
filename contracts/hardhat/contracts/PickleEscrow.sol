// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/// @title PickleEscrow — robots hire humans.
/// @notice A robot's agent posts a bounty paid from the robot's escrowed balance; a World-verified
///         human claims it; the agent settles (pays the worker) once 0G Compute verifies the fix,
///         recording the compute request ID and the 0G Storage root of the evidence.
///
/// Lifecycle:  Open --claim--> Claimed --settle--> Settled
///               |                 \--expire (after claimedAt + claimWindow)--> Expired
///               \--cancel--> Cancelled
///
/// Pause blocks every path that sends native tokens out (settle, withdraw) and the creation of new
/// obligations (postBounty, claim). cancel, expire and fund stay available: they only move value
/// back into a robot's internal balance or into the contract.
contract PickleEscrow {
    // ───────────────────────────── types ─────────────────────────────
    enum Status {
        None,
        Open,
        Claimed,
        Settled,
        Expired,
        Cancelled
    }

    struct Robot {
        address agent; // zero = not registered
        uint256 balance; // un-escrowed funds available for new bounties
    }

    struct Bounty {
        address robot;
        uint128 payout;
        uint64 claimWindow; // seconds the claimer has to deliver, counted from claim
        uint64 deadline; // set at claim: claimedAt + claimWindow
        address worker;
        bytes32 humanHash;
        Status status;
    }

    // ───────────────────────────── errors ────────────────────────────
    error NotOwner();
    error NotRobotAgent();
    error RobotNotRegistered();
    error ZeroAddress();
    error ZeroAmount();
    error PayoutTooHigh(uint256 payout, uint256 maxPayout);
    error InsufficientBalance(uint256 available, uint256 required);
    error InvalidClaimWindow();
    error InvalidHumanHash();
    error BountyNotFound();
    error BountyNotOpen();
    error NotClaimed();
    error ClaimExpired();
    error ClaimNotExpired();
    error AlreadySettled();
    error HumanAlreadyClaimed();
    error Paused();
    error NotPaused();
    error TransferFailed();
    error Reentrancy();

    // ───────────────────────────── events ────────────────────────────
    event RobotRegistered(address indexed robot, address indexed agent);
    event RobotFunded(address indexed robot, address indexed from, uint256 amount, uint256 newBalance);
    event RobotWithdrawn(address indexed robot, address indexed to, uint256 amount, uint256 newBalance);
    event BountyPosted(uint256 indexed bountyId, address indexed robot, uint256 payout, uint64 claimWindow);
    event BountyClaimed(uint256 indexed bountyId, address indexed worker, bytes32 indexed humanHash, uint64 deadline);
    event BountySettled(
        uint256 indexed bountyId,
        address indexed worker,
        uint256 payout,
        string computeRequestId,
        bytes32 storageRoot
    );
    event BountyExpired(uint256 indexed bountyId, address indexed caller, uint256 refunded);
    event BountyCancelled(uint256 indexed bountyId, uint256 refunded);
    event MaxPayoutSet(uint256 oldMax, uint256 newMax);
    event ContractPaused(address indexed by);
    event ContractUnpaused(address indexed by);

    // ───────────────────────────── storage ───────────────────────────
    uint64 public constant MAX_CLAIM_WINDOW = 30 days;

    address public immutable owner;
    uint256 public maxPayout;
    bool public paused;
    uint256 public nextBountyId = 1;

    mapping(address => Robot) public robots;
    mapping(uint256 => Bounty) public bounties;
    /// bountyId => humanHash => has ever claimed. Never cleared.
    mapping(uint256 => mapping(bytes32 => bool)) public hasClaimed;

    uint256 private _lock = 1;

    constructor(uint256 maxPayout_) {
        owner = msg.sender;
        maxPayout = maxPayout_;
        emit MaxPayoutSet(0, maxPayout_);
    }

    // ───────────────────────────── modifiers ─────────────────────────
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    function _bounty(uint256 bountyId) private view returns (Bounty storage b) {
        b = bounties[bountyId];
        if (b.status == Status.None) revert BountyNotFound();
    }

    function _onlyAgentOf(address robot) private view {
        address agent = robots[robot].agent;
        if (agent == address(0)) revert RobotNotRegistered();
        if (msg.sender != agent) revert NotRobotAgent();
    }

    // ───────────────────────────── owner ─────────────────────────────
    /// @notice Register a robot or rotate its agent. Keeps any existing balance.
    function registerRobot(address robot, address agent) external onlyOwner {
        if (robot == address(0) || agent == address(0)) revert ZeroAddress();
        robots[robot].agent = agent;
        emit RobotRegistered(robot, agent);
    }

    function setMaxPayout(uint256 newMax) external onlyOwner {
        emit MaxPayoutSet(maxPayout, newMax);
        maxPayout = newMax;
    }

    function pause() external onlyOwner {
        if (paused) revert Paused();
        paused = true;
        emit ContractPaused(msg.sender);
    }

    function unpause() external onlyOwner {
        if (!paused) revert NotPaused();
        paused = false;
        emit ContractUnpaused(msg.sender);
    }

    // ───────────────────────────── funding ───────────────────────────
    /// @notice Anyone can top up a registered robot's balance.
    function fund(address robot) external payable {
        if (msg.value == 0) revert ZeroAmount();
        Robot storage r = robots[robot];
        if (r.agent == address(0)) revert RobotNotRegistered();
        r.balance += msg.value;
        emit RobotFunded(robot, msg.sender, msg.value, r.balance);
    }

    /// @notice The robot's agent withdraws un-escrowed balance. Blocked while paused.
    function withdraw(address robot, address payable to, uint256 amount) external whenNotPaused nonReentrant {
        _onlyAgentOf(robot);
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        Robot storage r = robots[robot];
        if (r.balance < amount) revert InsufficientBalance(r.balance, amount);
        r.balance -= amount;
        emit RobotWithdrawn(robot, to, amount, r.balance);
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ───────────────────────────── bounties ──────────────────────────
    function postBounty(address robot, uint256 payout, uint64 claimWindow)
        external
        whenNotPaused
        returns (uint256 bountyId)
    {
        _onlyAgentOf(robot);
        if (payout == 0) revert ZeroAmount();
        if (payout > maxPayout) revert PayoutTooHigh(payout, maxPayout);
        if (claimWindow == 0 || claimWindow > MAX_CLAIM_WINDOW) revert InvalidClaimWindow();
        Robot storage r = robots[robot];
        if (r.balance < payout) revert InsufficientBalance(r.balance, payout);

        r.balance -= payout;
        bountyId = nextBountyId++;
        bounties[bountyId] = Bounty({
            robot: robot,
            payout: uint128(payout),
            claimWindow: claimWindow,
            deadline: 0,
            worker: address(0),
            humanHash: bytes32(0),
            status: Status.Open
        });
        emit BountyPosted(bountyId, robot, payout, claimWindow);
    }

    /// @param humanHash hash of the claimer's World identity (scoped per bounty by the agent).
    function claim(uint256 bountyId, address worker, bytes32 humanHash) external whenNotPaused {
        Bounty storage b = _bounty(bountyId);
        _onlyAgentOf(b.robot);
        if (worker == address(0)) revert ZeroAddress();
        if (humanHash == bytes32(0)) revert InvalidHumanHash();
        if (hasClaimed[bountyId][humanHash]) revert HumanAlreadyClaimed();
        if (b.status != Status.Open) revert BountyNotOpen();

        uint64 deadline = uint64(block.timestamp) + b.claimWindow;
        hasClaimed[bountyId][humanHash] = true;
        b.worker = worker;
        b.humanHash = humanHash;
        b.deadline = deadline;
        b.status = Status.Claimed;
        emit BountyClaimed(bountyId, worker, humanHash, deadline);
    }

    /// @notice Pay the worker once the fix is verified.
    /// @param computeRequestId 0G Compute request ID of the verification inference.
    /// @param storageRoot 0G Storage root hash of the episode evidence.
    function settle(uint256 bountyId, string calldata computeRequestId, bytes32 storageRoot)
        external
        whenNotPaused
        nonReentrant
    {
        Bounty storage b = _bounty(bountyId);
        _onlyAgentOf(b.robot);
        if (b.status == Status.Settled) revert AlreadySettled();
        if (b.status != Status.Claimed) revert NotClaimed();
        if (block.timestamp > b.deadline) revert ClaimExpired();

        // effects
        b.status = Status.Settled;
        address worker = b.worker;
        uint256 payout = b.payout;
        emit BountySettled(bountyId, worker, payout, computeRequestId, storageRoot);
        // interaction
        (bool ok, ) = payable(worker).call{value: payout}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Anyone may expire a claim whose window has passed; escrow returns to the robot.
    function expire(uint256 bountyId) external {
        Bounty storage b = _bounty(bountyId);
        if (b.status == Status.Settled) revert AlreadySettled();
        if (b.status != Status.Claimed) revert NotClaimed();
        if (block.timestamp <= b.deadline) revert ClaimNotExpired();

        b.status = Status.Expired;
        robots[b.robot].balance += b.payout;
        emit BountyExpired(bountyId, msg.sender, b.payout);
    }

    /// @notice The robot's agent cancels an unclaimed bounty; escrow returns to the robot.
    function cancel(uint256 bountyId) external {
        Bounty storage b = _bounty(bountyId);
        _onlyAgentOf(b.robot);
        if (b.status != Status.Open) revert BountyNotOpen();

        b.status = Status.Cancelled;
        robots[b.robot].balance += b.payout;
        emit BountyCancelled(bountyId, b.payout);
    }

    // ───────────────────────────── views ─────────────────────────────
    function getBounty(uint256 bountyId) external view returns (Bounty memory) {
        return bounties[bountyId];
    }

    function robotBalance(address robot) external view returns (uint256) {
        return robots[robot].balance;
    }
}
