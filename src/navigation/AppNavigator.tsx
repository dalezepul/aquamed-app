import React, { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, AppState, Linking, Platform, View, useWindowDimensions } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme, Theme, LinkingOptions, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';

import { useTheme } from '../constants/theme';
import { useAppContext } from '../state/AppContext';
import { t } from '../localization/i18n';
import { notificationService, NotificationData } from '../services/notificationService';

import OnboardingScreen, { afterOnboarding } from '../screens/OnboardingScreen';
import HomeScreen from '../screens/HomeScreen';
import MedicationsScreen from '../screens/MedicationsScreen';
import ProgressScreen from '../screens/ProgressScreen';
import SettingsScreen from '../screens/SettingsScreen';
import AddEditMedicationScreen from '../screens/AddEditMedication';
import InteractionScheduleScreen from '../screens/InteractionScheduleScreen';
import MedicationDetailModal from '../screens/MedicationDetailModal';
import DevToolsScreen from '../screens/DevToolsScreen';
import DataPrivacyScreen from '../screens/DataPrivacyScreen';
import NotificationActionScreen from '../screens/NotificationActionScreen';
import PaywallScreen from '../screens/PaywallScreen';
import RemindersSettingsScreen from '../screens/settings/RemindersSettingsScreen';
import SleepSettingsScreen from '../screens/settings/SleepSettingsScreen';
import WaterGoalSettingsScreen from '../screens/settings/WaterGoalSettingsScreen';
import EmergencySettingsScreen from '../screens/settings/EmergencySettingsScreen';
import HapticsSettingsScreen from '../screens/settings/HapticsSettingsScreen';
import AccountScreen from '../screens/settings/AccountScreen';
import MeasurementsScreen from '../screens/MeasurementsScreen';
import AddMeasurementScreen from '../screens/AddMeasurementScreen';
import { TabBarButton } from '../components/navigation/TabBarButton';
import { maybeShowInterstitial, noteUserAction } from '../services/ads';
import { requestAlarmSync, applyPendingCommands, watchIncomingCommands, parsePairLink } from '../services/pairing';
import { setPendingJoinCode } from '../components/care/JoinCodeCard';
import CaregiversScreen from '../screens/CaregiversScreen';
import CareHomeScreen from '../screens/CareHomeScreen';
import CareSettingsScreen from '../screens/CareSettingsScreen';
import { SELF_TABS } from '../services/careMode';
import { APP_URL_PREFIX } from '../widgets/care';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef<any>();
// aquamed://caregivers (the "Takip" widget): caregiver mode → CareHome (its root); self mode → Yakınlar over the tabs.
const linkingFor = (caregiverMode: boolean): LinkingOptions<any> => ({
  prefixes: [APP_URL_PREFIX],
  config: caregiverMode ? { screens: { CareHome: 'caregivers' } } : { initialRouteName: 'AppTabs', screens: { Caregivers: 'caregivers' } },
});

const TAB_ICONS: Record<string, [keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap]> = {
  Home: ['home', 'home-outline'],
  Medications: ['medical', 'medical-outline'],
  Progress: ['stats-chart', 'stats-chart-outline'],
  Settings: ['settings', 'settings-outline'],
};

// Tabs of 'self' mode. Caregiver mode has no tabs (see careRootScreens).
const TABS: Record<(typeof SELF_TABS)[number], { component: React.ComponentType<any>; title: () => string; listeners?: object }> = {
  Home: { component: HomeScreen, title: () => t('tabs.tracker') },
  Medications: { component: MedicationsScreen, title: () => t('tabs.medications') },
  Progress: { component: ProgressScreen, title: () => t('tabs.progress'), listeners: { tabPress: () => { maybeShowInterstitial('progress_tab'); } } },
  Settings: { component: SettingsScreen, title: () => t('tabs.settings') },
};

const AnimatedTabIcon = ({ name, focused, color, size }: { name: keyof typeof Ionicons.glyphMap; focused: boolean; color: string; size: number }) => {
  const scale = useSharedValue(focused ? 1.15 : 1);
  useEffect(() => {
    scale.value = withSpring(focused ? 1.15 : 1, { damping: 12, stiffness: 200 });
  }, [focused]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={style}>
      <Ionicons name={name} size={size} color={color} />
    </Animated.View>
  );
};

