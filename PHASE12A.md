# Phase 12A — Veyra Casino Contract Report

No deployment was performed.

## Deliverables

- Contract: `contracts/contracts/VeyraCasino.sol`
- Tests: `contracts/test/VeyraCasino.test.js`
- Reentrancy test helper: `contracts/contracts/test/ReentrantClaimer.sol`
- Generated ABI: `config/abi/VeyraCasino.json`
- LiteForge deployment script: `contracts/scripts/deploy.js`
- Hardhat configuration: `contracts/hardhat.config.js`
- Deployment environment template: `contracts/.env.example`

## Architecture

`VeyraCasino` is one native-zkLTC settlement contract. It receives wagers, assigns monotonic session IDs, stores player and amount, verifies backend EIP-712 claim authorizations, permanently consumes both session and nonce replay dimensions, pays only `msg.sender`, supports emergency pause, and holds settlement liquidity. It contains no game-outcome logic and no randomness.

## Public interfaces

- Wager: `placeWager() external payable returns (uint256 sessionId)`
- Claim: `claimWinnings(ClaimAuthorization authorization, bytes signature) external`
- Wager event: `WagerPlaced(address indexed player, uint256 indexed sessionId, uint256 amount)`
- Claim event: `WinningsClaimed(address indexed player, uint256 indexed sessionId, uint256 payoutAmount, uint256 indexed nonce)`
- Signer rotation: `proposeAuthorizedSigner(address)` then `acceptAuthorizedSigner()`
- Emergency controls: `pause()` and `unpause()`
- Balance view: `availableBalance()`

## Claim authorization

EIP-712 domain:

- Name: `VeyraCasino`
- Version: `1`
- Runtime chain ID and verifying contract are included by EIP-712.

Typed struct:

```text
ClaimAuthorization(
  address player,
  uint256 sessionId,
  uint256 wagerAmount,
  uint256 payoutAmount,
  uint256 nonce,
  uint256 deadline
)
```

The dedicated backend authorization signer signs the typed claim. It is not the Treasury recovery phrase.

## Identification and replay protection

- Player: wager and claim use `msg.sender`; claim authorization must name the same wallet.
- Amount: wager is authoritative `msg.value`; claim checks signed `wagerAmount` against stored wager and pays signed `payoutAmount`.
- Session: `nextSessionId` is monotonic and starts at 1.
- Replay: `usedNonces[nonce]` and `claimedSessions[sessionId]` are permanently set before native transfer.
- Deadline: `block.timestamp` is used only to reject expired claims, never as outcome randomness.

## Signer and administration

Ownership uses OpenZeppelin `Ownable2Step`. Signer rotation is also two-step: the owner proposes an address and that exact address must accept. The owner may pause/unpause. No withdrawal function exists, so the owner cannot directly extract contract funds. Before deployment, the owner must review the tradeoff that funds can only leave through valid claims; an emergency recovery mechanism would require a separate security review and is intentionally absent.

## Treasury and funding

The constructor is payable and the contract has a payable `receive()` function. Both allow native zkLTC funding and emit `TreasuryFunded`. `availableBalance()` reports liquidity. There is no automatic treasury funding, private-key custody, admin payout, or arbitrary withdrawal destination.

## Security controls

- OpenZeppelin EIP-712 and ECDSA recovery
- OpenZeppelin `ReentrancyGuard`
- OpenZeppelin `Pausable`
- Two-step ownership and signer rotation
- Checks-effects-interactions
- Native wager minimum `0.0005 ether` and maximum `1 ether`
- Player fixed to `msg.sender`
- Signed player/session/wager/payout/nonce/deadline
- Nonce and session replay mappings
- Expiration check
- Contract-liquidity check
- No arbitrary payout destination
- No withdrawal function
- No blockhash, prevrandao, difficulty, or blockchain-derived outcome logic

## Build and tests

- Solidity: `0.8.24`
- EVM target: `paris`
- OpenZeppelin Contracts: exact version `5.2.0`
- Optimizer: enabled, 200 runs
- Runtime bytecode: 5,304 bytes
- Automated tests: **22 passing, 0 failing**

Covered: minimum/maximum wagers, below/above/zero rejection, records and events, monotonic sessions, valid payout, wrong signer, wrong wallet, modified payout/session/nonce, expiration, duplicate signature, nonce reuse, session replay, malformed signature, zero payout, insufficient liquidity, unauthorized signer/pause/ownership actions, two-step rotations, no arbitrary withdrawal/destination, and reentrancy.

## Deployment preparation

`contracts/scripts/deploy.js` refuses any chain other than `4441`. It requires:

- `LITEFORGE_RPC_URL=https://liteforge.rpc.caldera.xyz/http`
- `DEPLOYER_PRIVATE_KEY` as a local/server deployment environment secret
- `CONTRACT_OWNER_ADDRESS`
- `AUTHORIZATION_SIGNER_ADDRESS`

No credential is present in source. The script was locally tested against chain `31337` and correctly refused deployment. No LitVM transaction or fabricated deployment hash exists.
