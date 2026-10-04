// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title VeyraCasino
/// @notice Holds native zkLTC wagers and pays backend-authorized winnings.
/// @dev Game outcomes are exclusively off-chain. This contract contains no randomness.
contract VeyraCasino is EIP712, Ownable2Step, Pausable, ReentrancyGuard {
    uint256 public constant MIN_WAGER = 0.0005 ether;
    uint256 public constant MAX_WAGER = 1 ether;

    bytes32 public constant CLAIM_AUTHORIZATION_TYPEHASH = keccak256(
        "ClaimAuthorization(address player,uint256 sessionId,uint256 wagerAmount,uint256 payoutAmount,uint256 nonce,uint256 deadline)"
    );

    struct Wager {
        address player;
        uint256 amount;
    }

    struct ClaimAuthorization {
        address player;
        uint256 sessionId;
        uint256 wagerAmount;
        uint256 payoutAmount;
        uint256 nonce;
        uint256 deadline;
    }

    error InvalidSigner();
    error UnauthorizedPendingSigner();
    error InvalidWagerAmount(uint256 amount);
    error InvalidPlayer();
    error UnknownSession(uint256 sessionId);
    error WagerMismatch();
    error InvalidPayout();
    error AuthorizationExpired(uint256 deadline);
    error InvalidAuthorization();
    error NonceAlreadyUsed(uint256 nonce);
    error SessionAlreadyClaimed(uint256 sessionId);
    error InsufficientContractBalance(uint256 available, uint256 required);
    error NativeTransferFailed();

    event WagerPlaced(address indexed player, uint256 indexed sessionId, uint256 amount);
    event WinningsClaimed(
        address indexed player,
        uint256 indexed sessionId,
        uint256 payoutAmount,
        uint256 indexed nonce
    );
    event AuthorizedSignerProposed(address indexed currentSigner, address indexed proposedSigner);
    event AuthorizedSignerUpdated(address indexed previousSigner, address indexed newSigner);
    event TreasuryFunded(address indexed funder, uint256 amount);

    uint256 public nextSessionId = 1;
    address public authorizedSigner;
    address public pendingAuthorizedSigner;
    mapping(uint256 sessionId => Wager wager) public wagers;
    mapping(uint256 nonce => bool used) public usedNonces;
    mapping(uint256 sessionId => bool claimed) public claimedSessions;

    constructor(address initialOwner, address initialAuthorizedSigner)
        payable
        EIP712("VeyraCasino", "1")
        Ownable(initialOwner)
    {
        if (initialAuthorizedSigner == address(0)) revert InvalidSigner();
        authorizedSigner = initialAuthorizedSigner;
        emit AuthorizedSignerUpdated(address(0), initialAuthorizedSigner);
        if (msg.value > 0) emit TreasuryFunded(msg.sender, msg.value);
    }

    /// @notice Places a native zkLTC wager for msg.sender and creates a monotonic session ID.
    function placeWager() external payable whenNotPaused returns (uint256 sessionId) {
        if (msg.value < MIN_WAGER || msg.value > MAX_WAGER) revert InvalidWagerAmount(msg.value);
        sessionId = nextSessionId++;
        wagers[sessionId] = Wager({player: msg.sender, amount: msg.value});
        emit WagerPlaced(msg.sender, sessionId, msg.value);
    }

    /// @notice Claims an EIP-712-authorized payout to the same wallet calling this function.
    function claimWinnings(ClaimAuthorization calldata authorization, bytes calldata signature)
        external
        whenNotPaused
        nonReentrant
    {
        if (authorization.player != msg.sender) revert InvalidPlayer();
        if (block.timestamp > authorization.deadline) revert AuthorizationExpired(authorization.deadline);
        if (authorization.payoutAmount == 0) revert InvalidPayout();
        if (usedNonces[authorization.nonce]) revert NonceAlreadyUsed(authorization.nonce);
        if (claimedSessions[authorization.sessionId]) revert SessionAlreadyClaimed(authorization.sessionId);

        Wager memory wager = wagers[authorization.sessionId];
        if (wager.player == address(0)) revert UnknownSession(authorization.sessionId);
        if (wager.player != msg.sender || wager.amount != authorization.wagerAmount) revert WagerMismatch();

        bytes32 structHash = keccak256(
            abi.encode(
                CLAIM_AUTHORIZATION_TYPEHASH,
                authorization.player,
                authorization.sessionId,
                authorization.wagerAmount,
                authorization.payoutAmount,
                authorization.nonce,
                authorization.deadline
            )
        );
        address recovered = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        if (recovered != authorizedSigner) revert InvalidAuthorization();
        if (address(this).balance < authorization.payoutAmount) {
            revert InsufficientContractBalance(address(this).balance, authorization.payoutAmount);
        }

        // Effects before interaction permanently consume both replay dimensions.
        usedNonces[authorization.nonce] = true;
        claimedSessions[authorization.sessionId] = true;

        (bool sent,) = payable(msg.sender).call{value: authorization.payoutAmount}("");
        if (!sent) revert NativeTransferFailed();

        emit WinningsClaimed(
            msg.sender,
            authorization.sessionId,
            authorization.payoutAmount,
            authorization.nonce
        );
    }

    /// @notice Begins a two-step signer rotation. The proposed signer must accept.
    function proposeAuthorizedSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0) || newSigner == authorizedSigner) revert InvalidSigner();
        pendingAuthorizedSigner = newSigner;
        emit AuthorizedSignerProposed(authorizedSigner, newSigner);
    }

    function acceptAuthorizedSigner() external {
        if (msg.sender != pendingAuthorizedSigner) revert UnauthorizedPendingSigner();
        address previous = authorizedSigner;
        authorizedSigner = msg.sender;
        pendingAuthorizedSigner = address(0);
        emit AuthorizedSignerUpdated(previous, msg.sender);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function availableBalance() external view returns (uint256) { return address(this).balance; }

    receive() external payable { emit TreasuryFunded(msg.sender, msg.value); }
}
