import { readFileSync } from 'node:fs';

const manifestUrl = new URL('../config/deployments/liteforge.json', import.meta.url);
const abiUrl = new URL('../config/abi/VeyraCasino.json', import.meta.url);

export function loadDeploymentManifest() {
  const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));
  const generated = JSON.parse(readFileSync(abiUrl, 'utf8'));
  return {
    ...manifest,
    contracts: {
      casino: {
        ...manifest.contracts.casino,
        abi: generated.abi,
      },
    },
  };
}
