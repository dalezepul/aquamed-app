import React, { useRef, useEffect, useState, useMemo } from 'react';
import { StyleSheet, View, ScrollView, useWindowDimensions, TouchableOpacity } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { useTheme, SPACING } from '../constants/theme';
import { Typography } from './common/Typography';
import { triggerHaptic } from './common/AnimatedTouchable';
import { t } from '../localization/i18n';
import { MonthlyCalendarModal } from './MonthlyCalendarModal';
import { haptic } from '../utils/haptics';
import { TWO_COLUMN_MAX_WIDTH } from '../hooks/useWide';

interface CalendarStripProps {
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
}

const ITEM_WIDTH = 64;

const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const FULL_DAY_KEYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const CalendarStrip: React.FC<CalendarStripProps> = ({ selectedDate, onDateSelect }) => {
  const scrollViewRef = useRef<ScrollView>(null);
  const { isDark, COLORS: dynamicColors } = useTheme();
  // Strip width = Home's ScreenWrapper width (window on phones, capped on tablets/landscape).
  const SCREEN_WIDTH = Math.min(useWindowDimensions().width, TWO_COLUMN_MAX_WIDTH);

  // Mount day only anchors the initial ±60-day range (more days load lazily at the edges)
  const todayRef = useRef(new Date());

  // Generate initial dates state: 60 days before and 60 days after today (4 months total)
  const [dates, setDates] = useState<Date[]>(() => {
    const list: Date[] = [];
    const base = new Date(todayRef.current);
    base.setHours(0, 0, 0, 0);
    
    for (let i = -60; i <= 60; i++) {
        const d = new Date(base);
        d.setDate(d.getDate() + i);
        list.push(d);
    }
    return list;
  });

  const isSameDay = (d1: Date, d2: Date) => {
    return d1.getDate() === d2.getDate() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getFullYear() === d2.getFullYear();
  };

  // Current day, not the mount day: Home re-renders on its clock tick, so the colours roll over at midnight.
  const getDateType = (date: Date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);

    if (target.getTime() === today.getTime()) {
      return 'today';
    } else if (target.getTime() < today.getTime()) {
      return 'past';
    } else {
      return 'future';
    }
  };

  // Safe selected index based on dynamic dates array
  const selectedIndex = dates.findIndex(d => isSameDay(d, selectedDate));
  const safeSelectedIndex = selectedIndex >= 0 ? selectedIndex : 60;

  // Reanimated tracking for indicator transition
  const translateX = useSharedValue(safeSelectedIndex * ITEM_WIDTH);

  useEffect(() => {
      const targetX = safeSelectedIndex * ITEM_WIDTH;
      translateX.value = withSpring(targetX, { damping: 18, stiffness: 150 });
  }, [safeSelectedIndex]);

  // Infinite Scroll Refs
  const isPrepending = useRef(false);
  const isAppending = useRef(false);
  const scrollX = useRef(0);

  // Lazy loading 30 days in the future (append)
  const loadMoreFuture = () => {
    if (isAppending.current) return;
    isAppending.current = true;

    setDates(prev => {
      const lastDate = prev[prev.length - 1];
      if (!lastDate) {
        isAppending.current = false;
        return prev;
      }
      
      const newDates: Date[] = [];
      for (let i = 1; i <= 30; i++) {
        const d = new Date(lastDate);
        d.setDate(d.getDate() + i);
        newDates.push(d);
      }
      
      setTimeout(() => {
        isAppending.current = false;
      }, 100);

      return [...prev, ...newDates];
    });
  };

  // Lazy loading 30 days in the past (prepend with width & animation offsets correction)
  const loadMorePast = () => {
    if (isPrepending.current) return;
    isPrepending.current = true;

    setDates(prev => {
      const firstDate = prev[0];
      if (!firstDate) {
        isPrepending.current = false;
        return prev;
      }
      
      const newDates: Date[] = [];
      for (let i = 30; i >= 1; i--) {
        const d = new Date(firstDate);
        d.setDate(d.getDate() - i);
        newDates.push(d);
      }

      // 1. Instantly shift the indicator target value to prevent it from sliding/glitching back
      translateX.value = translateX.value + (30 * ITEM_WIDTH);

      // 2. Adjust the ScrollView position immediately on next tick without animating to compensate added items width
      setTimeout(() => {
        scrollViewRef.current?.scrollTo({
          x: scrollX.current + (30 * ITEM_WIDTH),
          animated: false
        });
        isPrepending.current = false;
      }, 0);

      return [...newDates, ...prev];
    });
  };

  // Handle Scroll and lazy trigger
  const handleScroll = (event: any) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    scrollX.current = offsetX;
    
    const contentWidth = event.nativeEvent.contentSize.width;
    
    // Load past dates if scrolling near left end (< 600px remaining)
    if (offsetX < 600) {
      loadMorePast();
    }
    
    // Load future dates if scrolling near right end (< 600px remaining)
    if (contentWidth - offsetX - SCREEN_WIDTH < 600) {
      loadMoreFuture();
    }
  };

  // Center selected date in ScrollView
  const scrollToDate = (date: Date, animated = true) => {
    const idx = dates.findIndex(d => isSameDay(d, date));
    if (idx >= 0) {
      scrollViewRef.current?.scrollTo({ x: idx * ITEM_WIDTH - (SCREEN_WIDTH / 2) + (ITEM_WIDTH / 2), animated });
    }
  };

  // Center selected date on screen mount
  useEffect(() => {
    const timer = setTimeout(() => {
      scrollToDate(selectedDate, false);
    }, 150);
    return () => clearTimeout(timer);
  }, []);

  const handleDatePress = (date: Date) => {
    onDateSelect(date);
    scrollToDate(date, true);
  };

  const animatedDropStyle = useAnimatedStyle(() => {
      return {
          transform: [{ translateX: translateX.value }],
      };
  });
  
  const [showMonthlyCalendar, setShowMonthlyCalendar] = useState(false);

  return (
    <View style={styles.container}>
      <View style={styles.monthHeader}>
          <TouchableOpacity 
              onPress={() => { haptic('light'); setShowMonthlyCalendar(true); }}
              accessibilityRole="button"
              accessibilityLabel={t('calendar.open_month_a11y')}
              style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)', paddingHorizontal: 12, borderRadius: 12 }}
          >
              <Typography variant="caption" style={styles.monthText} color={isDark ? dynamicColors.text : dynamicColors.primary}>
                  {t(`months.${MONTH_KEYS[selectedDate.getMonth()]}`)} {selectedDate.getFullYear()}
              </Typography>
              <Ionicons name="chevron-down" size={14} color={isDark ? dynamicColors.text : dynamicColors.primary} style={{ marginLeft: 6 }} />
          </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollViewRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: (SCREEN_WIDTH / 2) - (ITEM_WIDTH / 2) }}
        decelerationRate="fast"
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        <View style={{ position: 'relative', height: 74 }}>
            {/* Animated Pill Indicator */}
            <Animated.View style={[
                styles.dropIndicator, 
                { backgroundColor: dynamicColors.primary },
                animatedDropStyle
            ]} />

            <View style={{ flexDirection: 'row', zIndex: 2, position: 'relative' }}>
                {dates.map((date) => {
                const isSelected = isSameDay(date, selectedDate);
                const isToday = isSameDay(date, new Date());
                const dayKey = DAY_KEYS[date.getDay()];
                const isFirstOfMonth = date.getDate() === 1;
                const dateType = getDateType(date);

                return (
                    <TouchableOpacity
                        key={date.toISOString()}
                        style={styles.itemWrapper}
                        onPress={() => { triggerHaptic('light'); handleDatePress(date); }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                        accessibilityLabel={`${t(`full_days.${FULL_DAY_KEYS[date.getDay()]}`)} ${date.getDate()} ${t(`months.${MONTH_KEYS[date.getMonth()]}`)}`}
                    >
                        <View style={[
                            styles.dateItem,
                            isSelected && styles.dateItemSelected,
                            
                            // TODAY: Bright, glowing design
                            !isSelected && dateType === 'today' && {
                              borderColor: dynamicColors.primary,
                              borderWidth: 1.5,
                              backgroundColor: isDark ? 'rgba(59, 130, 246, 0.15)' : 'rgba(59, 130, 246, 0.08)',
                              shadowColor: dynamicColors.primary,
                              shadowOffset: { width: 0, height: 2 },
                              shadowOpacity: 0.25,
                              shadowRadius: 4,
                            },
                            
                            // PAST: Faded/softer tones
                            !isSelected && dateType === 'past' && {
                              backgroundColor: isDark ? 'rgba(255, 255, 255, 0.015)' : 'rgba(0, 0, 0, 0.015)',
                              opacity: 0.45,
                            },
                            
                            // FUTURE: Crisp, clean card tones
                            !isSelected && dateType === 'future' && {
                              backgroundColor: isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.035)',
                              borderColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.02)',
                              borderWidth: 0.5,
                            }
                        ]}>
                            <Typography 
                            style={[
                                styles.dayLabel,
                                { 
                                  color: isSelected 
                                    ? dynamicColors.onPrimary
                                    : (dateType === 'today' ? dynamicColors.primary : dynamicColors.textSecondary) 
                                }
                            ]}>
                            {t(`days.${dayKey}`)}
                            </Typography>
                            <Typography 
                            variant="body" 
                            style={[
                                styles.dateLabel,
                                { 
                                  color: isSelected 
                                    ? dynamicColors.onPrimary
                                    : (dateType === 'today' ? dynamicColors.primary : dynamicColors.text),
                                  fontWeight: isSelected || dateType === 'today' ? '900' : '600' 
                                }
                            ]}>
                            {date.getDate()}
                            </Typography>
                            {isToday && !isSelected && <View style={[styles.todayIndicator, { backgroundColor: dynamicColors.primary }]} />}
                        </View>
                        {isFirstOfMonth && !isSelected && (
                            <View style={[styles.monthIndicator, { backgroundColor: dynamicColors.primary }]} />
                        )}
                    </TouchableOpacity>
                );
                })}
            </View>
        </View>
      </ScrollView>
      
      <MonthlyCalendarModal
        isVisible={showMonthlyCalendar}
        onClose={() => setShowMonthlyCalendar(false)}
        selectedDate={selectedDate}
        onDateSelect={(d) => {
            setShowMonthlyCalendar(false);
            handleDatePress(d);
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { height: 126, marginVertical: 12 },
  monthHeader: { alignItems: 'center', marginBottom: 8 },
  monthText: { fontWeight: 'bold', letterSpacing: 2, opacity: 0.8 },
  
  // The padding allows items to scroll freely and center snap correctly
  itemWrapper: { width: ITEM_WIDTH, height: 74, alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  
  // The Animated Pill Indicator
  dropIndicator: {
      position: 'absolute',
      width: 58,
      height: 74,
      marginLeft: (ITEM_WIDTH - 58) / 2,
      borderRadius: 28,
      zIndex: 1,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 6,
      elevation: 4,
  },
  
  dateItem: {
    width: 58,
    height: 74,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
    zIndex: 10,
  },
  dateItemSelected: {
    backgroundColor: 'transparent',
  },
  dayLabel: { fontSize: 13, marginBottom: 2, fontWeight: '800' },
  dateLabel: { fontSize: 18 },
  todayIndicator: { width: 4, height: 4, borderRadius: 2, position: 'absolute', bottom: 8 },
  monthIndicator: { width: 4, height: 4, borderRadius: 2, position: 'absolute', bottom: 4, opacity: 0.5 }
});
