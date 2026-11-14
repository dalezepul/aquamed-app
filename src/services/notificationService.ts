import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { BeverageType } from '../types/models';
import { storageService, newId, fluidCeiling } from './storageService';
import { dynamicGoalService } from './dynamicGoalService';
import { planNotifications, PlannedData, PlannedNotification, MAX_PENDING } from './notificationPlan';
import { getLocalDayString } from '../utils/DateUtils';
import { t } from '../localization/i18n';
import { recordError } from './crash';
import { CONTACT_ALERT_ENABLED } from '../utils/contactAlert';

/** Default "I drank" amount; the user can change it (AppSettings.waterReminder.drinkAmountMl). */
export const WATER_ACTION_ML = 250;

const CATEGORY = { DOSE: 'dose_actions', WATER: 'water_actions', ESCALATION: 'escalation_actions' };
// Android caches a channel's sound/vibration forever, so changing them needs new ids (v2: short, gentle vibration).
const CHANNEL = { DOSE: 'doses_v2', WATER: 'water_v2', ESCALATION: 'escalation_v2' };
const OLD_CHANNELS = ['doses', 'water', 'escalation'];
/** Every notification we schedule carries one of these `data.type`s; anything else isn't ours. */
const OUR_TYPES = new Set(['dose', 'dose_presleep', 'escalation', 'water', 'nudge', 'snooze', 'reopen']);

export type NotificationData = PlannedData | ({ type: 'snooze'; of: PlannedData });

const isWeb = Platform.OS === 'web';
/** The escalation is a "tell your contact" reminder to the user: none while the contact feature is off. */
const hasContact = (c: { phone: string }) => CONTACT_ALERT_ENABLED && !!c.phone;
/** DevTools caregiver-alarm tests: `care_` like the real ones, but never replaced by a sync. */
export const CARE_TEST_PREFIX = 'care_test_';

class NotificationService {
  private initialized = false;
  private running: Promise<void> | null = null;
  private dirty = false;
  private drinkMl = WATER_ACTION_ML;
  private waterMessage = '';
  /** Slots held by caregiver alarms (setCareAlarms); the patient plan gets the rest. */
  private careSlots = 0;

