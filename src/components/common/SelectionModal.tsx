import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, Modal, Animated, Dimensions, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, SPACING } from '../../constants/theme';
import { t } from '../../localization/i18n';
import { Typography } from './Typography';

interface Option {
  label: string;
  value: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

interface SelectionModalProps {
  isVisible: boolean;
  onClose: () => void;
  title: string;
  options: Option[];
  selectedValue: string;
  onSelect: (value: string) => void;
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export const SelectionModal: React.FC<SelectionModalProps> = ({
  isVisible,
  onClose,
  title,
  options,
  selectedValue,
  onSelect,
}) => {
  const { isDark, COLORS: dynamicColors } = useTheme();
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (isVisible) {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 50,
        friction: 8,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: SCREEN_HEIGHT,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [isVisible]);

  const handleSelect = (value: string) => {
    onSelect(value);
    onClose();
  };

  return (
    <Modal visible={isVisible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        />
        <Animated.View 
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              backgroundColor: dynamicColors.card,
              paddingBottom: SPACING.lg + insets.bottom,
              transform: [{ translateY: slideAnim }] 
            }
          ]}
        >
          <View style={[styles.handle, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]} />
          
          <Typography variant="subheader" style={styles.title}>{title}</Typography>
          
          <View style={styles.optionsContainer}>
            {options.map((option, index) => {
              const isSelected = option.value === selectedValue;
              return (
                <TouchableOpacity 
                  key={option.value} 
                  style={[
                    styles.option, 
                    isSelected && { backgroundColor: dynamicColors.primary + '10' },
                    index < options.length - 1 && { marginBottom: 8 }
                  ]} 
                  onPress={() => handleSelect(option.value)}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected: isSelected }}
                >
                  {option.icon && (
                    <Ionicons 
                      name={option.icon} 
                      size={20} 
                      color={isSelected ? dynamicColors.primary : dynamicColors.textSecondary} 
                      style={styles.optionIcon}
                    />
                  )}
                  <Typography 
                    style={[
                      styles.optionLabel, 
                      { color: isSelected ? dynamicColors.primary : dynamicColors.text }
                    ]}
                  >
                    {option.label}
                  </Typography>
                  {isSelected && <Ionicons name="checkmark" size={20} color={dynamicColors.primary} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: SPACING.lg,
    maxHeight: '80%',
    width: '100%',
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    textAlign: 'center',
    marginBottom: 24,
  },
  optionsContainer: {
    // handled via option marginBottom
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    minHeight: 48,
    borderRadius: 16,
  },
  optionIcon: {
    marginRight: 12,
  },
  optionLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
});
