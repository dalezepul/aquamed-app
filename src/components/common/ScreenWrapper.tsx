import React from 'react';
import { StyleSheet, StatusBar, ViewStyle, StyleProp, View } from 'react-native';
import { SafeAreaView, Edge } from 'react-native-safe-area-context';
import { useTheme } from '../../constants/theme';
import { useWide, centered, FORM_MAX_WIDTH } from '../../hooks/useWide';

interface ScreenWrapperProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Tab screens: the tab bar already pads the bottom. Full-screen/modal stacks pass all four edges. */
  edges?: Edge[];
  /** Content width cap on wide screens (tablet/foldable/landscape). Ignored on phones. */
  maxWidth?: number;
}

const DEFAULT_EDGES: Edge[] = ['top', 'left', 'right'];

export const ScreenWrapper: React.FC<ScreenWrapperProps> = ({ children, style, edges = DEFAULT_EDGES, maxWidth = FORM_MAX_WIDTH }) => {
  const { isDark, COLORS: dynamicColors } = useTheme();
  const wide = useWide();

  return (
    <View style={[styles.outer, { backgroundColor: dynamicColors.background }]}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={dynamicColors.background}
      />
      <SafeAreaView edges={edges} style={[styles.container, wide && centered(maxWidth), style]}>
        {children}
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  outer: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
});
