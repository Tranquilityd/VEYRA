import { loadDeploymentManifest } from './deployment-manifest.js';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
};

export const env = {
  casinoSignerPrivateKey: () => {
    const value = required('VEYRA_CASINO_SIGNER_PRIVATE_KEY');
    if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
      throw new Error('VEYRA_CASINO_SIGNER_PRIVATE_KEY must be a 32-byte hex private key');
    }
    return value;
  },
  casinoSignerAddress: () =>
    process.env.VEYRA_CASINO_SIGNER_ADDRESS || loadDeploymentManifest().authorizedSigner,
  databaseUrl: () => required('DATABASE_URL'),
  turnstileSecretKey: () => required('CLOUDFLARE_TURNSTILE_SECRET_KEY'),
  hcaptchaSecretKey: () => required('HCAPTCHA_SECRET_KEY'),
  siteEntryCaptchaProvider: () => process.env.SITE_ENTRY_CAPTCHA_PROVIDER === 'hcaptcha' ? 'hcaptcha' : 'turnstile',
  sessionSecret: () => {
    const value = required('API_SESSION_SECRET');
    if (value.length < 32) throw new Error('API_SESSION_SECRET must be at least 32 characters');
    return value;
  },
  challengeDomain: () => process.env.WALLET_CHALLENGE_DOMAIN || 'veyra.local',
};
