/**
 * ORIGINAL_DESIGN_V2 initial-verification policy.
 *
 * V1 stays immutable for replay/history. V2 changes only the first pending
 * verification round: silence or insufficient support can no longer promote a
 * claim. If neither ordinary side reaches its snapshotted threshold within the
 * 30-day window, the claim is INCORRECT.
 */
import {
  ACTIVE_BALANCE_FLOOR,
  ATOMS_PER_ENERGY,
  ROUND_DURATION_MS,
  ordinaryVotesRequired,
  challengePolicy,
  currentAccuracy,
  nextStakeTier,
  settlementEntitlements,
  sideForVerdict,
  canActivelyLock,
  type Entitlement,
  type EscalationPolicy,
  type Position,
  type ScopeGate,
  type Side,
  type Verdict,
  type WeightedPosition,
} from '../v1/original-design-policy';

export {
  ACTIVE_BALANCE_FLOOR,
  ATOMS_PER_ENERGY,
  ROUND_DURATION_MS,
  ordinaryVotesRequired,
  challengePolicy,
  currentAccuracy,
  nextStakeTier,
  settlementEntitlements,
  sideForVerdict,
  canActivelyLock,
};
export type {
  Entitlement,
  EscalationPolicy,
  Position,
  ScopeGate,
  Side,
  Verdict,
  WeightedPosition,
};

export const POLICY_VERSION = 'ORIGINAL_DESIGN_V2' as const;

export interface InsufficientSupportTimeoutDecision {
  verdict: 'INCORRECT';
  tied: false;
  /**
   * If at least one ordinary DISAGREE voter exists they are the winning
   * ordinary side and receive the normal ordinary-pool settlement. If nobody
   * opposed the claim there is no user winner, so failed ordinary AGREE stakes
   * remain in the system account.
   */
  ordinaryWinner: 'DISAGREE' | 'SYSTEM';
}

/**
 * V2 timeout rule for a still-unresolved first round.
 *
 * This function must only be called when neither side has already reached the
 * frozen ordinary-vote threshold. Threshold wins are handled immediately and
 * never reach this timeout path.
 */
export function insufficientSupportTimeoutDecision(
  agreeOrdinary: number,
  disagreeOrdinary: number,
  requiredVotes: number,
): InsufficientSupportTimeoutDecision {
  for (const [name, value] of [
    ['agreeOrdinary', agreeOrdinary],
    ['disagreeOrdinary', disagreeOrdinary],
    ['requiredVotes', requiredVotes],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < (name === 'requiredVotes' ? 1 : 0)) {
      throw new RangeError(`${name} is invalid`);
    }
  }
  if (agreeOrdinary >= requiredVotes || disagreeOrdinary >= requiredVotes) {
    throw new RangeError('timeout decision only applies before either side reaches threshold');
  }
  return {
    verdict: 'INCORRECT',
    tied: false,
    ordinaryWinner: disagreeOrdinary > 0 ? 'DISAGREE' : 'SYSTEM',
  };
}
