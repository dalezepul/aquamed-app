import { Badge } from '../types/models';

type BadgeDefinition = Omit<Badge, 'name' | 'description' | 'earned'>;

const def = (id: string, icon: string): BadgeDefinition => ({ id, icon, nameKey: `badges.${id}_n`, descKey: `badges.${id}_d` });

/**
 * Display order. Old ids (b1…) are kept where the meaning survived so earned badges stay earned.
 * Removed on purpose (rewarded drinking too much / late): b5, b6, b7, b8, b9, b12, b14, b15.
 */
export const BADGE_DEFINITIONS: BadgeDefinition[] = [
  // Getting started
  def('b1', '💧'),             // first water log
  def('first_med', '💊'),      // first medication added
  // Healthy drinking habits (never above the fluid ceiling)
  def('balanced_day', '⚖️'),   // 90–130% of the goal
  def('steady_sipper', '🕰️'),  // goal reached across ≥4 two-hour slots
  def('morning_water', '🌅'),  // water within an hour of waking, 7 days
  def('b13', '🚰'),            // goal with water only
  def('b16', '🍵'),            // water + tea + coffee in one day
  def('b11', '🫖'),            // 5 teas
  def('b23', '🎉'),            // goal on a weekend day
  // Medication
  def('b3', '✅'),             // 10 doses taken
  def('b17', '⚕️'),            // 50 doses taken
  def('b21', '⭐'),            // a high-priority dose taken
  def('b22', '⏱️'),            // a dose within ±30 min
  def('med_on_time_week', '🎯'), // 7 dose-days, every dose within ±30 min
  def('b18', '📅'),            // 30 dose-days, every dose taken
  def('b19', '🏥'),            // 5 medications
  def('b20', '📦'),            // stock tracking on
  def('stock_refill', '🔄'),   // restocked before running out (event)
  def('b24', '🗓️'),            // weekly / interval / cyclic schedule
  // Streaks: water goal (≤ ceiling) + all doses
  def('b2', '🔥'),
  def('b10', '🐪'),
  def('full_week', '🏅'),      // a whole Monday–Sunday week
  def('b27', '🥉'),
  def('b4', '🌊'),
  def('b28', '🥈'),
  def('b29', '🥇'),
  // Settings / app (events)
  def('b25', '🛡️'),
  def('b26', '🛌'),
  def('b30', '📈'),
];
