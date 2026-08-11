// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";

/// @dev Refuses the bond refund, so we can prove `retire` surfaces the failure
///      instead of silently pocketing the money.
contract Deadbeat {
    function register(AgentRegistry registry, bytes32 handle) external payable returns (uint256) {
        return registry.register{value: msg.value}(handle, "ipfs://card");
    }

    function retire(AgentRegistry registry, uint256 agentId) external {
        registry.retire(agentId);
    }
}

contract AgentRegistryTest is Test {
    AgentRegistry internal registry;

    uint256 internal constant BOND = 0.01 ether;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        registry = new AgentRegistry(BOND);
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    /* ------------------------------ registration ----------------------------- */

    function test_Register_StoresAgentAndLocksBond() public {
        vm.prank(alice);
        uint256 id = registry.register{value: BOND}("alpha", "ipfs://card");

        assertEq(id, 1, "ids start at 1");
        assertEq(registry.agentCount(), 1);
        assertEq(registry.controllerOf(id), alice);
        assertTrue(registry.isActive(id));
        assertEq(registry.resolve("alpha"), id);
        assertEq(address(registry).balance, BOND, "bond is held by the registry");

        AgentRegistry.Agent memory a = registry.agent(id);
        assertEq(a.handle, bytes32("alpha"));
        assertEq(a.metadataURI, "ipfs://card");
        assertEq(a.registeredAt, uint64(block.timestamp));
    }

    function test_Register_AssignsSequentialIds() public {
        vm.prank(alice);
        uint256 first = registry.register{value: BOND}("alpha", "");
        vm.prank(bob);
        uint256 second = registry.register{value: BOND}("bravo", "");

        assertEq(first, 1);
        assertEq(second, 2);
        assertEq(address(registry).balance, 2 * BOND);
    }

    function test_RevertWhen_BondIsUnderpaid() public {
        vm.prank(alice);
        vm.expectRevert(AgentRegistry.IncorrectBond.selector);
        registry.register{value: BOND - 1}("alpha", "");
    }

    function test_RevertWhen_BondIsOverpaid() public {
        // Overpaying is rejected rather than kept: the refund is a fixed amount,
        // so any surplus would be stranded in the contract forever.
        vm.prank(alice);
        vm.expectRevert(AgentRegistry.IncorrectBond.selector);
        registry.register{value: BOND + 1}("alpha", "");
    }

    function test_RevertWhen_HandleIsAlreadyClaimed() public {
        vm.prank(alice);
        registry.register{value: BOND}("alpha", "");

        vm.prank(bob);
        vm.expectRevert(AgentRegistry.HandleTaken.selector);
        registry.register{value: BOND}("alpha", "");
    }

    /* --------------------------- handle validation --------------------------- */

    function test_Register_AcceptsFullLengthHandle() public {
        bytes32 maxed = bytes32("abcdefghij0123456789_abcdefghijk"); // exactly 32
        vm.prank(alice);
        uint256 id = registry.register{value: BOND}(maxed, "");
        assertEq(registry.resolve(maxed), id);
    }

    function test_Register_AcceptsDigitsAndUnderscores() public {
        vm.prank(alice);
        registry.register{value: BOND}("agent_007", "");
        assertEq(registry.resolve("agent_007"), 1);
    }

    function test_RevertWhen_HandleIsTooShort() public {
        vm.prank(alice);
        vm.expectRevert(AgentRegistry.InvalidHandle.selector);
        registry.register{value: BOND}("ab", "");
    }

    function test_RevertWhen_HandleIsEmpty() public {
        vm.prank(alice);
        vm.expectRevert(AgentRegistry.InvalidHandle.selector);
        registry.register{value: BOND}(bytes32(0), "");
    }

    function test_RevertWhen_HandleHasUppercase() public {
        vm.prank(alice);
        vm.expectRevert(AgentRegistry.InvalidHandle.selector);
        registry.register{value: BOND}("Alpha", "");
    }

    function test_RevertWhen_HandleHasPunctuation() public {
        vm.prank(alice);
        vm.expectRevert(AgentRegistry.InvalidHandle.selector);
        registry.register{value: BOND}("al-pha", "");
    }

    function test_RevertWhen_HandleHasSpace() public {
        vm.prank(alice);
        vm.expectRevert(AgentRegistry.InvalidHandle.selector);
        registry.register{value: BOND}("al pha", "");
    }

    function test_RevertWhen_HandleHasBytesAfterTerminator() public {
        // "abc\0x..." — one name must have exactly one bytes32 encoding, or two
        // agents could display as the same handle.
        bytes32 smuggled = bytes32("abc") | bytes32(uint256(0x78) << 216);
        vm.prank(alice);
        vm.expectRevert(AgentRegistry.InvalidHandle.selector);
        registry.register{value: BOND}(smuggled, "");
    }

    /* -------------------------------- metadata ------------------------------- */

    function test_SetMetadata_UpdatesCard() public {
        vm.startPrank(alice);
        uint256 id = registry.register{value: BOND}("alpha", "ipfs://old");
        registry.setMetadata(id, "ipfs://new");
        vm.stopPrank();

        assertEq(registry.agent(id).metadataURI, "ipfs://new");
    }

    function test_RevertWhen_NonControllerSetsMetadata() public {
        vm.prank(alice);
        uint256 id = registry.register{value: BOND}("alpha", "");

        vm.prank(bob);
        vm.expectRevert(AgentRegistry.NotController.selector);
        registry.setMetadata(id, "ipfs://hijacked");
    }

    /* ------------------------------- controller ------------------------------ */

    function test_SetController_MovesAuthority() public {
        vm.prank(alice);
        uint256 id = registry.register{value: BOND}("alpha", "");

        vm.prank(alice);
        registry.setController(id, bob);
        assertEq(registry.controllerOf(id), bob);

        // The new key works...
        vm.prank(bob);
        registry.setMetadata(id, "ipfs://rotated");
        assertEq(registry.agent(id).metadataURI, "ipfs://rotated");

        // ...and the old one is done.
        vm.prank(alice);
        vm.expectRevert(AgentRegistry.NotController.selector);
        registry.setMetadata(id, "ipfs://nope");
    }

    function test_RevertWhen_ControllerSetToZero() public {
        vm.startPrank(alice);
        uint256 id = registry.register{value: BOND}("alpha", "");
        vm.expectRevert(AgentRegistry.ZeroController.selector);
        registry.setController(id, address(0));
        vm.stopPrank();
    }

    /* --------------------------------- retire -------------------------------- */

    function test_Retire_RefundsBondAndDeactivates() public {
        vm.prank(alice);
        uint256 id = registry.register{value: BOND}("alpha", "");
        uint256 balanceBefore = alice.balance;

        vm.prank(alice);
        registry.retire(id);

        assertEq(alice.balance, balanceBefore + BOND, "bond comes back in full");
        assertEq(address(registry).balance, 0);
        assertEq(registry.controllerOf(id), address(0));
        assertFalse(registry.isActive(id));
    }

    function test_Retire_BurnsTheHandleForever() public {
        vm.startPrank(alice);
        uint256 id = registry.register{value: BOND}("alpha", "");
        registry.retire(id);
        vm.stopPrank();

        // The name still resolves to the retired agent, so nobody can pick up
        // its audience by re-registering it.
        assertEq(registry.resolve("alpha"), id);

        vm.prank(bob);
        vm.expectRevert(AgentRegistry.HandleTaken.selector);
        registry.register{value: BOND}("alpha", "");
    }

    function test_RevertWhen_NonControllerRetires() public {
        vm.prank(alice);
        uint256 id = registry.register{value: BOND}("alpha", "");

        vm.prank(bob);
        vm.expectRevert(AgentRegistry.NotController.selector);
        registry.retire(id);
    }

    function test_RevertWhen_RetiringTwice() public {
        vm.startPrank(alice);
        uint256 id = registry.register{value: BOND}("alpha", "");
        registry.retire(id);

        // Double-refund is the one thing that would drain other agents' bonds.
        vm.expectRevert(AgentRegistry.NotController.selector);
        registry.retire(id);
        vm.stopPrank();
    }

    function test_RevertWhen_RefundIsRejected() public {
        Deadbeat deadbeat = new Deadbeat();
        vm.deal(address(deadbeat), 1 ether);

        uint256 id = deadbeat.register{value: BOND}(registry, "robot");

        vm.expectRevert(AgentRegistry.BondRefundFailed.selector);
        deadbeat.retire(registry, id);

        // The revert unwinds everything: the agent is still live.
        assertEq(registry.controllerOf(id), address(deadbeat));
        assertEq(address(registry).balance, BOND);
    }

    function test_RevertWhen_ActingOnUnknownAgent() public {
        vm.prank(alice);
        vm.expectRevert(AgentRegistry.NotController.selector);
        registry.setMetadata(999, "ipfs://ghost");
    }

    /* --------------------------------- fuzz ---------------------------------- */

    function testFuzz_BondMustMatchExactly(uint256 sent) public {
        vm.assume(sent != BOND && sent < 100 ether);
        vm.deal(alice, 200 ether);

        vm.prank(alice);
        vm.expectRevert(AgentRegistry.IncorrectBond.selector);
        registry.register{value: sent}("alpha", "");
    }

    function testFuzz_HandlesAreClaimedOnce(bytes32 handle) public {
        // Only exercise handles the validator accepts; malformed input is
        // covered by the targeted reverts above.
        vm.prank(alice);
        try registry.register{value: BOND}(handle, "") returns (uint256 id) {
            assertEq(registry.resolve(handle), id);

            vm.prank(bob);
            vm.expectRevert(AgentRegistry.HandleTaken.selector);
            registry.register{value: BOND}(handle, "");
        } catch {
            // Rejected by validation — nothing was claimed.
            assertEq(registry.resolve(handle), 0);
        }
    }
}
