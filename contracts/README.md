# contracts/ — Pickle escrow on Monad testnet (port pending)

Owner: whoever gets there first. Port of the proven Mumbai escrow contract
(full job lifecycle: post/claim/settle/expire/cancel/pay, per-job payout cap,
payout escrowed at post time, on-chain claim expiry, owner pause).

Plan: fresh deploy under the Pickle name on Monad testnet (chain 10143),
Hardhat + viem, Node 20. Before deploying, check whether the testnet reset
wiped the old v1.1 deployment and balances — do not assume the old funds
are recoverable.

The agents core settles through this contract; until it lands, settle is a
logged stub in `agents/src/index.ts`.