function AppTabs() {
  const { COLORS, isElderly } = useTheme();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const labelSize = isElderly ? 15 : 12;
  // Fixed height clipped the labels at large system font sizes (1.6x+): grow by the label's extra line height.
  const barHeight = (isElderly ? 84 : 68) + Math.round(labelSize * 1.3 * Math.max(0, Math.min(fontScale, 2) - 1)) + insets.bottom;
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.gray,
        tabBarStyle: { backgroundColor: COLORS.card, borderTopWidth: 0, elevation: 0, height: barHeight, paddingBottom: insets.bottom },
        tabBarItemStyle: { paddingVertical: 6 },
        tabBarButton: props => <TabBarButton {...props} />,
        tabBarLabelStyle: { fontSize: labelSize, fontWeight: '600', marginTop: 2 },
        tabBarIcon: ({ focused, color, size }) => {
          const [on, off] = TAB_ICONS[route.name] ?? ['help-circle', 'help-circle'];
          return <AnimatedTabIcon name={focused ? on : off} focused={focused} color={color} size={isElderly ? size + 6 : size} />;
        },
      })}
      // No tab-switch vibration: users found it the most annoying one.
    >
      {SELF_TABS.map(name => (
        <Tab.Screen key={name} name={name} component={TABS[name].component} options={{ title: TABS[name].title() }} listeners={TABS[name].listeners} />
      ))}
    </Tab.Navigator>
  );
}

/**
 * Caregiver mode: a separate, tab-less interface. CareHome (the followed person's day) is the root;
 * its gear opens CareSettings. Everything else (DataPrivacy, SelfSetup, Account…) is the shared stack.
 */
const careRootScreens = () => [
  <Stack.Screen key="CareHome" name="CareHome" component={CareHomeScreen} />,
  <Stack.Screen key="CareSettings" name="CareSettings" component={CareSettingsScreen} options={{ presentation: 'card' }} />,
];

const DISMISS_ACTIONS = new Set(['com.apple.UNNotificationDismissActionIdentifier', 'expo.modules.notifications.actions.DISMISSED']);

