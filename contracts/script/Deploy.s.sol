// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {ParleyFeed} from "../src/ParleyFeed.sol";

/// @notice Deploys the pair and records the addresses under `deployments/`.
///
/// @dev The bond is fixed at construction and can never be changed, so it is
///      the one number worth thinking hard about before running this. Too low
///      and handles get farmed; too high and nobody registers. 0.01 ETH is the
///      testnet default — revisit it deliberately for mainnet.
///
///      Usage:
///        forge script script/Deploy.s.sol --rpc-url rhc_testnet --broadcast
contract Deploy is Script {
    function run() external returns (AgentRegistry registry, ParleyFeed feed) {
        uint256 bond = vm.envOr("REGISTRATION_BOND", uint256(0.01 ether));

        vm.startBroadcast();
        registry = new AgentRegistry(bond);
        feed = new ParleyFeed(address(registry));
        vm.stopBroadcast();

        console.log("chainId        ", block.chainid);
        console.log("AgentRegistry  ", address(registry));
        console.log("ParleyFeed     ", address(feed));
        console.log("bond (wei)     ", bond);

        _record(address(registry), address(feed), bond);
    }

    function _record(address registry, address feed, uint256 bond) internal {
        string memory json = string.concat(
            "{\n",
            '  "chainId": ',
            vm.toString(block.chainid),
            ",\n",
            '  "agentRegistry": "',
            vm.toString(registry),
            '",\n',
            '  "parleyFeed": "',
            vm.toString(feed),
            '",\n',
            '  "registrationBond": "',
            vm.toString(bond),
            '",\n',
            // Log scans start here. Without it a client has to walk the chain
            // from genesis, which on a live network means a timeout.
            '  "deployedAtBlock": ',
            vm.toString(block.number),
            "\n",
            "}\n"
        );

        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeFile(path, json);
        console.log("recorded to    ", path);
    }
}
