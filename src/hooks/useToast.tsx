import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { AccessibilityInfo, Animated, Platform, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, SPACING, SHADOWS } from '../constants/theme';
import { Typography } from '../components/common/Typography';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastOptions {
  message: string;
  type?: ToastType;
  duration?: number;
  /** Optional inline button, e.g. "Geri al". Tapping it runs onPress and hides the toast. */
  action?: { label: string; onPress: () => void };
}

interface ToastContextType {
  showToast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { COLORS: dynamicColors } = useTheme();
  
  const [currentToast, setCurrentToast] = useState<ToastOptions | null>(null);
  
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(-100)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isVisibleRef = useRef<boolean>(false);

  const hideToast = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: -100, duration: 300, useNativeDriver: true })
    ]).start(({ finished }) => {
      // Interrupted by a newer toast: keep that one on screen.
      if (!finished) return;
      setCurrentToast(null);
      isVisibleRef.current = false;
    });
  }, [fadeAnim, slideAnim]);

  const showToast = useCallback((options: ToastOptions) => {
    if (timerRef.current) {
        clearTimeout(timerRef.current);
    }

    setCurrentToast(options);
    // Android reads it via accessibilityLiveRegion below.
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(options.message);

    if (!isVisibleRef.current) {
        // First toast: Animate In
        isVisibleRef.current = true;
        fadeAnim.setValue(0);
        slideAnim.setValue(-100);

        Animated.parallel([
            Animated.spring(fadeAnim, { toValue: 1, useNativeDriver: true, tension: 40, friction: 7 }),
            Animated.spring(slideAnim, { toValue: 60, useNativeDriver: true, tension: 40, friction: 7 })
        ]).start();
    } else {
        // Successive toast (possibly mid fade-out): snap back to fully shown; latest message wins.
        fadeAnim.stopAnimation();
        slideAnim.stopAnimation();
        fadeAnim.setValue(1);
        slideAnim.setValue(60);
    }

    // Set timer for the current (or new) toast to eventually animate out
    timerRef.current = setTimeout(() => {
        hideToast();
    }, options.duration || (options.action ? 5000 : 3000));

  }, [fadeAnim, slideAnim, hideToast]);

  const getIcon = (type: ToastType) => {
    switch (type) {
      case 'success': return 'checkmark-circle';
      case 'error': return 'alert-circle';
      case 'warning': return 'warning';
      default: return 'information-circle';
    }
  };

  const getBgColor = (type: ToastType) => {
    switch (type) {
      case 'success': return dynamicColors.success;
      case 'error': return dynamicColors.error;
      case 'warning': return dynamicColors.warning;
      default: return dynamicColors.primary;
    }
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <Animated.View 
          style={[
            styles.toastContainer, 
            { 
              opacity: fadeAnim, 
              transform: [{ translateY: slideAnim }],
              backgroundColor: currentToast ? getBgColor(currentToast.type || 'success') : 'transparent'
            },
            SHADOWS.lg
          ]}
          pointerEvents={currentToast ? 'auto' : 'none'}
      >
          {currentToast && (
              <Pressable
                onPress={hideToast}
                // With an action button the children must stay separately focusable for screen readers.
                accessible={!currentToast.action}
                style={styles.inner}
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                accessibilityLabel={currentToast.message}
              >
                <Ionicons name={getIcon(currentToast.type || 'success')} size={24} color={dynamicColors.onPrimary} />
                <Typography style={[styles.text, { color: dynamicColors.onPrimary }]}>{currentToast.message}</Typography>
                {currentToast.action && (
                  <Pressable
                    onPress={() => { currentToast.action!.onPress(); hideToast(); }}
                    accessibilityRole="button"
                    accessibilityLabel={currentToast.action.label}
                    style={[styles.action, { borderColor: dynamicColors.onPrimary }]}
                  >
                    <Typography style={[styles.actionText, { color: dynamicColors.onPrimary }]}>{currentToast.action.label}</Typography>
                  </Pressable>
                )}
              </Pressable>
          )}
      </Animated.View>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
};

const styles = StyleSheet.create({
  toastContainer: {
    position: 'absolute',
    top: 0,
    left: 20,
    right: 20,
    borderRadius: 20,
    zIndex: 10000,
  },
  inner: { padding: 16, minHeight: 48, flexDirection: 'row', alignItems: 'center' },
  text: { marginLeft: 12, fontWeight: 'bold', flex: 1 },
  action: { marginLeft: 8, minHeight: 48, minWidth: 48, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontWeight: '800' },
});
