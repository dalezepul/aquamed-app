import React, { createContext, useContext, useReducer, useEffect, ReactNode, useState, useCallback } from 'react';
import { storageService, SleepModeSettings, EmergencyContact, UserMetrics, AppSettings, DEFAULT_APP_SETTINGS } from '../services/storageService';
import { setLocale, initI18n } from '../localization/i18n';
import { dynamicGoalService } from '../services/dynamicGoalService';
import { notificationService } from '../services/notificationService';
import { setHapticLevel, resolveHapticLevel } from '../utils/haptics';
import { refreshWidgets } from '../widgets';
import { initPairing, schedulePublish } from '../services/pairing';
import { scheduleCloudBackup } from '../services/cloudBackup';
import { recordError } from '../services/crash';

type ThemeMode = 'system' | 'light' | 'dark';
type Locale = 'en' | 'tr';

interface AppState {
  isInitialized: boolean;
  themeMode: ThemeMode;
  locale: Locale;
  isDevMode: boolean;
  sleepSettings: SleepModeSettings;
  emergencyContact: EmergencyContact;
  userName: string;
  waterGoal: number;
  userMetrics: UserMetrics;
  hasOnboarded: boolean;
  showDynamicGoalButtons: boolean;
  appSettings: AppSettings;
}

type SettableKey = keyof Omit<AppState, 'isInitialized' | 'hasOnboarded'>;

type Action =
  | { type: 'SET_INITIAL_STATE'; payload: Partial<AppState> }
  | { type: 'SET_VALUE'; key: SettableKey; payload: any }
  | { type: 'SET_HAS_ONBOARDED'; payload: boolean }
  | { type: 'RESET_STATE' };

interface AppContextType extends AppState {
  dispatch: React.Dispatch<Action>;
  refreshAppData: () => Promise<void>;
  todayDynamicAdjustment: number;
  refreshDynamicGoal: () => Promise<void>;
  customThemeColors: any;
  setCustomThemeColors: (colors: any) => void;
  /** Bumped whenever logs/medications change, so screens can re-fetch. */
  dataVersion: number;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const initialState: AppState = {
  isInitialized: false,
  themeMode: 'system',
  locale: 'tr',
  isDevMode: false,
  sleepSettings: { enabled: false, start: '22:00', end: '06:00' },
  emergencyContact: { name: '', phone: '' },
  userName: '',
  waterGoal: 2500,
  userMetrics: { height: undefined, weight: undefined },
  hasOnboarded: false,
  showDynamicGoalButtons: true,
  appSettings: DEFAULT_APP_SETTINGS,
};

// Persistence side effect for each settable key.
const PERSIST: Partial<Record<SettableKey, (v: any) => unknown>> = {
  themeMode: v => storageService.saveThemeMode(v),
  locale: v => { setLocale(v); return storageService.saveLanguage(v); },
  isDevMode: v => storageService.setDevMode(v),
  sleepSettings: v => storageService.saveSleepMode(v),
  emergencyContact: v => storageService.saveEmergencyContact(v),
  userName: v => storageService.saveUserName(v),
  waterGoal: v => storageService.saveWaterGoal(v),
  userMetrics: v => storageService.saveUserMetrics(v),
  showDynamicGoalButtons: v => storageService.saveShowDynamicGoalButtons(v),
  appSettings: v => storageService.saveAppSettings(v),
};

// Settings that change what/when/how notifications say things.
const AFFECTS_NOTIFICATIONS = new Set<SettableKey>(['locale', 'sleepSettings', 'emergencyContact', 'appSettings', 'waterGoal']);

const appReducer = (state: AppState, action: Action): AppState => {
  switch (action.type) {
    case 'SET_INITIAL_STATE':
      return { ...state, ...action.payload, isInitialized: true };
    case 'SET_HAS_ONBOARDED':
      storageService.setOnboarded(action.payload);
      return { ...state, hasOnboarded: action.payload };
    case 'RESET_STATE':
      return { ...initialState, isInitialized: true };
    case 'SET_VALUE':
      if (!(action.key in state)) return state;
      Promise.resolve(PERSIST[action.key]?.(action.payload)).then(async () => {
        if (action.key === 'locale') await notificationService.setupCategories();
        if (AFFECTS_NOTIFICATIONS.has(action.key)) await notificationService.rescheduleAll();
      }).catch(e => { console.warn('[AppContext] persist failed', action.key, e); recordError(e, `storage.persist.${action.key}`); });
      return { ...state, [action.key]: action.payload };
    default:
      return state;
  }
};

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [todayDynamicAdjustment, setTodayDynamicAdjustment] = useState<number>(0);
  const [customThemeColors, setCustomThemeColors] = useState<any>(null);
  const [dataVersion, setDataVersion] = useState(0);

