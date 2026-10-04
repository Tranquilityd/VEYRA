
import { getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { env } from './env.js';
import { loadBlockchainConfig } from './blockchain-config.js';

const CHAIN_ID = 4441;

const TYPES = {
  ClaimAuthorization: [
    { name: 'player', type: 'address' },
    { name: 'sessionId', type: 'uint256' },
    { name: 'wagerAmount', type: 'uint256' },
    { name: 'payoutAmount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

const getCasinoAddress = () => {
  const config = loadBlockchainConfig();
  const address = config?.contracts?.casino?.address;
  if (!address) throw new Error('BLOCKCHAIN_UNCONFIGURED');
  return getAddress(address);
};

export function getCasinoSigner() {
  const account = privateKeyToAccount(env.casinoSignerPrivateKey());
  const configured = getAddress(env.casinoSignerAddress());

  if (account.address.toLowerCase() !== configured.toLowerCase()) {
    throw new Error('CASINO_SIGNER_ADDRESS_MISMATCH');
  }

  return account;
}

export async function signCasinoClaim({
  player,
  sessionId,
  wagerAmount,
  payoutAmount,
  nonce,
  deadline,
}) {
  const account = getCasinoSigner();

  const domain = {
    name: 'VeyraCasino',
    version: '1',
    chainId: CHAIN_ID,
    verifyingContract: getCasinoAddress(),
  };

  const message = {
    player: getAddress(player),
    sessionId: BigInt(sessionId),
    wagerAmount: BigInt(wagerAmount),
    payoutAmount: BigInt(payoutAmount),
    nonce: BigInt(nonce),
    deadline: BigInt(deadline),
  };

  const signature = await account.signTypedData({
    domain,
    types: TYPES,
    primaryType: 'ClaimAuthorization',
    message,
  });

  return {
    signature,
    authorization: {
      player: message.player,
      sessionId: message.sessionId.toString(),
      wagerAmount: message.wagerAmount.toString(),
      payoutAmount: message.payoutAmount.toString(),
      nonce: message.nonce.toString(),
      deadline: message.deadline.toString(),
    },
    signer: account.address,
  };
}


