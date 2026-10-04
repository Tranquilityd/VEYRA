# Veyra LitVM Wallet Integration

## Balance separation

- **Main Wallet Balance** is read from the connected wallet adapter for the verified zkLTC
  token on LitVM Testnet. Casino wagers originate here and require user-signed contract
  transactions. Veyra never persists or modifies this value locally.
- **Arcade Game Balance** is returned by authenticated `GET /api/balance`. Only backend
  validation can credit it. Arcade sessions and qualified referral rewards use the same
  transactional server credit path. It does not become wallet zkLTC until a smart-contract
  withdrawal is confirmed.

## Wallet adapter boundary

The host must install `window.__VEYRA_LITVM_WALLET_ADAPTER__` after integrating the
verified LitVM wallet SDK. It must expose:

- `connect({config,network,token}) -> {account}`
- `signMessage({account,message}) -> signature`
- `getTokenBalance({account,token,config}) -> decimal string`
- optional `subscribe({accountsChanged,chainChanged})`
- optional `disconnect()`

It may also implement the casino and arcade-withdrawal methods, or separate verified
adapters may be installed at `__VEYRA_LITVM_CASINO_ADAPTER__` and
`__VEYRA_LITVM_WITHDRAWAL_ADAPTER__`.

Transaction methods receive `onState(state, detail)`. Allowed states are `awaiting
signature`, `submitted`, `confirming`, `confirmed`, and `failed`. The adapter must call
`submitted` after obtaining a hash, `confirming` while awaiting required confirmations,
and return `confirmed:true` only after actual confirmation. Rejection/revert must throw or
return unconfirmed; Veyra then displays `failed` and never shows success.

No adapter method accepts or requests a seed phrase, private key, mnemonic, or wallet
password. Those stay entirely inside the user's wallet.

## Authentication

After account connection, Veyra requests a one-use backend challenge and asks the wallet
to sign the login message. This signature is not a transaction. The resulting API bearer
token may be cached in session storage; no balance or signing credential is stored there.
Account changes disconnect the session and require a fresh signature.

## Casino constraints

Wagers are manually entered and validated exactly at 0.0005–1 zkLTC, against Main Wallet
Balance, before signature. Winnings use the smart-contract claim path with no admin step.
Blockchain state and backend tracking remain separate so a tracking retry never resubmits
an already confirmed wager.

## Casino responsibility boundary

Wallet adapters sign and track wager/payout settlement only. They do not expose an
outcome resolver and must not provide randomness. After the wager is independently
confirmed, Veyra's authenticated backend generates and records the game result and payout.
The game renderer consumes that backend result. A win then invokes the configurable
contract payout adapter; a loss invokes no payout transaction. No blockchain or wallet
value is an input to game-result generation.