  const loadInitialState = useCallback(async () => {
    try {
      await storageService.runMigrations();
      const [themeMode, locale, isDevMode, sleepSettings, emergencyContact, userName, waterGoal, userMetrics, hasOnboarded, todayDynamic, showDynamicGoalButtons, appSettings] = await Promise.all([
        storageService.getThemeMode(),
        storageService.getLanguage(),
        storageService.isDevMode(),
        storageService.getSleepMode(),
        storageService.getEmergencyContact(),
        storageService.getUserName(),
        storageService.getWaterGoal(),
        storageService.getUserMetrics(),
        storageService.getOnboarded(),
        dynamicGoalService.getTodayTotalAdjustment(),
        storageService.getShowDynamicGoalButtons(),
        storageService.getAppSettings(),
      ]);

      initI18n(locale);
      setTodayDynamicAdjustment(todayDynamic);
      // Channels/buttons are labelled in the user's language, so this comes after initI18n.
      notificationService.init().then(() => notificationService.rescheduleAll());
      dispatch({
        type: 'SET_INITIAL_STATE',
        payload: { themeMode, locale, isDevMode, sleepSettings, emergencyContact, userName, waterGoal, userMetrics, hasOnboarded, showDynamicGoalButtons, appSettings },
      });
    } catch (error) {
      console.error('Failed to load initial app state:', error);
      recordError(error, 'app.init');
      dispatch({ type: 'SET_INITIAL_STATE', payload: {} }); // never hang on the spinner
    }
  }, []);

  useEffect(() => { loadInitialState(); }, [loadInitialState]);
  useEffect(() => { initPairing(); }, []);
  useEffect(() => { setHapticLevel(resolveHapticLevel(state.appSettings), state.appSettings.hapticCustom); }, [state.appSettings.haptics, state.appSettings.hapticLevel, state.appSettings.hapticCustom]);
  // Home-screen widgets mirror today's data: redraw whenever logs/meds/settings change.
  // Caregivers see the dose plan: re-publish (debounced) after any data change.
  useEffect(() => { if (state.isInitialized) schedulePublish(); }, [dataVersion, state.isInitialized, state.waterGoal]);
  useEffect(() => { if (state.isInitialized) refreshWidgets(); }, [dataVersion, state.isInitialized, state.appSettings, state.waterGoal, state.locale, state.themeMode]);
  // Signed-in accounts: cloud backup 5 min after changes, and at launch when the last one is over a day old.
  useEffect(() => { if (state.isInitialized) scheduleCloudBackup(); }, [dataVersion, state.isInitialized, state.appSettings, state.waterGoal, state.locale, state.themeMode]);

  const refreshAppData = useCallback(async () => {
    await loadInitialState();
    setDataVersion(v => v + 1);
  }, [loadInitialState]);

  const refreshDynamicGoal = useCallback(async () => {
    setTodayDynamicAdjustment(await dynamicGoalService.getTodayTotalAdjustment());
    // A bigger goal today keeps water reminders/evening nudge going and changes the widget.
    notificationService.rescheduleAll().catch(console.warn);
    refreshWidgets();
  }, []);

  return (
    <AppContext.Provider value={{
      ...state,
      dispatch,
      refreshAppData,
      todayDynamicAdjustment,
      refreshDynamicGoal,
      customThemeColors,
      setCustomThemeColors,
      dataVersion,
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (context === undefined) throw new Error('useAppContext must be used within an AppProvider');
  return context;
};
