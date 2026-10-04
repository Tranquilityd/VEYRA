
const CHAIN_ID = 4441;
const CHAIN_ID_HEX = '0x1159';
const RPC_URL = 'https://liteforge.rpc.caldera.xyz/http';
const CHAIN_NAME = 'LitVM LiteForge Testnet';
const TOKEN_SYMBOL = 'zkLTC';
const TOKEN_DECIMALS = 18;

const announcedProviders = [];
if (typeof window !== 'undefined') {
  window.addEventListener?.('eip6963:announceProvider', (event) => {
    const provider = event?.detail?.provider;
    if (provider?.request && !announcedProviders.includes(provider)) announcedProviders.push(provider);
  });
  window.dispatchEvent?.(new Event('eip6963:requestProvider'));
}

const PLACE_WAGER_SELECTOR = 'b1cc4348';
const CLAIM_WINNINGS_SELECTOR = '7342b532';

const normalizeAddress = (value) => {
  const text = String(value || '');
  if (!/^0x[0-9a-fA-F]{40}$/.test(text)) {
    throw new Error('Invalid wallet address.');
  }

  return `0x${text.slice(2).toLowerCase()}`;
};

const addressWord = (value) =>
  normalizeAddress(value).slice(2).padStart(64, '0');

const uintWord = (value) => {
  const n = BigInt(value);

  if (n < 0n) {
    throw new Error('Unsigned integer cannot be negative.');
  }

  return n.toString(16).padStart(64, '0');
};

const hexBytesLength = (hex) => {
  const value = String(hex || '');

  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error('Invalid signature encoding.');
  }

  return (value.length - 2) / 2;
};

const padHexToWord = (hex) => {
  const value = String(hex || '').replace(/^0x/, '').toLowerCase();

  if (!/^[0-9a-f]*$/.test(value) || value.length % 2 !== 0) {
    throw new Error('Invalid hex data.');
  }

  const remainder = value.length % 64;

  return remainder === 0
    ? value
    : value + '0'.repeat(64 - remainder);
};

const formatUnits = (raw, decimals = 18) => {
  const value = BigInt(raw);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const text = absolute.toString().padStart(decimals + 1, '0');

  const whole = text.slice(0, -decimals) || '0';
  const fraction = text
    .slice(-decimals)
    .replace(/0+$/, '');

  const result = fraction
    ? `${whole}.${fraction}`
    : whole;

  return negative ? `-${result}` : result;
};

const atomicToHex = (atomic) => {
  const value = BigInt(atomic);

  if (value < 0n) {
    throw new Error('Transaction value cannot be negative.');
  }

  return `0x${value.toString(16)}`;
};

const assertChain = async (provider) => {
  const chain = await provider.request({
    method: 'eth_chainId',
  });

  if (String(chain).toLowerCase() !== CHAIN_ID_HEX) {
    throw new Error(
      `Wrong network. Please switch to ${CHAIN_NAME} (chain ${CHAIN_ID}).`
    );
  }
};

const addOrSwitchChain = async (provider) => {
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  } catch (error) {
    const code = error?.code;

    if (code !== 4902 && code !== -32603) {
      throw error;
    }

    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: CHAIN_ID_HEX,
          chainName: CHAIN_NAME,
          rpcUrls: [RPC_URL],
          nativeCurrency: {
            name: TOKEN_SYMBOL,
            symbol: TOKEN_SYMBOL,
            decimals: TOKEN_DECIMALS,
          },
        },
      ],
    });

    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  }

  await assertChain(provider);
};

const waitForReceipt = async (
  provider,
  hash,
  onState,
  timeoutMs = 180000
) => {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const receipt = await provider.request({
      method: 'eth_getTransactionReceipt',
      params: [hash],
    });

    if (receipt) {
      const status = String(receipt.status || '').toLowerCase();

      if (status !== '0x1') {
        throw new Error('Blockchain transaction reverted.');
      }

      onState?.(
        'confirmed',
        'Blockchain transaction confirmed.'
      );

      return {
        hash,
        confirmed: true,
        receipt,
      };
    }

    onState?.(
      'confirming',
      'Waiting for LitVM transaction confirmation...'
    );

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(
    'Transaction confirmation timed out. Check the transaction before retrying.'
  );
};

const encodeClaimWinnings = (claim) => {
  const authorization = claim?.authorization;

  if (!authorization) {
    throw new Error('Claim authorization is missing.');
  }

  const player = normalizeAddress(authorization.player);

  const signature = String(authorization.signature || '');

  const signatureBytes = hexBytesLength(signature);
  const signatureData = signature.replace(/^0x/, '').toLowerCase();

  /*
   * ABI:
   *
   * claimWinnings(
   *   (
   *     address player,
   *     uint256 sessionId,
   *     uint256 wagerAmount,
   *     uint256 payoutAmount,
   *     uint256 nonce,
   *     uint256 deadline
   *   ),
   *   bytes signature
   * )
   *
   * The tuple is static (6 words = 192 bytes).
   * The bytes argument begins at offset 224 bytes = 0xe0.
   */

  const tuple = [
    addressWord(player),
    uintWord(authorization.sessionId),
    uintWord(authorization.wagerAmount),
    uintWord(authorization.payoutAmount),
    uintWord(authorization.nonce),
    uintWord(authorization.deadline),
  ].join('');

  const signatureLength = uintWord(signatureBytes);

  return `0x${CLAIM_WINNINGS_SELECTOR}${tuple}${uintWord(
    224
  )}${signatureLength}${padHexToWord(signatureData)}`;
};

