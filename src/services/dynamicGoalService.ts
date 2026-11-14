import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocalDayString } from '../utils/DateUtils';
import { t } from '../localization/i18n';
import { storageService } from './storageService';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Categories of goal adjustments that increase the daily water target. */
export type GoalAdjustmentType = 'hot_weather' | 'exercise' | 'caffeine';

/** A single adjustment entry applied to the daily water goal. */
export interface GoalAdjustment {
  id: string;
  type: GoalAdjustmentType;
  amountMl: number;
  timestamp: string;
  label: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STORAGE_KEY = '@aquamed_goal_adjustments';

/** Default extra ml per adjustment type */
const ADJUSTMENT_AMOUNTS: Record<GoalAdjustmentType, number> = {
  hot_weather: 500,
  exercise: 300,
  caffeine: 250,
};

/** Human-readable labels for each adjustment type */
const ADJUSTMENT_LABELS: Record<GoalAdjustmentType, string> = {
  hot_weather: 'Hot Weather',
  exercise: 'Exercise',
  caffeine: 'Caffeine Intake',
};

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * DynamicGoalService manages daily water goal adjustments.
 *
 * Users can manually add adjustments (hot weather, exercise, caffeine) that
 * increase their daily goal.
 */
class DynamicGoalService {
  // ─── Private Helpers ─────────────────────────────────────────────────

  /**
   * Reads all stored adjustments from AsyncStorage.
   */
  public async getAllAdjustments(): Promise<GoalAdjustment[]> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEY);
      if (!data || data === '') return [];
      return JSON.parse(data);
    } catch (error) {
      console.error('DynamicGoalService: Error reading adjustments', error);
      return [];
    }
  }

  /**
   * Persists the full adjustment list to AsyncStorage.
   */
  private async saveAllAdjustments(adjustments: GoalAdjustment[]): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(adjustments));
    } catch (error) {
      console.error('DynamicGoalService: Error saving adjustments', error);
      throw new Error('Failed to save goal adjustments');
    }
  }

  // ─── Fully Implemented Methods ───────────────────────────────────────

  /**
   * Adds a new goal adjustment for today.
   *
   * Amounts are fixed per type:
   *   - hot_weather → +500 ml
   *   - exercise    → +300 ml
   *   - caffeine    → +250 ml
   *
   * @param type The adjustment category.
   * @returns The newly created GoalAdjustment.
   */
  async addAdjustment(type: GoalAdjustmentType): Promise<GoalAdjustment> {
    // Check daily limit: each type can only be used once per day
    const todayAdj = await this.getTodayAdjustments();
    const alreadyUsed = todayAdj.some(adj => adj.type === type);
    if (alreadyUsed) {
      throw new Error('LIMIT_REACHED');
    }

    const adjustment: GoalAdjustment = {
      id: `adj_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      type,
      amountMl: ADJUSTMENT_AMOUNTS[type],
      timestamp: new Date().toISOString(),
      label: ADJUSTMENT_LABELS[type],
    };

    const all = await this.getAllAdjustments();
    all.push(adjustment);
    await this.saveAllAdjustments(all);

    return adjustment;
  }

  /**
   * Removes today's adjustment of `type` (all of today's when omitted) — the undo for a mistaken tap.
   * Returns how many were removed.
   */
  async removeTodayAdjustment(type?: GoalAdjustmentType, now: Date = new Date()): Promise<number> {
    const today = getLocalDayString(now);
    const all = await this.getAllAdjustments();
    const keep = all.filter(adj => getLocalDayString(new Date(adj.timestamp)) !== today || (type !== undefined && adj.type !== type));
    if (keep.length !== all.length) await this.saveAllAdjustments(keep);
    return all.length - keep.length;
  }

  /** Home's on/off chips: adds today's `type` if absent, removes it if present. Returns true when now on. */
  async toggleAdjustment(type: GoalAdjustmentType): Promise<boolean> {
    if (await this.removeTodayAdjustment(type)) return false;
    await this.addAdjustment(type);
    return true;
  }

  /**
   * Returns all adjustments whose timestamp falls on today (local time).
   */
  async getTodayAdjustments(now: Date = new Date()): Promise<GoalAdjustment[]> {
    const today = getLocalDayString(now);
    const all = await this.getAllAdjustments();
    return all.filter((adj) => {
      const adjDay = getLocalDayString(new Date(adj.timestamp));
      return adjDay === today;
    });
  }

  /**
   * Returns the sum of all adjustment amounts for today.
   */
  async getTodayTotalAdjustment(now: Date = new Date()): Promise<number> {
    const todayAdj = await this.getTodayAdjustments(now);
    return todayAdj.reduce((sum, adj) => sum + adj.amountMl, 0);
  }

  /**
   * Today's goal as Home shows it: base goal + today's adjustments. Water reminders, the
   * evening nudge and widgets use this so they don't go quiet before Home says "done".
   * Streaks deliberately stay on the recorded base goal (goal history) — adjustments are
   * not stored per past day, so counting them would rewrite old streaks.
   */
  async getTodayEffectiveGoal(now: Date = new Date()): Promise<number> {
    const [base, extra] = await Promise.all([storageService.getWaterGoal(), this.getTodayTotalAdjustment(now)]);
    return base + extra;
  }
}

// ─── Singleton Export ────────────────────────────────────────────────────────

export const dynamicGoalService = new DynamicGoalService();
