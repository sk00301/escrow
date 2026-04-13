// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title HelloEscrow
 * @dev A minimal "Hello World" contract to validate the full dev pipeline.
 *      Stores a greeting and an owner-controlled counter.
 */
contract HelloEscrow is Ownable {
    string public greeting;
    uint256 public counter;

    event GreetingUpdated(string oldGreeting, string newGreeting, address updatedBy);
    event CounterIncremented(uint256 newValue);

    constructor(string memory _greeting) Ownable(msg.sender) {
        greeting = _greeting;
        counter = 0;
    }

    /// @notice Update the greeting string (owner only)
    function setGreeting(string calldata _newGreeting) external onlyOwner {
        string memory old = greeting;
        greeting = _newGreeting;
        emit GreetingUpdated(old, _newGreeting, msg.sender);
    }

    /// @notice Anyone can increment the counter
    function increment() external {
        counter += 1;
        emit CounterIncremented(counter);
    }

    /// @notice Returns both state variables in one call
    function getState() external view returns (string memory, uint256) {
        return (greeting, counter);
    }
}