  /** Call once at startup: foreground behaviour, Android channels, action buttons. */
  async init(): Promise<void> {
    if (this.initialized || isWeb) return;
    this.initialized = true;
    Notifications.setNotificationHandler({
      // A data-only caregiver push has nothing to show: careTask.ts presents its own notification.
      handleNotification: async n => {
        const show = (n.request.content.data as any)?.type !== 'care_event';
        return { shouldPlaySound: show, shouldSetBadge: false, shouldShowBanner: show, shouldShowList: show };
      },
    });
    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync(CHANNEL.DOSE, {
          name: t('notifications.channel_doses'),
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 120],
          sound: 'default',
        });
        await Notifications.setNotificationChannelAsync(CHANNEL.ESCALATION, {
          name: t('notifications.channel_escalation'),
          importance: Notifications.AndroidImportance.MAX,
          sound: 'default',
        });
        await Notifications.setNotificationChannelAsync(CHANNEL.WATER, {
          name: t('notifications.channel_water'),
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }
      for (const id of OLD_CHANNELS) await Notifications.deleteNotificationChannelAsync(id).catch(() => {});
      await this.setupCategories();
    } catch (e) {
      console.warn('[Notifications] init failed', e);
      recordError(e, 'notifications.init');
    }
  }

  /** Button labels depend on the language, so this re-runs after a language change. */
  async setupCategories(): Promise<void> {
    if (isWeb) return;
    await Notifications.setNotificationCategoryAsync(CATEGORY.DOSE, [
      { identifier: 'TAKE', buttonTitle: t('notifications.take_action'), options: { opensAppToForeground: true } },
      { identifier: 'SNOOZE', buttonTitle: t('notifications.snooze_action', { minutes: 15 }), options: { opensAppToForeground: false } },
    ]);
    await Notifications.setNotificationCategoryAsync(CATEGORY.WATER, [
      { identifier: 'DRINK', buttonTitle: t('notifications.drink_action', { amount: this.drinkMl }), options: { opensAppToForeground: false } },
      { identifier: 'SNOOZE', buttonTitle: t('notifications.snooze_action', { minutes: 30 }), options: { opensAppToForeground: false } },
    ]);
    // "Notify my contact" only exists while the SMS/WhatsApp feature is on (escalations aren't planned otherwise).
    if (CONTACT_ALERT_ENABLED) await Notifications.setNotificationCategoryAsync(CATEGORY.ESCALATION, [
      { identifier: 'NOTIFY_CONTACT', buttonTitle: t('notifications.notify_contact_action'), options: { opensAppToForeground: true } },
    ]);
    else await Notifications.deleteNotificationCategoryAsync(CATEGORY.ESCALATION).catch(() => {});
  }

  async hasPermission(): Promise<boolean> {
    if (isWeb) return false;
    return (await Notifications.getPermissionsAsync()).status === 'granted';
  }

  async ensurePermissions(): Promise<boolean> {
    if (isWeb) return false;
    if (await this.hasPermission()) return true;
    return (await Notifications.requestPermissionsAsync()).status === 'granted';
  }

  /**
   * Cancel our pending notifications and schedule the current plan.
   * Safe to call often: concurrent calls collapse into one extra run.
   */
  rescheduleAll(): Promise<void> {
    if (isWeb) return Promise.resolve();
    if (this.running) {
      this.dirty = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.dirty = false;
        try {
          await this.rescheduleOnce();
        } catch (e) {
          console.warn('[Notifications] reschedule failed', e);
          recordError(e, 'notifications.reschedule');
        }
      } while (this.dirty);
    })().finally(() => { this.running = null; });
    return this.running;
  }

  private async rescheduleOnce(): Promise<void> {
    if (!(await this.hasPermission())) return;
    const now = new Date();
    const [meds, logs, settings, sleep, contact, waterToday, waterGoal, todayLogs, streak] = await Promise.all([
      storageService.getMedications(),
      storageService.getAllMedicationLogs(),
      storageService.getAppSettings(),
      storageService.getSleepMode(),
      storageService.getEmergencyContact(),
      storageService.getDailyWater(getLocalDayString(now)),
      dynamicGoalService.getTodayEffectiveGoal(now),
      storageService.getWaterLogsByDate(getLocalDayString(now)),
      storageService.calculateCurrentStreak(now),
    ]);
    this.waterMessage = settings.waterReminder.message ?? '';
    const drinkMl = settings.waterReminder.drinkAmountMl || WATER_ACTION_ML;
    if (drinkMl !== this.drinkMl) {
      this.drinkMl = drinkMl;
      await this.setupCategories(); // button label shows the amount
    }
    // Caregiver mode: no own water/medication reminders at all (care_ alarms are separate, see setCareAlarms).
    const plan = settings.appMode === 'caregiver' ? [] : planNotifications({
      meds, logs, settings, sleep, now, waterToday, waterGoal,
      hasEmergencyContact: hasContact(contact),
      fluidToday: todayLogs.reduce((sum, l) => sum + l.amountMl, 0),
      fluidCeilingMl: fluidCeiling(settings),
      streak,
      maxPending: MAX_PENDING - this.careSlots,
    });

    // Snoozes the user asked for and DevTools tests survive a re-plan (a test is scheduled right before one).
    await this.cancelOurs(n => n.type !== 'snooze' && !n.test);
    const medById = new Map(meds.map(m => [m.id, m]));
    for (const p of plan) {
      const content = this.contentFor(p.data, medById.get((p.data as any).medicationId), contact.name);
      if (content) await this.scheduleAt(p.at, content);
    }
  }

  private contentFor(data: PlannedData, med: { name: string; dosage?: string } | undefined, contactName: string): Notifications.NotificationContentInput | null {
    switch (data.type) {
      case 'dose':
        if (!med) return null;
        return {
          title: t('notifications.med_time', { name: med.name }),
          body: t('notifications.med_body', { dosage: med.dosage || t('notifications.med_default_dose') }),
          categoryIdentifier: CATEGORY.DOSE,
          data,
          ...(Platform.OS === 'android' ? { channelId: CHANNEL.DOSE } : {}),
        } as any;
      case 'dose_presleep':
        if (!med) return null;
        return {
          title: t('notifications.med_sleep_info_title'),
          body: t('notifications.med_sleep_info_body', { name: med.name, time: data.time }),
          data,
          ...(Platform.OS === 'android' ? { channelId: CHANNEL.DOSE } : {}),
        } as any;
      case 'escalation':
        if (!med) return null;
        return {
          title: t('notifications.escalation_title', { name: med.name }),
          body: t('notifications.escalation_body', { name: med.name, time: data.time, contact: contactName || t('emergency.contact') }),
          categoryIdentifier: CATEGORY.ESCALATION,
          data,
          ...(Platform.OS === 'android' ? { channelId: CHANNEL.ESCALATION } : {}),
        } as any;
      case 'nudge':
        return {
          title: data.streak > 0 ? t('notifications.nudge_title_streak', { days: data.streak }) : t('notifications.nudge_title'),
          body: t('notifications.nudge_body', { ml: Math.round(data.remainingMl / 50) * 50 }),
          categoryIdentifier: CATEGORY.WATER,
          data,
          ...(Platform.OS === 'android' ? { channelId: CHANNEL.WATER } : {}),
        } as any;
      case 'water':
        return {
          title: t('notifications.water_time'),
          body: this.waterMessage.trim() || t('notifications.water_body_generic'),
          categoryIdentifier: CATEGORY.WATER,
          data,
          ...(Platform.OS === 'android' ? { channelId: CHANNEL.WATER } : {}),
        } as any;
      case 'reopen':
        return {
          title: t('notifications.reopen_title'),
          body: t('notifications.reopen_body'),
          data,
          ...(Platform.OS === 'android' ? { channelId: CHANNEL.DOSE } : {}),
        } as any;
    }
  }

  private async scheduleAt(at: Date, content: Notifications.NotificationContentInput): Promise<string> {
    return Notifications.scheduleNotificationAsync({
      content,
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: at,
        ...(Platform.OS === 'android' && (content as any).channelId ? { channelId: (content as any).channelId } : {}),
      } as Notifications.DateTriggerInput,
    });
  }

  private async cancelOurs(filter: (data: any) => boolean = () => true): Promise<void> {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of pending) {
      const data = n.content.data as any;
      if (data && OUR_TYPES.has(data.type) && filter(data)) {
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
      }
    }
  }

  /**
   * Caregiver side: replace every pending `care_` alarm with `list`. Separate id prefix and
   * data.type, so rescheduleAll() never touches them (and they never touch the patient plan).
   * DevTools test alarms (CARE_TEST_PREFIX) are left alone so a sync can't erase a pending test.
   */
  async setCareAlarms(list: { id: string; at: Date; title: string; body: string; data: Record<string, unknown> }[]): Promise<void> {
    if (isWeb || !(await this.hasPermission())) return;
    for (const n of await Notifications.getAllScheduledNotificationsAsync()) {
      if (n.identifier.startsWith('care_') && !n.identifier.startsWith(CARE_TEST_PREFIX)) await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
    for (const a of list) {
      await Notifications.scheduleNotificationAsync({
        identifier: a.id,
        content: { title: a.title, body: a.body, data: a.data, ...(Platform.OS === 'android' ? { channelId: CHANNEL.ESCALATION } : {}) } as any,
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: a.at, ...(Platform.OS === 'android' ? { channelId: CHANNEL.ESCALATION } : {}) } as Notifications.DateTriggerInput,
      });
    }
    if (list.length !== this.careSlots) {
      this.careSlots = list.length;
      await this.rescheduleAll();
    }
  }

  /** Re-show a dose or water reminder after `minutes`. */
  async snooze(of: PlannedData, minutes: number): Promise<void> {
    if (isWeb) return;
    const med = 'medicationId' in of ? await storageService.getMedication(of.medicationId) : null;
    const base = this.contentFor(of, med ?? undefined, '');
    if (!base) return;
    await this.scheduleAt(new Date(Date.now() + minutes * 60000), {
      ...base,
      title: of.type === 'water' ? t('notifications.water_snoozed') : t('notifications.med_snoozed', { name: med?.name ?? '' }),
      data: { type: 'snooze', of },
    });
  }

  /** "I drank" from the notification without opening the app. */
  async logWaterFromNotification(): Promise<void> {
    const amount = (await storageService.getAppSettings()).waterReminder.drinkAmountMl || WATER_ACTION_ML;
    await storageService.saveWaterLog({
      id: newId(),
      amountMl: amount,
      hydrationAmountMl: amount,
      beverageType: BeverageType.Water,
      timestamp: new Date().toISOString(),
    });
    await this.rescheduleAll(); // stops today's reminders if the goal is now met
  }

  // --- DevTools ---------------------------------------------------------------

  async getPending(): Promise<Notifications.NotificationRequest[]> {
    if (isWeb) return [];
    return Notifications.getAllScheduledNotificationsAsync();
  }

  async cancelAll(): Promise<void> {
    if (!isWeb) await Notifications.cancelAllScheduledNotificationsAsync();
  }

  /** Fire a sample of a planned notification in `seconds` (DevTools). */
  async sendTest(data: PlannedData, seconds = 2): Promise<void> {
    if (isWeb) throw new Error('Notifications are not available on web');
    if (!(await this.ensurePermissions())) throw new Error('Notification permission denied');
    const med = 'medicationId' in data ? await storageService.getMedication(data.medicationId) : null;
    const content = this.contentFor(data, med ?? { name: t('notifications.test_med') }, '');
    if (content) await this.scheduleAt(new Date(Date.now() + seconds * 1000), { ...content, data: { ...content.data, test: true } });
  }

  /** Exposed for DevTools preview. */
  async previewPlan(): Promise<PlannedNotification[]> {
    const now = new Date();
    const [meds, logs, settings, sleep, contact, waterToday, waterGoal, todayLogs, streak] = await Promise.all([
      storageService.getMedications(),
      storageService.getAllMedicationLogs(),
      storageService.getAppSettings(),
      storageService.getSleepMode(),
      storageService.getEmergencyContact(),
      storageService.getDailyWater(getLocalDayString(now)),
      dynamicGoalService.getTodayEffectiveGoal(now),
      storageService.getWaterLogsByDate(getLocalDayString(now)),
      storageService.calculateCurrentStreak(now),
    ]);
    return planNotifications({
      meds, logs, settings, sleep, now, waterToday, waterGoal, hasEmergencyContact: hasContact(contact),
      fluidToday: todayLogs.reduce((sum, l) => sum + l.amountMl, 0), fluidCeilingMl: fluidCeiling(settings), streak,
    });
  }
}

export const notificationService = new NotificationService();