export const AppNavigator = () => {
  const { isInitialized, hasOnboarded, refreshAppData, appSettings } = useAppContext();
  const caregiverMode = appSettings.appMode === 'caregiver';
  const { COLORS, isDark } = useTheme();
  const handled = useRef(new Set<string>());
  const pending = useRef<{ data: NotificationData; actionId: string } | null>(null);
  const pairLink = useRef(false); // an invite link arrived, not yet navigated to (see onUrl below)
  const canNavigate = isInitialized && hasOnboarded;

  const openAction = (data: NotificationData, actionId: string) => {
    if (canNavigate && navigationRef.isReady()) navigationRef.navigate('NotificationAction', { data, actionId });
    else pending.current = { data, actionId }; // opened before the app was ready (cold start / onboarding)
  };

  const handleResponse = async (response: Notifications.NotificationResponse) => {
    const id = `${response.notification.request.identifier}:${response.actionIdentifier}`;
    if (handled.current.has(id)) return;
    handled.current.add(id);

    const data = response.notification.request.content.data as unknown as NotificationData;
    const actionId = response.actionIdentifier;
    if (!data?.type || data.type === 'reopen' || DISMISS_ACTIONS.has(actionId)) return; // reopen: opening the app is the point
    if (String(data.type).startsWith('care')) { // caregiver push / local late alarm: the followed person's day
      if (canNavigate && navigationRef.isReady()) {
        navigationRef.navigate('CareHome', { pairId: (data as any).pairId }); // caregiver mode: its root; self mode: pushed
      }
      return;
    }
    const target = data.type === 'snooze' ? data.of : data;

    if (actionId === 'DRINK') {
      await notificationService.logWaterFromNotification();
      noteUserAction();
      refreshAppData();
      return;
    }
    if (actionId === 'SNOOZE') {
      await notificationService.snooze(target, target.type === 'water' ? 30 : 15);
      return;
    }
    openAction(data, actionId);
  };

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationResponseReceivedListener(handleResponse);
    // A caregiver push arriving while we're open: re-plan local late alarms (a taken dose cancels its alarm).
    const received = Notifications.addNotificationReceivedListener(n => {
      if (String((n.request.content.data as any)?.type ?? '').startsWith('care')) requestAlarmSync();
    });
    Notifications.getLastNotificationResponseAsync().then(r => r && handleResponse(r)).catch(() => {});
    return () => { sub.remove(); received.remove(); };
  }, [canNavigate, caregiverMode]);

  // Patient side: a caregiver's "Aldı"/"Su ekle" marks, applied as they arrive while the app is open.
  useEffect(() => (canNavigate ? watchIncomingCommands(refreshAppData) : undefined), [canNavigate, refreshAppData]);

  // Coming back to the app: the day may have changed and doses may have been handled elsewhere.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        applyPendingCommands().then(n => { if (n) refreshAppData(); }).catch(e => console.warn('[pairing] apply', e));
        refreshAppData();
        notificationService.rescheduleAll();
        requestAlarmSync();
      }
    });
    return () => sub.remove();
  }, [refreshAppData]);

  const flushPending = () => {
    if (canNavigate && afterOnboarding.route && navigationRef.isReady()) {
      const r = afterOnboarding.route;
      afterOnboarding.route = undefined;
      navigationRef.navigate(r.name, r.params);
    }
    if (canNavigate && pending.current && navigationRef.isReady()) {
      const p = pending.current;
      pending.current = null;
      navigationRef.navigate('NotificationAction', p);
    }
    // Invite link: the code is already in JoinCodeCard's store; open a screen that shows the card.
    if (canNavigate && pairLink.current && navigationRef.isReady()) {
      pairLink.current = false;
      navigationRef.navigate(caregiverMode ? 'CareSettings' : 'Caregivers', caregiverMode ? undefined : { mode: 'join' });
    }
  };
  useEffect(flushPending, [canNavigate]);

  // aquamed[-test]://pair?code=12345678 (from the WhatsApp invite's web page). The linking config has no
  // "pair" route, so NavigationContainer ignores it; before onboarding ends it waits in pairLink.
  const flushRef = useRef(flushPending);
  flushRef.current = flushPending;
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const onUrl = (url: string | null) => {
      const code = parsePairLink(url);
      if (!code) return;
      setPendingJoinCode(code);
      pairLink.current = true;
      flushRef.current();
    };
    Linking.getInitialURL().then(onUrl).catch(() => {});
    const sub = Linking.addEventListener('url', e => onUrl(e.url));
    return () => sub.remove();
  }, []);

  const linking = useMemo(() => linkingFor(caregiverMode), [caregiverMode]);
  const base = isDark ? DarkTheme : DefaultTheme;
  const navTheme: Theme = {
    ...base,
    colors: { ...base.colors, primary: COLORS.primary, background: COLORS.background, card: COLORS.card, text: COLORS.text, border: 'transparent', notification: COLORS.accent },
  };

  if (!isInitialized) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: navTheme.colors.background }}>
        <ActivityIndicator size="large" color={navTheme.colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme} ref={navigationRef} onReady={flushPending} linking={hasOnboarded ? linking : undefined}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!hasOnboarded ? (
          <Stack.Screen name="Onboarding" component={OnboardingScreen} />
        ) : (
          <>
            {/* Switching mode (SelfSetup) drops the old root instead of leaving it under the new one. */}
            <Stack.Group navigationKey={caregiverMode ? 'care' : 'self'}>
              {caregiverMode ? careRootScreens() : <Stack.Screen name="AppTabs" component={AppTabs} />}
            </Stack.Group>
            <Stack.Screen name="AddEditMedication" component={AddEditMedicationScreen} options={{ presentation: 'modal' }} />
            <Stack.Screen name="InteractionSchedule" component={InteractionScheduleScreen} options={{ presentation: 'modal' }} />
            <Stack.Screen name="MedicationDetailModal" component={MedicationDetailModal} options={{ presentation: 'modal' }} />
            <Stack.Screen name="NotificationAction" component={NotificationActionScreen} options={{ presentation: 'modal' }} />
            <Stack.Screen name="DevTools" component={DevToolsScreen} options={{ presentation: 'card' }} />
            <Stack.Screen name="DataPrivacy" component={DataPrivacyScreen} options={{ presentation: 'card' }} listeners={{ beforeRemove: () => { maybeShowInterstitial('data_privacy_close'); } }} />
            <Stack.Screen name="Paywall" component={PaywallScreen} options={{ presentation: 'modal' }} />
            <Stack.Screen name="RemindersSettings" component={RemindersSettingsScreen} options={{ presentation: 'card' }} />
            <Stack.Screen name="SleepSettings" component={SleepSettingsScreen} options={{ presentation: 'card' }} />
            <Stack.Screen name="WaterGoalSettings" component={WaterGoalSettingsScreen} options={{ presentation: 'card' }} />
            <Stack.Screen name="EmergencySettings" component={EmergencySettingsScreen} options={{ presentation: 'card' }} />
            <Stack.Screen name="HapticsSettings" component={HapticsSettingsScreen} options={{ presentation: 'card' }} />
            <Stack.Screen name="Account" component={AccountScreen} options={{ presentation: 'card' }} />
            <Stack.Screen name="Measurements" component={MeasurementsScreen} options={{ presentation: 'card' }} />
            <Stack.Screen name="AddMeasurement" component={AddMeasurementScreen} options={{ presentation: 'modal' }} />
            <Stack.Screen name="Caregivers" component={CaregiversScreen} options={{ presentation: 'card' }} />
            {!caregiverMode && <Stack.Screen name="CareHome" component={CareHomeScreen} options={{ presentation: 'card' }} />}
            <Stack.Screen name="SelfSetup" component={OnboardingScreen} options={{ presentation: 'card' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};
