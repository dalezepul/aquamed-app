import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { useAppContext } from './src/state/AppContext';
import { AppNavigator } from './src/navigation/AppNavigator';
import { AppProvider } from './src/state/AppContext';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { useTheme } from './src/constants/theme';
import { ToastProvider } from './src/hooks/useToast';
import { DialogHost } from './src/components/common/DialogHost';
import { refreshEntitlement, usePlus } from './src/services/entitlement';
import { initAds } from './src/services/ads';

function AppContent() {
  const { isInitialized, hasOnboarded } = useAppContext();
  const plus = usePlus();

  const [plusChecked, setPlusChecked] = useState(false);

  useEffect(() => { if (isInitialized) refreshEntitlement().finally(() => setPlusChecked(true)); }, [isInitialized]);
  // Consent form + SDK only for free users, and not over onboarding.
  useEffect(() => { if (plusChecked && hasOnboarded && !plus) initAds(); }, [plusChecked, hasOnboarded, plus]);
  const { isDark } = useTheme();

  const statusBarStyle = isDark ? 'light' : 'dark';

  return (
    <ErrorBoundary>
      <ToastProvider>
        <AppNavigator />
        <DialogHost />
        <StatusBar style={statusBarStyle} />
      </ToastProvider>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
