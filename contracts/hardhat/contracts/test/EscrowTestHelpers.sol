// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

// Test-only helpers for PickleEscrow. Never deployed to Galileo.

interface IPickleEscrow {
    function postBounty(address robot, uint256 payout, uint64 claimWindow) external returns (uint256);
    function claim(uint256 bountyId, address worker, bytes32 humanHash) external;
    function settle(uint256 bountyId, string calldata computeRequestId, bytes32 storageRoot) external;
    function withdraw(address robot, address payable to, uint256 amount) external;
}

/// Worker that rejects native transfers → settle must revert with TransferFailed.
contract RejectingReceiver {
    receive() external payable {
        revert("no thanks");
    }
}

/// Acts as a robot's agent AND as the worker. On receiving the payout it tries to re-enter the
/// escrow and records the revert data, so the test can assert the Reentrancy error.
contract ReentrantAgent {
    IPickleEscrow public immutable escrow;
    address public robot;
    bytes public lastRevert;
    bool public attempted;

    constructor(IPickleEscrow escrow_) {
        escrow = escrow_;
    }

    function setRobot(address robot_) external {
        robot = robot_;
    }

    function post(uint256 payout, uint64 window) external returns (uint256) {
        return escrow.postBounty(robot, payout, window);
    }

    function claimSelf(uint256 bountyId, bytes32 humanHash) external {
        escrow.claim(bountyId, address(this), humanHash);
    }

    function settle(uint256 bountyId) external {
        escrow.settle(bountyId, "req", bytes32(0));
    }

    receive() external payable {
        if (attempted) return;
        attempted = true;
        try escrow.withdraw(robot, payable(address(this)), 1) {} catch (bytes memory reason) {
            lastRevert = reason;
        }
    }
}
