/**
 * smoke:chain — 0G Galileo: balance → deploy SmokeStore → set(value) → read back.
 * Prints explorer links and gas cost of each tx. Records the deployment in shared/addresses.json.
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

function recordAddress(entry: Record<string, unknown>) {
  const all = existsSync(ADDRESSES) ? JSON.parse(readFileSync(ADDRESSES, 'utf8')) : {};
  all.galileo ??= { chainId: GALILEO.chainId, explorer: GALILEO.explorer, contracts: {} };
  all.galileo.contracts.SmokeStore = entry;
  writeFileSync(ADDRESSES, JSON.stringify(all, null, 2) + '\n');
}

export function smokeChain(opts: { noExit?: boolean } = {}) {
  return runSmoke('smoke:chain', async (log) => {
    if (!existsSync(ARTIFACT)) throw new Error('Artifact missing — run `npm run compile --prefix contracts/hardhat`');
    const { abi, bytecode } = JSON.parse(readFileSync(ARTIFACT, 'utf8'));

    const provider = galileoProvider();
    await assertGalileo(provider);
    const wallet = walletFromEnv('DEPLOYER_PRIVATE_KEY', provider);
    const balance = await provider.getBalance(wallet.address);
    log(`chain ${GALILEO.chainId} OK · deployer ${wallet.address} · balance ${fmt0G(balance)}`);
    if (balance === 0n) throw new Error(`Deployer has 0 balance — fund ${explorerAddress(wallet.address)}`);

    const factory = new ContractFactory(abi, bytecode, wallet);
    const deployed = await factory.deploy();
    const deployTx = deployed.deploymentTransaction()!;
    log(`deploy tx ${explorerTx(deployTx.hash)}`);
    const deployRcpt = (await deployTx.wait())!;
    const address = await deployed.getAddress();
    log(`deployed SmokeStore ${explorerAddress(address)} · block ${deployRcpt.blockNumber} · cost ${fmt0G(cost(deployRcpt))}`);

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

    recordAddress({
      address,
      deployTx: deployTx.hash,
      deployer: wallet.address,
      block: deployRcpt.blockNumber,
      purpose: 'smoke:chain test contract (not used by the app)',
      deployedAt: new Date().toISOString(),
    });
    const total = cost(deployRcpt) + cost(setRcpt);
    const after = await provider.getBalance(wallet.address);
    return `deployed ${address}, write+read OK, total cost ${fmt0G(total)}, balance now ${fmt0G(after)}`;
  }, opts);
}

if (isMain(import.meta.url)) await smokeChain();
