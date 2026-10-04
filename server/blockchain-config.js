
import { getAddress } from 'viem';
import { loadDeploymentManifest } from './deployment-manifest.js';

const LITEFORGE_RPC = 'https://liteforge.rpc.caldera.xyz/http';

const TYPES = [
  'casino_wager',
  'casino_payout',
  'arcade_withdrawal',
];

const fail = (message) => {
  throw new Error(`BLOCKCHAIN_CONFIG_INVALID: ${message}`);
};

const methodNames = (abi, type) =>
  new Set(
    abi
      .filter(
        (item) =>
          item &&
          item.type === type &&
          typeof item.name === 'string'
      )
      .map((item) => item.name)
  );

export function loadBlockchainConfig() {
  const raw = process.env.LITVM_CONTRACT_CONFIG_JSON;
  const rpcUrl = process.env.LITVM_RPC_URL || LITEFORGE_RPC;

  let config;

  if (raw) {
    try {
      config = JSON.parse(raw);
    } catch {
      fail('JSON');
    }
  } else {
    config = loadDeploymentManifest();
  }

  let rpc;

  try {
    rpc = new URL(rpcUrl);
  } catch {
    fail('RPC URL');
  }

  if (rpc.protocol !== 'https:') {
    fail('RPC must use HTTPS');
  }

  if (
    config.network !== 'LitVM LiteForge Testnet' ||
    config.chainId !== 4441
  ) {
    fail('network/chainId must be LitVM LiteForge Testnet 4441');
  }

  if (
    rpc.origin !== 'https://liteforge.rpc.caldera.xyz' ||
    rpc.pathname !== '/http'
  ) {
    fail('unexpected LiteForge RPC');
  }

  if (
    !Number.isInteger(config.requiredConfirmations) ||
    config.requiredConfirmations < 1 ||
    config.requiredConfirmations > 100
  ) {
    fail('requiredConfirmations');
  }

  if (
    !config.token ||
    config.token.symbol !== 'zkLTC' ||
    config.token.decimals !== 18
  ) {
    fail('native zkLTC token');
  }

  if (config.publicRpcUrl) {
    let publicRpc;

    try {
      publicRpc = new URL(config.publicRpcUrl);
    } catch {
      fail('public RPC URL');
    }

    if (
      publicRpc.protocol !== 'https:' ||
      publicRpc.username ||
      publicRpc.password
    ) {
      fail('public RPC safety');
    }
  }

  if (config.token.address) {
    config.token.address = getAddress(config.token.address);
  }

  config.token.abi = Array.isArray(config.token.abi)
    ? config.token.abi
    : [];

  if (config.treasuryAddress) {
    config.treasuryAddress = getAddress(config.treasuryAddress);
  }

  if (!config.contracts || !config.roles) {
    fail('contracts/roles');
  }

  /*
   * VeyraCasino is currently deployed.
   * ArcadeWithdrawal is intentionally optional until that
   * contract is actually deployed.
   */
  const casino = config.contracts.casino;

  if (
    !casino ||
    !Array.isArray(casino.abi) ||
    !casino.abi.length
  ) {
    fail('casino ABI');
  }

  casino.address = getAddress(casino.address);

  /*
   * Validate only the casino roles that are currently live.
   */
  for (const type of ['casino_wager', 'casino_payout']) {
    const role = config.roles[type];

    if (
      !role ||
      role.contract !== 'casino' ||
      !['method', 'event'].includes(role.source)
    ) {
      fail(`${type} role`);
    }

    const abi = config.contracts.casino.abi;

    const names = methodNames(
      abi,
      role.source === 'method' ? 'function' : 'event'
    );

    if (
      typeof role.name !== 'string' ||
      !names.has(role.name)
    ) {
      fail(`${type} ABI mapping`);
    }

    if (
      typeof role.amountField !== 'string' ||
      !role.amountField ||
      typeof role.userField !== 'string' ||
      !role.userField ||
      typeof role.sessionField !== 'string' ||
      !role.sessionField ||
      (type === 'casino_payout' && (
        typeof role.nonceField !== 'string' || !role.nonceField
      ))
    ) {
      fail(`${type} fields`);
    }
  }

  return Object.freeze({
    ...config,
    rpcUrl,
  });
}

export function publicBlockchainConfig() {
  const config = loadBlockchainConfig();

  if (!config) return null;

  return {
    network: config.network,
    chainId: config.chainId,
    publicRpcUrl: config.publicRpcUrl || null,
    requiredConfirmations: config.requiredConfirmations,
    treasuryAddress: config.treasuryAddress || null,
    token: config.token,
    contracts: config.contracts,
    roles: config.roles,
  };
}

export const blockchainTypes = Object.freeze([
  'casino_wager',
  'casino_payout',
]);


