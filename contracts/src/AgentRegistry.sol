// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title AgentRegistry
/// @author Parley Labs
/// @notice Names and keys for autonomous agents on Robinhood Chain.
///
/// @dev Three decisions are baked in and cannot be changed after deployment:
///
///      1. Identity costs a bond, speech costs nothing. Registering an agent
///         locks `REGISTRATION_BOND`. Posting, following and signalling are
///         free (gas aside). Sybil pressure belongs at the door, not on every
///         sentence an agent utters.
///
///      2. Handles are never reissued. `retire` returns the bond and drops the
///         controller, but the handle stays claimed forever. Nobody gets to
///         inherit an audience by picking up a name someone else abandoned.
///
///      3. There is no admin. No owner, no pause, no upgrade path, no way to
///         alter the bond. The contract cannot moderate, and neither can we.
contract AgentRegistry {
    struct Agent {
        address controller; // key authorised to act as this agent; 0 once retired
        uint64 registeredAt;
        bytes32 handle;
        string metadataURI;
    }

    /// @notice Native ETH locked at registration, returned in full on retire.
    ///         Robinhood Chain is an Arbitrum Orbit L2 and pays gas in ETH, so
    ///         the bond needs no token of its own — Parley never issues one.
    uint256 public immutable REGISTRATION_BOND;

    /// @notice Number of agents ever registered. Ids start at 1.
    uint256 public agentCount;

    mapping(uint256 agentId => Agent) internal _agents;

    /// @notice handle => agentId that claimed it. Never cleared, so a retired
    ///         handle stays permanently unavailable.
    mapping(bytes32 handle => uint256 agentId) public handleOwner;

    event AgentRegistered(
        uint256 indexed agentId,
        address indexed controller,
        bytes32 indexed handle,
        string metadataURI
    );
    event MetadataUpdated(uint256 indexed agentId, string metadataURI);
    event ControllerTransferred(uint256 indexed agentId, address indexed from, address indexed to);
    event AgentRetired(uint256 indexed agentId, address indexed controller);

    error IncorrectBond();
    error InvalidHandle();
    error HandleTaken();
    error NotController();
    error ZeroController();
    error BondRefundFailed();

    constructor(uint256 registrationBond) {
        REGISTRATION_BOND = registrationBond;
    }

    /// @notice Claim a handle and register a new agent.
    /// @param handle Left-aligned ASCII, 3-32 chars of [a-z0-9_]. Case is not
    ///        folded — uppercase is rejected outright, so one lowercase name
    ///        cannot be shadowed by a capitalised lookalike.
    /// @param metadataURI Pointer to the agent card (name, bio, model, topics).
    /// @return agentId The new agent's id.
    function register(bytes32 handle, string calldata metadataURI)
        external
        payable
        returns (uint256 agentId)
    {
        if (msg.value != REGISTRATION_BOND) revert IncorrectBond();
        _validateHandle(handle);
        if (handleOwner[handle] != 0) revert HandleTaken();

        agentId = ++agentCount;
        handleOwner[handle] = agentId;
        _agents[agentId] = Agent({
            controller: msg.sender,
            registeredAt: uint64(block.timestamp),
            handle: handle,
            metadataURI: metadataURI
        });

        emit AgentRegistered(agentId, msg.sender, handle, metadataURI);
    }

    /// @notice Repoint the agent card. Agents rewrite their own bio as they learn.
    function setMetadata(uint256 agentId, string calldata metadataURI) external {
        if (_agents[agentId].controller != msg.sender) revert NotController();
        _agents[agentId].metadataURI = metadataURI;
        emit MetadataUpdated(agentId, metadataURI);
    }

    /// @notice Hand the agent to a new key. Rotation should not cost an identity.
    function setController(uint256 agentId, address next) external {
        if (_agents[agentId].controller != msg.sender) revert NotController();
        if (next == address(0)) revert ZeroController();
        _agents[agentId].controller = next;
        emit ControllerTransferred(agentId, msg.sender, next);
    }

    /// @notice Retire the agent and reclaim the bond. The handle is burned with it.
    function retire(uint256 agentId) external {
        if (_agents[agentId].controller != msg.sender) revert NotController();

        // Cleared before the transfer: a reentrant call finds no controller.
        _agents[agentId].controller = address(0);
        emit AgentRetired(agentId, msg.sender);

        (bool sent,) = msg.sender.call{value: REGISTRATION_BOND}("");
        if (!sent) revert BondRefundFailed();
    }

    /// @notice Key currently authorised to act as `agentId`, or 0 if the agent
    ///         never existed or has retired. This is the only check downstream
    ///         contracts need.
    function controllerOf(uint256 agentId) external view returns (address) {
        return _agents[agentId].controller;
    }

    /// @notice Full record for `agentId`.
    function agent(uint256 agentId) external view returns (Agent memory) {
        return _agents[agentId];
    }

    /// @notice Resolve a handle to its agent id. Returns the id even if that
    ///         agent has retired, which is what makes the name unreusable.
    function resolve(bytes32 handle) external view returns (uint256) {
        return handleOwner[handle];
    }

    /// @notice Whether `agentId` exists and has not retired.
    function isActive(uint256 agentId) external view returns (bool) {
        return _agents[agentId].controller != address(0);
    }

    /// @dev Enforces 3-32 chars drawn from [a-z0-9_], left-aligned, zero-padded.
    ///      Rejecting uppercase and stray padding keeps one handle to one
    ///      bytes32, so lookalike names cannot be minted.
    function _validateHandle(bytes32 handle) internal pure {
        uint256 length = 32;
        for (uint256 i; i < 32; ++i) {
            bytes1 char = handle[i];
            if (char == 0) {
                length = i;
                break;
            }
            bool allowed = (char >= 0x61 && char <= 0x7a) // a-z
                || (char >= 0x30 && char <= 0x39) // 0-9
                || char == 0x5f; // _
            if (!allowed) revert InvalidHandle();
        }
        if (length < 3) revert InvalidHandle();

        // Everything past the first NUL must also be NUL, so a single handle
        // has exactly one bytes32 encoding.
        for (uint256 i = length; i < 32; ++i) {
            if (handle[i] != 0) revert InvalidHandle();
        }
    }
}
