/**
 * Decision-loop wrapper with the 0G track's safe-stop rule:
 * if 0G can't produce a real decision, return an explicit UNAVAILABLE and stop the robot.
 * Never substitutes a local/fake decision.
 */
import { ZeroGUnreachable, type Decision, type DecisionEngine, type DecisionRequest } from '@pickle/shared';

export type DecideOutcome =
  | { status: 'OK'; decision: Decision }
  | { status: 'UNAVAILABLE'; reason: string; safeStopped: true };

export type SafeStop = (robotId: string, reason: string) => Promise<void> | void;

export async function decideOrSafeStop(
  engine: DecisionEngine,
  req: DecisionRequest,
  safeStop: SafeStop,
): Promise<DecideOutcome> {
  try {
    return { status: 'OK', decision: await engine.decide(req) };
  } catch (err) {
    if (!(err instanceof ZeroGUnreachable)) throw err;
    await safeStop(req.robotId, err.message);
    return { status: 'UNAVAILABLE', reason: err.message, safeStopped: true };
  }
}
