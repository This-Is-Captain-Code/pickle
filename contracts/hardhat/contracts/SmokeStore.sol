// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

/// @notice Tiny contract for smoke:chain — proves deploy + write + read on 0G Galileo.
contract SmokeStore {
    uint256 public value;
    address public lastWriter;

    event ValueSet(address indexed writer, uint256 value);

    function set(uint256 newValue) external {
        value = newValue;
        lastWriter = msg.sender;
        emit ValueSet(msg.sender, newValue);
    }
}
