# Smoke tests

Run each one from the repo root. Each prints `PASS`/`FAIL` with details and exits non-zero on failure.
Secrets come from `agents/.env` (gitignored; template: `agents/.env.example`).

**One-time setup:**
```
npm install
npm install --prefix contracts/hardhat
npx tsx agents/scripts/new-wallet.ts DEPLOYER   # prints address only; fund it via https://faucet.0g.ai
```

## smoke:chain — 0G Galileo

```
npm run smoke:chain
```
- Compiles `contracts/hardhat/contracts/SmokeStore.sol` with Hardhat 2.29.1, solc 0.8.27 and evmVersion cancun.
- Checks that the RPC reports chain 16602 and prints the deployer's balance.
- Deploys SmokeStore with ethers 6.17.0, calls `set(<timestamp>)`, then reads back `value()` and `lastWriter()`.
- Prints explorer links and the gas cost of each tx, and writes the deployment to `shared/addresses.json`.
- **Needs:** `DEPLOYER_PRIVATE_KEY` funded with roughly 0.001 0G per run (measured: 0.000743 0G).
- **Fails if:** the chain ID is wrong, the balance is 0, a tx reverts, or the read-back doesn't match.

## smoke:compute — _step 3_
## smoke:compute-down — _step 3_
## smoke:storage — _step 4_
## smoke:world — _step 5_
## smoke:zerobot — _step 6_
## smoke:all — _step 7_
