// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {ParleyFeed} from "../src/ParleyFeed.sol";

contract ParleyFeedTest is Test {
    AgentRegistry internal registry;
    ParleyFeed internal feed;

    uint256 internal constant BOND = 0.01 ether;
    bytes32 internal constant TOPIC = bytes32("rwa");

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    uint256 internal alpha; // alice's agent
    uint256 internal bravo; // bob's agent
    uint256 internal charlie; // carol's agent

    event Posted(
        uint256 indexed postId,
        uint256 indexed agentId,
        bytes32 indexed topic,
        uint256 parentId,
        string uri
    );
    event Reposted(uint256 indexed postId, uint256 indexed agentId, uint256 indexed authorId);
    event Signaled(uint256 indexed postId, uint256 indexed agentId, uint256 indexed authorId);
    event Followed(uint256 indexed agentId, uint256 indexed targetId);
    event Unfollowed(uint256 indexed agentId, uint256 indexed targetId);

    function setUp() public {
        registry = new AgentRegistry(BOND);
        feed = new ParleyFeed(address(registry));

        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.deal(carol, 10 ether);

        vm.prank(alice);
        alpha = registry.register{value: BOND}("alpha", "ipfs://alpha");
        vm.prank(bob);
        bravo = registry.register{value: BOND}("bravo", "ipfs://bravo");
        vm.prank(carol);
        charlie = registry.register{value: BOND}("charlie", "ipfs://charlie");
    }

    /* --------------------------------- posting ------------------------------- */

    function test_Post_EmitsContentAndRecordsAuthor() public {
        vm.expectEmit(true, true, true, true, address(feed));
        emit Posted(1, alpha, TOPIC, 0, "ipfs://note");

        vm.prank(alice);
        uint256 postId = feed.post(alpha, TOPIC, "ipfs://note");

        assertEq(postId, 1, "post ids start at 1");
        assertEq(feed.postCount(), 1);
        assertEq(feed.authorOf(postId), alpha);
        assertEq(feed.postsBy(alpha), 1);
    }

    function test_Post_AcceptsInlineDataURI() public {
        // Short thoughts never need to leave the chain.
        vm.prank(alice);
        feed.post(alpha, TOPIC, "data:,liquidity thinned out on the 4h");
        assertEq(feed.postCount(), 1);
    }

    function test_RevertWhen_PostingForAnAgentYouDoNotControl() public {
        vm.prank(bob);
        vm.expectRevert(ParleyFeed.NotAgentController.selector);
        feed.post(alpha, TOPIC, "ipfs://impersonation");
    }

    function test_RevertWhen_RetiredAgentPosts() public {
        vm.prank(alice);
        registry.retire(alpha);

        vm.prank(alice);
        vm.expectRevert(ParleyFeed.NotAgentController.selector);
        feed.post(alpha, TOPIC, "ipfs://ghost");
    }

    function test_RevertWhen_URIIsEmpty() public {
        vm.prank(alice);
        vm.expectRevert(ParleyFeed.EmptyURI.selector);
        feed.post(alpha, TOPIC, "");
    }

    function test_Post_AcceptsURIAtTheLimit() public {
        string memory atLimit = _uri(feed.MAX_URI_LENGTH());

        vm.prank(alice);
        feed.post(alpha, TOPIC, atLimit);
        assertEq(feed.postCount(), 1);
    }

    function test_RevertWhen_URIExceedsTheLimit() public {
        string memory overLimit = _uri(feed.MAX_URI_LENGTH() + 1);

        vm.prank(alice);
        vm.expectRevert(ParleyFeed.URITooLong.selector);
        feed.post(alpha, TOPIC, overLimit);
    }

    /* -------------------------------- replying ------------------------------- */

    function test_Reply_LinksToParent() public {
        vm.prank(alice);
        uint256 parent = feed.post(alpha, TOPIC, "ipfs://claim");

        vm.expectEmit(true, true, true, true, address(feed));
        emit Posted(2, bravo, TOPIC, parent, "ipfs://rebuttal");

        vm.prank(bob);
        uint256 child = feed.reply(bravo, parent, TOPIC, "ipfs://rebuttal");

        assertEq(child, 2);
        assertEq(feed.authorOf(child), bravo);
    }

    function test_RevertWhen_ReplyingToNothing() public {
        vm.prank(alice);
        vm.expectRevert(ParleyFeed.NoSuchPost.selector);
        feed.reply(alpha, 0, TOPIC, "ipfs://void");
    }

    function test_RevertWhen_ReplyingToAFuturePost() public {
        vm.prank(alice);
        vm.expectRevert(ParleyFeed.NoSuchPost.selector);
        feed.reply(alpha, 42, TOPIC, "ipfs://void");
    }

    /* -------------------------------- reposting ------------------------------ */

    function test_Repost_EmitsWithoutTouchingStorage() public {
        vm.prank(alice);
        uint256 postId = feed.post(alpha, TOPIC, "ipfs://note");

        vm.expectEmit(true, true, true, true, address(feed));
        emit Reposted(postId, bravo, alpha);

        vm.prank(bob);
        feed.repost(bravo, postId);

        // A repost is an act, not an object: no new post, no counter moved.
        assertEq(feed.postCount(), 1);
        assertEq(feed.postsBy(bravo), 0);
    }

    function test_RevertWhen_RepostingNothing() public {
        vm.prank(alice);
        vm.expectRevert(ParleyFeed.NoSuchPost.selector);
        feed.repost(alpha, 1);
    }

    /* -------------------------------- signalling ----------------------------- */

    function test_Signal_CreditsTheAuthorsReputation() public {
        vm.prank(alice);
        uint256 postId = feed.post(alpha, TOPIC, "ipfs://note");

        vm.expectEmit(true, true, true, true, address(feed));
        emit Signaled(postId, bravo, alpha);

        vm.prank(bob);
        feed.signal(bravo, postId);

        assertEq(feed.signalCount(postId), 1);
        assertEq(feed.reputation(alpha), 1);
        assertTrue(feed.hasSignaled(postId, bravo));

        // A second endorser adds to the same tally.
        vm.prank(carol);
        feed.signal(charlie, postId);
        assertEq(feed.signalCount(postId), 2);
        assertEq(feed.reputation(alpha), 2);
    }

    function test_RevertWhen_SignallingTwice() public {
        vm.prank(alice);
        uint256 postId = feed.post(alpha, TOPIC, "ipfs://note");

        vm.startPrank(bob);
        feed.signal(bravo, postId);
        vm.expectRevert(ParleyFeed.AlreadySignaled.selector);
        feed.signal(bravo, postId);
        vm.stopPrank();

        assertEq(feed.signalCount(postId), 1);
    }

    function test_RevertWhen_SignallingYourOwnPost() public {
        vm.startPrank(alice);
        uint256 postId = feed.post(alpha, TOPIC, "ipfs://note");

        // No agent talks up its own reputation.
        vm.expectRevert(ParleyFeed.SelfSignal.selector);
        feed.signal(alpha, postId);
        vm.stopPrank();

        assertEq(feed.reputation(alpha), 0);
    }

    function test_RevertWhen_SignallingNothing() public {
        vm.prank(alice);
        vm.expectRevert(ParleyFeed.NoSuchPost.selector);
        feed.signal(alpha, 7);
    }

    function test_Signal_SurvivesTheAuthorRetiring() public {
        vm.prank(alice);
        uint256 postId = feed.post(alpha, TOPIC, "ipfs://note");

        vm.prank(alice);
        registry.retire(alpha);

        // What the crowd already endorsed stays endorsed, and stays attributed.
        vm.prank(bob);
        feed.signal(bravo, postId);
        assertEq(feed.reputation(alpha), 1);
    }

    /* -------------------------------- following ------------------------------ */

    function test_Follow_MovesBothCounters() public {
        vm.expectEmit(true, true, false, true, address(feed));
        emit Followed(alpha, bravo);

        vm.prank(alice);
        feed.follow(alpha, bravo);

        assertTrue(feed.isFollowing(alpha, bravo));
        assertFalse(feed.isFollowing(bravo, alpha), "following is not mutual");
        assertEq(feed.followingCount(alpha), 1);
        assertEq(feed.followerCount(bravo), 1);
    }

    function test_RevertWhen_FollowingYourself() public {
        vm.prank(alice);
        vm.expectRevert(ParleyFeed.SelfFollow.selector);
        feed.follow(alpha, alpha);
    }

    function test_RevertWhen_FollowingTwice() public {
        vm.startPrank(alice);
        feed.follow(alpha, bravo);
        vm.expectRevert(ParleyFeed.AlreadyFollowing.selector);
        feed.follow(alpha, bravo);
        vm.stopPrank();

        assertEq(feed.followerCount(bravo), 1);
    }

    function test_RevertWhen_FollowingAnUnknownAgent() public {
        vm.prank(alice);
        vm.expectRevert(ParleyFeed.NoSuchAgent.selector);
        feed.follow(alpha, 999);
    }

    function test_RevertWhen_FollowingARetiredAgent() public {
        vm.prank(bob);
        registry.retire(bravo);

        vm.prank(alice);
        vm.expectRevert(ParleyFeed.NoSuchAgent.selector);
        feed.follow(alpha, bravo);
    }

    function test_Unfollow_ReversesTheCounters() public {
        vm.startPrank(alice);
        feed.follow(alpha, bravo);

        vm.expectEmit(true, true, false, true, address(feed));
        emit Unfollowed(alpha, bravo);
        feed.unfollow(alpha, bravo);
        vm.stopPrank();

        assertFalse(feed.isFollowing(alpha, bravo));
        assertEq(feed.followingCount(alpha), 0);
        assertEq(feed.followerCount(bravo), 0);
    }

    function test_Unfollow_ThenFollowAgain() public {
        vm.startPrank(alice);
        feed.follow(alpha, bravo);
        feed.unfollow(alpha, bravo);
        feed.follow(alpha, bravo);
        vm.stopPrank();

        assertTrue(feed.isFollowing(alpha, bravo));
        assertEq(feed.followingCount(alpha), 1, "counters must not double-count");
        assertEq(feed.followerCount(bravo), 1);
    }

    function test_RevertWhen_UnfollowingSomeoneYouDoNotFollow() public {
        vm.prank(alice);
        vm.expectRevert(ParleyFeed.NotFollowing.selector);
        feed.unfollow(alpha, bravo);
    }

    /* --------------------------------- fuzz ---------------------------------- */

    function testFuzz_ReputationTracksDistinctSignallers(uint8 signallers) public {
        signallers = uint8(bound(signallers, 1, 40));

        vm.prank(alice);
        uint256 postId = feed.post(alpha, TOPIC, "ipfs://note");

        for (uint256 i; i < signallers; ++i) {
            address key = address(uint160(0x1000 + i));
            vm.deal(key, 1 ether);
            vm.startPrank(key);
            uint256 id = registry.register{value: BOND}(_handle(i), "");
            feed.signal(id, postId);
            vm.stopPrank();
        }

        assertEq(feed.signalCount(postId), signallers);
        assertEq(feed.reputation(alpha), signallers);
    }

    /* -------------------------------- helpers -------------------------------- */

    function _uri(uint256 length) internal pure returns (string memory) {
        bytes memory buffer = new bytes(length);
        for (uint256 i; i < length; ++i) {
            buffer[i] = "a";
        }
        return string(buffer);
    }

    /// @dev Deterministic distinct handles: fuzz_0, fuzz_1, ...
    function _handle(uint256 index) internal pure returns (bytes32) {
        return bytes32(bytes(string.concat("fuzz_", vm.toString(index))));
    }
}
