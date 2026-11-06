const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time, loadFixture } = require('@nomicfoundation/hardhat-network-helpers');

const MAX = ethers.parseEther('0.005');
const PAY = ethers.parseEther('0.001');
const WINDOW = 3600n;
const H1 = ethers.id('world:human-1');
const H2 = ethers.id('world:human-2');
const REQ = 'chatcmpl-test-123';
const ROOT = ethers.id('episode-root');

async function deploy() {
  const [owner, agent, agent2, robot, robot2, worker, stranger] = await ethers.getSigners();
  const Escrow = await ethers.getContractFactory('PickleEscrow');
  const escrow = await Escrow.deploy(MAX);
  await escrow.registerRobot(robot.address, agent.address);
  await escrow.registerRobot(robot2.address, agent2.address);
  await escrow.fund(robot.address, { value: ethers.parseEther('0.01') });
  return { escrow, owner, agent, agent2, robot, robot2, worker, stranger };
}

/** Deployed + one open bounty (#1). */
async function withOpenBounty() {
  const f = await deploy();
  await f.escrow.connect(f.agent).postBounty(f.robot.address, PAY, WINDOW);
  return { ...f, id: 1n };
}

/** Deployed + bounty #1 claimed by H1 for `worker`. */
async function withClaimedBounty() {
  const f = await withOpenBounty();
  await f.escrow.connect(f.agent).claim(f.id, f.worker.address, H1);
  return f;
}

