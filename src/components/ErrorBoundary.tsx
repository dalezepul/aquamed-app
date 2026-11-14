import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useTheme, SPACING } from '../constants/theme';
import { t } from '../localization/i18n';
import { Typography } from './common/Typography';
import { Button } from './common/Button';
import { recordError } from '../services/crash';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

// Function component so the fallback can use the theme hook.
const ErrorFallback: React.FC<{ error: Error | null; onRetry: () => void }> = ({ error, onRetry }) => {
  const { COLORS } = useTheme();
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: COLORS.background }]}>
      <View style={styles.content}>
        <Ionicons name="warning-outline" size={64} color={COLORS.error} />
        <Typography variant="header" style={styles.header}>{t('error_boundary.title')}</Typography>
        <Typography variant="body" color={COLORS.textSecondary} style={styles.message}>
          {t('error_boundary.message')}
        </Typography>
        {__DEV__ && error?.message ? (
          <Typography variant="caption" color={COLORS.textMuted} style={styles.message} selectable>
            {error.message}
          </Typography>
        ) : null}
        <Button title={t('error_boundary.retry')} onPress={onRetry} style={styles.button} />
      </View>
    </SafeAreaView>
  );
};

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    recordError(error, 'ui.errorBoundary');
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return <ErrorFallback error={this.state.error} onRetry={this.handleReset} />;
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  header: {
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
  message: {
    marginBottom: SPACING.lg,
    textAlign: 'center',
  },
  button: {
    alignSelf: 'stretch',
  },
});
