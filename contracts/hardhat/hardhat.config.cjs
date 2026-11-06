// Hardhat 2 config for 0G Galileo testnet.
// Compiler settings per https://docs.0g.ai/developer-hub/building-on-0g/contracts-on-0g/deploy-contracts
// ("specify --evm-version cancun") and zerobot's contracts/hardhat.config.ts (solc 0.8.27).
// Test plugins (only used by `npm test`; deploys run from agents/ with ethers v6).
require('@nomicfoundation/hardhat-chai-matchers');
require('@nomicfoundation/hardhat-ethers');

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: {
    version: '0.8.27',
    settings: { evmVersion: 'cancun', optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    // Chain ID + RPC: https://docs.0g.ai/developer-hub/testnet/testnet-overview
    galileo: { url: 'https://evmrpc-testnet.0g.ai', chainId: 16602 },
  },
};