const getProvider = ({ launchMobile = false } = {}) => {
  const injected = window.ethereum;
  const provider = announcedProviders[0]
    || injected?.providers?.find?.((candidate) => typeof candidate?.request === 'function')
    || injected;

  if (!provider || typeof provider.request !== 'function') {
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');

    if (mobile && launchMobile) {
      const dappUrl = encodeURIComponent(window.location.href);
      window.location.assign(
        `https://go.rabby.io/mobile/?_cmd=open-dapp&dapp=${dappUrl}`
      );
      throw new Error('Opening Veyra in Rabby Wallet…');
    }

    throw new Error(mobile
      ? 'No injected wallet was detected. Open Veyra inside your EVM wallet’s built-in browser, or use a browser with an enabled wallet provider.'
      : 'No compatible browser wallet was detected. Install or enable an EVM-compatible wallet.');
  }

  return provider;
};

class LitvmWalletAdapter {
  constructor() {
    this.provider = null;
    this.account = null;
    this.listeners = null;
    this.manualDisconnect = false;
  }

  async connect() {
    this.manualDisconnect = false;
    this.provider = getProvider({ launchMobile: true });

    await addOrSwitchChain(this.provider);

    const accounts = await this.provider.request({
      method: 'eth_requestAccounts',
    });

    if (!Array.isArray(accounts) || !accounts[0]) {
      throw new Error('Wallet did not return an account.');
    }

    this.account = normalizeAddress(accounts[0]);

    return {
      account: this.account,
      network: 'LitVM Testnet',
    };
  }

  async restore() {
    if (this.manualDisconnect) return null;
    this.provider = getProvider();
    await assertChain(this.provider);
    const accounts = await this.provider.request({ method: 'eth_accounts' });
    if (!Array.isArray(accounts) || !accounts[0]) return null;
    this.account = normalizeAddress(accounts[0]);
    return { account: this.account, network: 'LitVM Testnet' };
  }

  async signMessage({ account, message }) {
    if (!this.provider) {
      this.provider = getProvider();
    }

    const wallet = normalizeAddress(account);

    if (
      this.account &&
      wallet !== normalizeAddress(this.account)
    ) {
      throw new Error('Signing wallet does not match connected wallet.');
    }

    return this.provider.request({
      method: 'personal_sign',
      params: [String(message), wallet],
    });
  }

  async getTokenBalance({ account }) {
    if (!this.provider) {
      this.provider = getProvider();
    }

    const wallet = normalizeAddress(account);

    const balance = await this.provider.request({
      method: 'eth_getBalance',
      params: [wallet, 'latest'],
    });

    return formatUnits(balance, TOKEN_DECIMALS);
  }

  async submitWager({
    amount,
    atomic,
    config,
    onState,
  }) {
    if (!this.provider) {
      this.provider = getProvider();
    }

    const account = normalizeAddress(this.account);

    const contract = normalizeAddress(
      config?.casinoContractAddress
    );

    await assertChain(this.provider);

    if (BigInt(atomic) <= 0n) {
      throw new Error('Wager amount must be greater than zero.');
    }

    onState?.(
      'awaiting signature',
      `Sign wager ${amount} zkLTC in your wallet.`
    );

    const hash = await this.provider.request({
      method: 'eth_sendTransaction',
      params: [
        {
          from: account,
          to: contract,
          value: atomicToHex(atomic),
          data: `0x${PLACE_WAGER_SELECTOR}`,
        },
      ],
    });

    onState?.(
      'submitted',
      'Wager transaction submitted.'
    );

    return waitForReceipt(
      this.provider,
      hash,
      onState
    );
  }

  async claimPayout({
    claim,
    account,
    config,
    onState,
  }) {
    if (!this.provider) {
      this.provider = getProvider();
    }

    const wallet = normalizeAddress(account);
    const contract = normalizeAddress(
      config?.casinoContractAddress
    );

    await assertChain(this.provider);

    const authorization = claim?.authorization;

    if (!authorization) {
      throw new Error('Claim authorization is missing.');
    }

    if (
      normalizeAddress(authorization.player) !== wallet
    ) {
      throw new Error(
        'Claim authorization does not belong to this wallet.'
      );
    }

    const data = encodeClaimWinnings(claim);

    onState?.(
      'awaiting signature',
      'Confirm the claim transaction in your wallet.'
    );

    const hash = await this.provider.request({
      method: 'eth_sendTransaction',
      params: [
        {
          from: wallet,
          to: contract,
          value: '0x0',
          data,
        },
      ],
    });

    onState?.(
      'submitted',
      'Claim transaction submitted.'
    );

    return waitForReceipt(
      this.provider,
      hash,
      onState
    );
  }

  subscribe({ accountsChanged, chainChanged } = {}) {
    if (!this.provider) return;

    const accountHandler = (accounts) => {
      accountsChanged?.(accounts);
    };

    const chainHandler = (chainId) => {
      chainChanged?.(chainId);
    };

    this.listeners = {
      accountHandler,
      chainHandler,
    };

    this.provider.on?.(
      'accountsChanged',
      accountHandler
    );

    this.provider.on?.(
      'chainChanged',
      chainHandler
    );
  }

  disconnect({ manual = true } = {}) {
    this.manualDisconnect = manual;
    if (this.provider && this.listeners) {
      this.provider.removeListener?.(
        'accountsChanged',
        this.listeners.accountHandler
      );

      this.provider.removeListener?.(
        'chainChanged',
        this.listeners.chainHandler
      );
    }

    this.listeners = null;
    this.account = null;
    this.provider = null;
  }
}

export function installLitvmWalletAdapter() {
  const adapter = new LitvmWalletAdapter();

  window.__VEYRA_LITVM_WALLET_ADAPTER__ = adapter;
  window.__VEYRA_LITVM_CASINO_ADAPTER__ = adapter;

  return adapter;
}


