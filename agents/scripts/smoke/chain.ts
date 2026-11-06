/**
 * smoke:chain — 0G Galileo: balance → SmokeStore → set(value) → read back.
 * Default: REUSE the SmokeStore recorded in shared/addresses.json (one tx per run, saves 0G).
 * `--fresh` (or no recorded/valid deployment): deploy a new one and record it.
 * Prints explorer links and gas cost of each tx.
 *
 * Needs: DEPLOYER_PRIVATE_KEY in agents/.env (funded), compiled artifact from contracts/hardhat.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ContractFactory, Contract, type TransactionReceipt } from 'ethers';
import { GALILEO, assertGalileo, explorerAddress, explorerTx, fmt0G, galileoProvider, walletFromEnv } from '../../src/chain.ts';
import { REPO_ROOT, isMain, runSmoke } from './lib.ts';

const ARTIFACT = join(REPO_ROOT, 'contracts/hardhat/artifacts/contracts/SmokeStore.sol/SmokeStore.json');
const ADDRESSES = join(REPO_ROOT, 'shared/addresses.json');

const cost = (r: TransactionReceipt) => r.gasUsed * (r.gasPrice ?? 0n);

function readAddresses(): any {
  return existsSync(ADDRESSES) ? JSON.parse(readFileSync(ADDRESSES, 'utf8')) : {};
}

function recordAddress(entry: Record<string, unknown>) {
  const all = readAddresses();
  all.galileo ??= { chainId: GALILEO.chainId, explorer: GALILEO.explorer, contracts: {} };
  all.galileo.contracts.SmokeStore = entry;
  writeFileSync(ADDRESSES, JSON.stringify(all, null, 2) + '\n');
}

export function smokeChain(opts: { noExit?: boolean; fresh?: boolean } = {}) {
  return runSmoke('smoke:chain', async (log) => {
    if (!existsSync(ARTIFACT)) throw new Error('Artifact missing — run `npm run compile --prefix contracts/hardhat`');
    const { abi, bytecode } = JSON.parse(readFileSync(ARTIFACT, 'utf8'));

    const provider = galileoProvider();
    await assertGalileo(provider);
    const wallet = walletFromEnv('DEPLOYER_PRIVATE_KEY', provider);
    const balance = await provider.getBalance(wallet.address);
    log(`chain ${GALILEO.chainId} OK · deployer ${wallet.address} · balance ${fmt0G(balance)}`);
    if (balance === 0n) throw new Error(`Deployer has 0 balance — fund ${explorerAddress(wallet.address)}`);

    let address: string | undefined = opts.fresh ? undefined : readAddresses().galileo?.contracts?.SmokeStore?.address;
    let deployCost = 0n;
    if (address) {
      // Reuse only if the recorded address actually holds code on this chain.
      const code = await provider.getCode(address);
      if (code === '0x') {
        log(`recorded SmokeStore ${address} has no code on chain — deploying fresh`);
        address = undefined;
      } else {
        log(`reusing SmokeStore ${explorerAddress(address)} (pass --fresh to redeploy)`);
      }
    }
    if (!address) {
      const factory = new ContractFactory(abi, bytecode, wallet);
      const deployed = await factory.deploy();
      const deployTx = deployed.deploymentTransaction()!;
      log(`deploy tx ${explorerTx(deployTx.hash)}`);
      const deployRcpt = (await deployTx.wait())!;
      address = await deployed.getAddress();
      deployCost = cost(deployRcpt);
      log(`deployed SmokeStore ${explorerAddress(address)} · block ${deployRcpt.blockNumber} · cost ${fmt0G(deployCost)}`);
      recordAddress({
        address,
        deployTx: deployTx.hash,
        deployer: wallet.address,
        block: deployRcpt.blockNumber,
        purpose: 'smoke:chain test contract (not used by the app)',
        deployedAt: new Date().toISOString(),
      });
    }

    const store = new Contract(address, abi, wallet);
    const want = BigInt(Date.now());
    const setTx = await store.set(want);
    const setRcpt = (await setTx.wait())!;
    log(`set(${want}) tx ${explorerTx(setTx.hash)} · cost ${fmt0G(cost(setRcpt))}`);

    const got: bigint = await store.value();
    const writer: string = await store.lastWriter();
    if (got !== want) throw new Error(`read ${got}, expected ${want}`);
    if (writer !== wallet.address) throw new Error(`lastWriter ${writer}, expected ${wallet.address}`);
    log(`read value() = ${got} ✔ lastWriter = deployer ✔`);

    const total = deployCost + cost(setRcpt);
    const after = await provider.getBalance(wallet.address);
    const how = deployCost > 0n ? 'deployed' : 'reused';
    return `${how} ${address}, write+read OK, total cost ${fmt0G(total)}, balance now ${fmt0G(after)}`;
  }, opts);
}

if (isMain(import.meta.url)) await smokeChain({ fresh: process.argv.includes('--fresh') });
