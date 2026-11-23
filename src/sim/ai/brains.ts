import type { EnemyKind } from '../types';
import { AEGIS_ACTIONS } from './aegis';
import { RUSHER_ACTIONS } from './rusher';
import { SNIPER_ACTIONS } from './sniper';
import { UtilityBrain } from './UtilityBrain';

/** One stateless brain per archetype; all per-enemy state lives on the Enemy itself. */
export const BRAINS: Record<EnemyKind, UtilityBrain> = {
  rusher: new UtilityBrain(RUSHER_ACTIONS),
  sniper: new UtilityBrain(SNIPER_ACTIONS),
  aegis: new UtilityBrain(AEGIS_ACTIONS),
};