describe('PickleEscrow', () => {
  describe('happy path', () => {
    it('post → claim → settle pays the worker and records compute + storage refs', async () => {
      const { escrow, agent, robot, worker } = await loadFixture(deploy);
      const before = await escrow.robotBalance(robot.address);

      await expect(escrow.connect(agent).postBounty(robot.address, PAY, WINDOW))
        .to.emit(escrow, 'BountyPosted')
        .withArgs(1n, robot.address, PAY, WINDOW);
      expect(await escrow.robotBalance(robot.address)).to.equal(before - PAY);

      const tx = escrow.connect(agent).claim(1n, worker.address, H1);
      await expect(tx).to.emit(escrow, 'BountyClaimed');
      const b = await escrow.getBounty(1n);
      expect(b.status).to.equal(2n); // Claimed
      expect(b.worker).to.equal(worker.address);
      expect(b.humanHash).to.equal(H1);
      expect(await escrow.hasClaimed(1n, H1)).to.equal(true);

      const settleTx = await escrow.connect(agent).settle(1n, REQ, ROOT);
      await expect(settleTx).to.emit(escrow, 'BountySettled').withArgs(1n, worker.address, PAY, REQ, ROOT);
      await expect(settleTx).to.changeEtherBalances([worker, escrow], [PAY, -PAY]);
      expect((await escrow.getBounty(1n)).status).to.equal(3n); // Settled
      expect(await escrow.robotBalance(robot.address)).to.equal(before - PAY);
    });

    it('fund emits RobotFunded and anyone can fund', async () => {
      const { escrow, robot, stranger } = await loadFixture(deploy);
      await expect(escrow.connect(stranger).fund(robot.address, { value: 5n }))
        .to.emit(escrow, 'RobotFunded')
        .withArgs(robot.address, stranger.address, 5n, ethers.parseEther('0.01') + 5n);
    });

    it('registerRobot rotates the agent and keeps the balance', async () => {
      const { escrow, robot, stranger, agent } = await loadFixture(deploy);
      await expect(escrow.registerRobot(robot.address, stranger.address))
        .to.emit(escrow, 'RobotRegistered')
        .withArgs(robot.address, stranger.address);
      expect(await escrow.robotBalance(robot.address)).to.equal(ethers.parseEther('0.01'));
      await expect(escrow.connect(agent).postBounty(robot.address, PAY, WINDOW)).to.be.revertedWithCustomError(
        escrow,
        'NotRobotAgent',
      );
      await expect(escrow.connect(stranger).postBounty(robot.address, PAY, WINDOW)).to.emit(escrow, 'BountyPosted');
    });

    it('withdraw sends un-escrowed balance to the agent-chosen address', async () => {
      const { escrow, agent, robot, stranger } = await loadFixture(deploy);
      const wTx = await escrow.connect(agent).withdraw(robot.address, stranger.address, 7n);
      await expect(wTx).to.emit(escrow, 'RobotWithdrawn');
      await expect(wTx).to.changeEtherBalances([stranger, escrow], [7n, -7n]);
    });

    it('setMaxPayout emits and takes effect', async () => {
      const { escrow, agent, robot } = await loadFixture(deploy);
      await expect(escrow.setMaxPayout(PAY - 1n)).to.emit(escrow, 'MaxPayoutSet').withArgs(MAX, PAY - 1n);
      await expect(escrow.connect(agent).postBounty(robot.address, PAY, WINDOW))
        .to.be.revertedWithCustomError(escrow, 'PayoutTooHigh')
        .withArgs(PAY, PAY - 1n);
    });
  });

  describe('fail path: claim → expire', () => {
    it('expire after the window refunds the robot; settle then reverts', async () => {
      const { escrow, agent, robot, stranger, id } = await loadFixture(withClaimedBounty);
      const before = await escrow.robotBalance(robot.address);
      await expect(escrow.connect(stranger).expire(id)).to.be.revertedWithCustomError(escrow, 'ClaimNotExpired');

      await time.increase(WINDOW + 1n);
      await expect(escrow.connect(agent).settle(id, REQ, ROOT)).to.be.revertedWithCustomError(escrow, 'ClaimExpired');

      await expect(escrow.connect(stranger).expire(id))
        .to.emit(escrow, 'BountyExpired')
        .withArgs(id, stranger.address, PAY);
      expect(await escrow.robotBalance(robot.address)).to.equal(before + PAY);
      expect((await escrow.getBounty(id)).status).to.equal(4n); // Expired

      await expect(escrow.connect(agent).settle(id, REQ, ROOT)).to.be.revertedWithCustomError(escrow, 'NotClaimed');
      await expect(escrow.expire(id)).to.be.revertedWithCustomError(escrow, 'NotClaimed');
    });
  });

  describe('same human, same bounty', () => {
    it('the same humanHash can never claim the same bounty twice', async () => {
      const { escrow, agent, worker, stranger, id } = await loadFixture(withClaimedBounty);
      // While the claim is active, same human (even with a different wallet) → HumanAlreadyClaimed.
      await expect(escrow.connect(agent).claim(id, stranger.address, H1)).to.be.revertedWithCustomError(
        escrow,
        'HumanAlreadyClaimed',
      );
      // A different human hits the one-active-claim rule instead.
      await expect(escrow.connect(agent).claim(id, worker.address, H2)).to.be.revertedWithCustomError(
        escrow,
        'BountyNotOpen',
      );
      // After expiry the record persists.
      await time.increase(WINDOW + 1n);
      await escrow.expire(id);
      await expect(escrow.connect(agent).claim(id, worker.address, H1)).to.be.revertedWithCustomError(
        escrow,
        'HumanAlreadyClaimed',
      );
    });

    it('the same human may claim a different bounty', async () => {
      const { escrow, agent, robot, worker } = await loadFixture(withClaimedBounty);
      await escrow.connect(agent).postBounty(robot.address, PAY, WINDOW);
      await expect(escrow.connect(agent).claim(2n, worker.address, H1)).to.emit(escrow, 'BountyClaimed');
    });
  });

  describe('pause', () => {
    it('blocks settle, withdraw, postBounty, claim', async () => {
      const { escrow, agent, robot, worker, id } = await loadFixture(withClaimedBounty);
      await escrow.connect(agent).postBounty(robot.address, PAY, WINDOW); // #2 open
      await expect(escrow.pause()).to.emit(escrow, 'ContractPaused');
      await expect(escrow.connect(agent).settle(id, REQ, ROOT)).to.be.revertedWithCustomError(escrow, 'Paused');
      await expect(escrow.connect(agent).withdraw(robot.address, agent.address, 1n)).to.be.revertedWithCustomError(
        escrow,
        'Paused',
      );
      await expect(escrow.connect(agent).postBounty(robot.address, PAY, WINDOW)).to.be.revertedWithCustomError(
        escrow,
        'Paused',
      );
      await expect(escrow.connect(agent).claim(2n, worker.address, H2)).to.be.revertedWithCustomError(escrow, 'Paused');
    });

    it('still allows cancel and expire (and fund)', async () => {
      const { escrow, agent, robot, stranger, id } = await loadFixture(withClaimedBounty);
      await escrow.connect(agent).postBounty(robot.address, PAY, WINDOW); // #2 open
      const before = await escrow.robotBalance(robot.address);
      await escrow.pause();

      await expect(escrow.connect(agent).cancel(2n)).to.emit(escrow, 'BountyCancelled').withArgs(2n, PAY);
      await time.increase(WINDOW + 1n);
      await expect(escrow.connect(stranger).expire(id)).to.emit(escrow, 'BountyExpired');
      await expect(escrow.fund(robot.address, { value: 1n })).to.emit(escrow, 'RobotFunded');
      expect(await escrow.robotBalance(robot.address)).to.equal(before + 2n * PAY + 1n);
    });

    it('unpause restores settle', async () => {
      const { escrow, agent, id } = await loadFixture(withClaimedBounty);
      await escrow.pause();
      await expect(escrow.unpause()).to.emit(escrow, 'ContractUnpaused');
      await expect(escrow.connect(agent).settle(id, REQ, ROOT)).to.emit(escrow, 'BountySettled');
    });
  });

  describe('cancel', () => {
    it('agent cancels an unclaimed bounty and the robot is refunded', async () => {
      const { escrow, agent, robot, id } = await loadFixture(withOpenBounty);
      const before = await escrow.robotBalance(robot.address);
      await expect(escrow.connect(agent).cancel(id)).to.emit(escrow, 'BountyCancelled').withArgs(id, PAY);
      expect(await escrow.robotBalance(robot.address)).to.equal(before + PAY);
      expect((await escrow.getBounty(id)).status).to.equal(5n);
    });
  });

  describe('every revert', () => {
    it('NotOwner: registerRobot, setMaxPayout, pause, unpause', async () => {
      const { escrow, stranger, robot } = await loadFixture(deploy);
      const s = escrow.connect(stranger);
      await expect(s.registerRobot(robot.address, stranger.address)).to.be.revertedWithCustomError(escrow, 'NotOwner');
      await expect(s.setMaxPayout(1n)).to.be.revertedWithCustomError(escrow, 'NotOwner');
      await expect(s.pause()).to.be.revertedWithCustomError(escrow, 'NotOwner');
      await escrow.pause();
      await expect(s.unpause()).to.be.revertedWithCustomError(escrow, 'NotOwner');
    });

    it('NotRobotAgent: postBounty, claim, settle, cancel, withdraw by a non-agent', async () => {
      const { escrow, agent, agent2, robot, worker, stranger } = await loadFixture(deploy);
      await escrow.connect(agent).postBounty(robot.address, PAY, WINDOW); // #1
      await escrow.connect(agent).postBounty(robot.address, PAY, WINDOW); // #2
      await escrow.connect(agent).claim(2n, worker.address, H1);
      // agent2 is a real agent, but of a different robot
      for (const who of [stranger, agent2]) {
        const s = escrow.connect(who);
        await expect(s.postBounty(robot.address, PAY, WINDOW)).to.be.revertedWithCustomError(escrow, 'NotRobotAgent');
        await expect(s.claim(1n, worker.address, H2)).to.be.revertedWithCustomError(escrow, 'NotRobotAgent');
        await expect(s.settle(2n, REQ, ROOT)).to.be.revertedWithCustomError(escrow, 'NotRobotAgent');
        await expect(s.cancel(1n)).to.be.revertedWithCustomError(escrow, 'NotRobotAgent');
        await expect(s.withdraw(robot.address, who.address, 1n)).to.be.revertedWithCustomError(escrow, 'NotRobotAgent');
      }
    });

    it('RobotNotRegistered: fund, postBounty', async () => {
      const { escrow, agent, stranger } = await loadFixture(deploy);
      await expect(escrow.fund(stranger.address, { value: 1n })).to.be.revertedWithCustomError(
        escrow,
        'RobotNotRegistered',
      );
      await expect(escrow.connect(agent).postBounty(stranger.address, PAY, WINDOW)).to.be.revertedWithCustomError(
        escrow,
        'RobotNotRegistered',
      );
    });

    it('ZeroAddress: registerRobot, claim worker, withdraw to', async () => {
      const { escrow, agent, robot } = await loadFixture(withOpenBounty);
      await expect(escrow.registerRobot(ethers.ZeroAddress, agent.address)).to.be.revertedWithCustomError(
        escrow,
        'ZeroAddress',
      );
      await expect(escrow.registerRobot(robot.address, ethers.ZeroAddress)).to.be.revertedWithCustomError(
        escrow,
        'ZeroAddress',
      );
      await expect(escrow.connect(agent).claim(1n, ethers.ZeroAddress, H1)).to.be.revertedWithCustomError(
        escrow,
        'ZeroAddress',
      );
      await expect(escrow.connect(agent).withdraw(robot.address, ethers.ZeroAddress, 1n)).to.be.revertedWithCustomError(
        escrow,
        'ZeroAddress',
      );
    });

    it('ZeroAmount: fund 0, postBounty 0, withdraw 0', async () => {
      const { escrow, agent, robot } = await loadFixture(deploy);
      await expect(escrow.fund(robot.address, { value: 0n })).to.be.revertedWithCustomError(escrow, 'ZeroAmount');
      await expect(escrow.connect(agent).postBounty(robot.address, 0n, WINDOW)).to.be.revertedWithCustomError(
        escrow,
        'ZeroAmount',
      );
      await expect(escrow.connect(agent).withdraw(robot.address, agent.address, 0n)).to.be.revertedWithCustomError(
        escrow,
        'ZeroAmount',
      );
    });

    it('PayoutTooHigh', async () => {
      const { escrow, agent, robot } = await loadFixture(deploy);
      await expect(escrow.connect(agent).postBounty(robot.address, MAX + 1n, WINDOW))
        .to.be.revertedWithCustomError(escrow, 'PayoutTooHigh')
        .withArgs(MAX + 1n, MAX);
      await expect(escrow.connect(agent).postBounty(robot.address, MAX, WINDOW)).to.emit(escrow, 'BountyPosted');
    });

    it('InsufficientBalance: postBounty beyond balance (escrowed funds count), withdraw beyond balance', async () => {
      const { escrow, agent2, robot2 } = await loadFixture(deploy);
      await escrow.fund(robot2.address, { value: PAY });
      await escrow.connect(agent2).postBounty(robot2.address, PAY, WINDOW); // escrows all of it
      await expect(escrow.connect(agent2).postBounty(robot2.address, 1n, WINDOW))
        .to.be.revertedWithCustomError(escrow, 'InsufficientBalance')
        .withArgs(0n, 1n);
      await expect(escrow.connect(agent2).withdraw(robot2.address, agent2.address, 1n))
        .to.be.revertedWithCustomError(escrow, 'InsufficientBalance')
        .withArgs(0n, 1n);
    });

    it('InvalidClaimWindow: 0 and > 30 days', async () => {
      const { escrow, agent, robot } = await loadFixture(deploy);
      await expect(escrow.connect(agent).postBounty(robot.address, PAY, 0n)).to.be.revertedWithCustomError(
        escrow,
        'InvalidClaimWindow',
      );
      await expect(
        escrow.connect(agent).postBounty(robot.address, PAY, 30n * 86400n + 1n),
      ).to.be.revertedWithCustomError(escrow, 'InvalidClaimWindow');
    });

    it('InvalidHumanHash: zero hash', async () => {
      const { escrow, agent, worker } = await loadFixture(withOpenBounty);
      await expect(escrow.connect(agent).claim(1n, worker.address, ethers.ZeroHash)).to.be.revertedWithCustomError(
        escrow,
        'InvalidHumanHash',
      );
    });

    it('BountyNotFound: claim, settle, expire, cancel on an unknown id', async () => {
      const { escrow, agent, worker } = await loadFixture(deploy);
      await expect(escrow.connect(agent).claim(99n, worker.address, H1)).to.be.revertedWithCustomError(
        escrow,
        'BountyNotFound',
      );
      await expect(escrow.connect(agent).settle(99n, REQ, ROOT)).to.be.revertedWithCustomError(escrow, 'BountyNotFound');
      await expect(escrow.expire(99n)).to.be.revertedWithCustomError(escrow, 'BountyNotFound');
      await expect(escrow.connect(agent).cancel(99n)).to.be.revertedWithCustomError(escrow, 'BountyNotFound');
    });

    it('BountyNotOpen: claim on claimed/settled/cancelled, cancel on claimed/settled', async () => {
      const { escrow, agent, robot, worker, id } = await loadFixture(withClaimedBounty);
      await expect(escrow.connect(agent).cancel(id)).to.be.revertedWithCustomError(escrow, 'BountyNotOpen');
      await escrow.connect(agent).settle(id, REQ, ROOT);
      await expect(escrow.connect(agent).claim(id, worker.address, H2)).to.be.revertedWithCustomError(
        escrow,
        'BountyNotOpen',
      );
      await expect(escrow.connect(agent).cancel(id)).to.be.revertedWithCustomError(escrow, 'BountyNotOpen');
      await escrow.connect(agent).postBounty(robot.address, PAY, WINDOW); // #2
      await escrow.connect(agent).cancel(2n);
      await expect(escrow.connect(agent).claim(2n, worker.address, H1)).to.be.revertedWithCustomError(
        escrow,
        'BountyNotOpen',
      );
      await expect(escrow.connect(agent).cancel(2n)).to.be.revertedWithCustomError(escrow, 'BountyNotOpen');
    });

    it('NotClaimed: settle/expire on an open or cancelled bounty', async () => {
      const { escrow, agent, id } = await loadFixture(withOpenBounty);
      await expect(escrow.connect(agent).settle(id, REQ, ROOT)).to.be.revertedWithCustomError(escrow, 'NotClaimed');
      await expect(escrow.expire(id)).to.be.revertedWithCustomError(escrow, 'NotClaimed');
      await escrow.connect(agent).cancel(id);
      await expect(escrow.connect(agent).settle(id, REQ, ROOT)).to.be.revertedWithCustomError(escrow, 'NotClaimed');
      await expect(escrow.expire(id)).to.be.revertedWithCustomError(escrow, 'NotClaimed');
    });

    it('ClaimExpired: settle after the window', async () => {
      const { escrow, agent, id } = await loadFixture(withClaimedBounty);
      await time.increase(WINDOW + 1n);
      await expect(escrow.connect(agent).settle(id, REQ, ROOT)).to.be.revertedWithCustomError(escrow, 'ClaimExpired');
    });

    it('ClaimNotExpired: expire inside the window', async () => {
      const { escrow, id } = await loadFixture(withClaimedBounty);
      await expect(escrow.expire(id)).to.be.revertedWithCustomError(escrow, 'ClaimNotExpired');
    });

    it('AlreadySettled: settle or expire a settled bounty', async () => {
      const { escrow, agent, id } = await loadFixture(withClaimedBounty);
      await escrow.connect(agent).settle(id, REQ, ROOT);
      await expect(escrow.connect(agent).settle(id, REQ, ROOT)).to.be.revertedWithCustomError(escrow, 'AlreadySettled');
      await time.increase(WINDOW + 1n);
      await expect(escrow.expire(id)).to.be.revertedWithCustomError(escrow, 'AlreadySettled');
    });

    it('HumanAlreadyClaimed', async () => {
      const { escrow, agent, worker, id } = await loadFixture(withClaimedBounty);
      await expect(escrow.connect(agent).claim(id, worker.address, H1)).to.be.revertedWithCustomError(
        escrow,
        'HumanAlreadyClaimed',
      );
    });

    it('Paused: pause twice; NotPaused: unpause when running', async () => {
      const { escrow } = await loadFixture(deploy);
      await expect(escrow.unpause()).to.be.revertedWithCustomError(escrow, 'NotPaused');
      await escrow.pause();
      await expect(escrow.pause()).to.be.revertedWithCustomError(escrow, 'Paused');
    });

    it('TransferFailed: settle to a worker that rejects native transfers', async () => {
      const { escrow, agent, id } = await loadFixture(withOpenBounty);
      const rej = await (await ethers.getContractFactory('RejectingReceiver')).deploy();
      await escrow.connect(agent).claim(id, await rej.getAddress(), H1);
      await expect(escrow.connect(agent).settle(id, REQ, ROOT)).to.be.revertedWithCustomError(escrow, 'TransferFailed');
      // state rolled back: still claimed
      expect((await escrow.getBounty(id)).status).to.equal(2n);
    });

    it('Reentrancy: worker re-entering withdraw during settle is blocked', async () => {
      const { escrow, owner } = await loadFixture(deploy);
      const att = await (await ethers.getContractFactory('ReentrantAgent')).deploy(await escrow.getAddress());
      const attAddr = await att.getAddress();
      const fakeRobot = ethers.Wallet.createRandom().address;
      await att.setRobot(fakeRobot);
      await escrow.connect(owner).registerRobot(fakeRobot, attAddr);
      await escrow.fund(fakeRobot, { value: PAY * 2n });
      await att.post(PAY, WINDOW);
      await att.claimSelf(1n, H1);
      await expect(att.settle(1n)).to.emit(escrow, 'BountySettled');
      expect(await att.attempted()).to.equal(true);
      const selector = escrow.interface.getError('Reentrancy').selector;
      expect(await att.lastRevert()).to.equal(selector);
      expect(await escrow.robotBalance(fakeRobot)).to.equal(PAY); // withdraw did not happen
    });
  });
});
