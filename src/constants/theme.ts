import { useColorScheme, PixelRatio } from 'react-native';
import { useAppContext } from '../state/AppContext';
import { displayModeOf } from '../services/storageService';

// Four palettes (tasarim/tema-v2). "night" is the default; text contrast ~9:1 instead of ~15:1,
// which users found harsh. headerBg/onHeader colour the home header band.
export type PaletteId = 'night' | 'softSea' | 'sandSea' | 'classic';

export const PALETTES = {
  night: {
    name: 'Gece Mavisi',
    light: {
      primary: '#2F6690',
      onPrimary: '#FFFFFF',
      secondary: '#6A4BB8',
      accent: '#A95A1E',
      background: '#EDF0F4',
      surface: '#F7F9FB',
      card: '#F7F9FB',
      text: '#38434F',
      textSecondary: '#4A5665',
      textMuted: '#5D697D',
      border: '#7F8A99',
      success: '#2C704D',
      warning: '#9A4A14',
      error: '#AE3434',
      water: '#2F6690',
      waterLight: '#DCE7F1',
      white: '#FFFFFF',
      black: '#000000',
      gray: '#5D697D',
      lightGray: '#E1E6ED',
      waterLayer1Start: '#4A90C2',
      waterLayer1End: '#8EC5E8',
      waterLayer2Start: '#2E9468',
      waterLayer2End: '#7ED3A2',
      waterLayer3Start: '#C0612A',
      waterLayer3End: '#EDB585',
      headerBg: '#DCE7F1',
      onHeader: '#22425E',
    },
    dark: {
      primary: '#8EC5E8',
      onPrimary: '#0B1A26',
      secondary: '#B4A6E6',
      accent: '#E3B98A',
      background: '#0E1621',
      surface: '#121C28',
      card: '#16212E',
      text: '#BDC8D4',
      textSecondary: '#9CAAB9',
      textMuted: '#7F8D9E',
      border: '#586D87',
      success: '#8CCFA8',
      warning: '#E3B98A',
      error: '#E8A0A0',
      water: '#8EC5E8',
      waterLight: '#1C2B3B',
      white: '#FFFFFF',
      black: '#000000',
      gray: '#7F8D9E',
      lightGray: '#1C2837',
      waterLayer1Start: '#5FA8D6',
      waterLayer1End: '#A9D6F0',
      waterLayer2Start: '#3E9E7A',
      waterLayer2End: '#8CCFA8',
      waterLayer3Start: '#C99545',
      waterLayer3End: '#E3B98A',
      headerBg: '#1A2838',
      onHeader: '#BDC8D4',
    },
  },
  softSea: {
    name: 'Yumuşak Deniz',
    light: {
      primary: '#1C6F66',
      onPrimary: '#FFFFFF',
      secondary: '#6B45C4',
      accent: '#B8541E',
      background: '#F1EEE8',
      surface: '#FAF8F4',
      card: '#FAF8F4',
      text: '#384443',
      textSecondary: '#495657',
      textMuted: '#5F6A6C',
      border: '#918778',
      success: '#2F6B45',
      warning: '#9A4A1A',
      error: '#AF3A3A',
      water: '#1C6F66',
      waterLight: '#DCEEE9',
      white: '#FFFFFF',
      black: '#000000',
      gray: '#5F6A6C',
      lightGray: '#E8E3DA',
      waterLayer1Start: '#3AAE9E',
      waterLayer1End: '#6BBFE0',
      waterLayer2Start: '#3C8F5A',
      waterLayer2End: '#86CF9E',
      waterLayer3Start: '#C2622A',
      waterLayer3End: '#EDB585',
      headerBg: '#DCEEE9',
      onHeader: '#1E4A45',
    },
    dark: {
      primary: '#6FD3C2',
      onPrimary: '#0A2622',
      secondary: '#B7A9E8',
      accent: '#E8B48A',
      background: '#0C181D',
      surface: '#0F1D23',
      card: '#132329',
      text: '#BBCAC8',
      textSecondary: '#9AACAA',
      textMuted: '#7E9093',
      border: '#55707A',
      success: '#8FD9A8',
      warning: '#E8B48A',
      error: '#EFA3A3',
      water: '#6FD3C2',
      waterLight: '#1A2F35',
      white: '#FFFFFF',
      black: '#000000',
      gray: '#7E9093',
      lightGray: '#1A2F35',
      waterLayer1Start: '#3FBFAE',
      waterLayer1End: '#86C9E8',
      waterLayer2Start: '#34A77E',
      waterLayer2End: '#8FD9A8',
      waterLayer3Start: '#D9993A',
      waterLayer3End: '#E8B48A',
      headerBg: '#1C3A38',
      onHeader: '#BBCAC8',
    },
  },
  sandSea: {
    name: 'Kum & Deniz',
    light: {
      primary: '#1E6B63',
      onPrimary: '#FFFDF8',
      secondary: '#6E4AA8',
      accent: '#A8521C',
      background: '#F3ECE0',
      surface: '#FBF6EE',
      card: '#FBF6EE',
      text: '#463F38',
      textSecondary: '#5B5249',
      textMuted: '#6E655B',
      border: '#928574',
      success: '#3D6B2E',
      warning: '#94461A',
      error: '#A83232',
      water: '#1E6B63',
      waterLight: '#DDEAE2',
      white: '#FFFFFF',
      black: '#000000',
      gray: '#6E655B',
      lightGray: '#EAE1D2',
      waterLayer1Start: '#2A9D8F',
      waterLayer1End: '#7CC6BC',
      waterLayer2Start: '#4F8A3A',
      waterLayer2End: '#9CCB7E',
      waterLayer3Start: '#C2560F',
      waterLayer3End: '#F0B27A',
      headerBg: '#DDEAE2',
      onHeader: '#1E4E48',
    },
    dark: {
      primary: '#6EC1B3',
      onPrimary: '#10231F',
      secondary: '#BBA8E0',
      accent: '#E0AE80',
      background: '#1A1714',
      surface: '#201C18',
      card: '#25211D',
      text: '#D0C7BA',
      textSecondary: '#B2A89A',
      textMuted: '#968C7F',
      border: '#766B5A',
      success: '#9BCB8C',
      warning: '#E0AE80',
      error: '#E6A19A',
      water: '#6EC1B3',
      waterLight: '#2B2E2A',
      white: '#FFFFFF',
      black: '#000000',
      gray: '#968C7F',
      lightGray: '#2E2924',
      waterLayer1Start: '#3FA595',
      waterLayer1End: '#8FD0C4',
      waterLayer2Start: '#5E9B4B',
      waterLayer2End: '#A8D194',
      waterLayer3Start: '#C98A3C',
      waterLayer3End: '#E8BD8C',
      headerBg: '#2B3A35',
      onHeader: '#D0C7BA',
    },
  },
  classic: {
    name: 'Sakin Deniz',
    light: {
      primary: '#0F726B',
      onPrimary: '#FFFFFF',
      secondary: '#6D28D9',
      accent: '#C2410C',
      background: '#F5F2EC',
      surface: '#FFFDF9',
      card: '#FFFDF9',
      text: '#1E2A2E',
      textSecondary: '#4A5559',
      textMuted: '#6B7478',
      border: '#857B6B',
      success: '#166534',
      warning: '#9A3412',
      error: '#B91C1C',
      water: '#0F726B',
      waterLight: '#D5F0EA',
      white: '#FFFFFF',
      black: '#000000',
      gray: '#6B7478',
      lightGray: '#EDE7DD',
      waterLayer1Start: '#14B8A6',
      waterLayer1End: '#38BDF8',
      waterLayer2Start: '#15803D',
      waterLayer2End: '#4ADE80',
      waterLayer3Start: '#C2410C',
      waterLayer3End: '#FDBA74',
      headerBg: '#0F726B',
      onHeader: '#FFFFFF',
    },
    dark: {
      primary: '#5EEAD4',
      onPrimary: '#062320',
      secondary: '#C4B5FD',
      accent: '#FDBA74',
      background: '#061016',
      surface: '#0C1B22',
      card: '#10232C',
      text: '#EEF5F3',
      textSecondary: '#BFD0CE',
      textMuted: '#8AA0A6',
      border: '#5B7886',
      success: '#86EFAC',
      warning: '#FDBA74',
      error: '#FCA5A5',
      water: '#5EEAD4',
      waterLight: '#173039',
      white: '#FFFFFF',
      black: '#000000',
      gray: '#8AA0A6',
      lightGray: '#173039',
      waterLayer1Start: '#2DD4BF',
      waterLayer1End: '#8FD8FF',
      waterLayer2Start: '#10B981',
      waterLayer2End: '#86EFAC',
      waterLayer3Start: '#F59E0B',
      waterLayer3End: '#FDBA74',
      headerBg: '#5EEAD4',
      onHeader: '#062320',
    },
  },
};

export type ThemeColors = typeof PALETTES.night.light;
export const PALETTE_IDS = Object.keys(PALETTES) as PaletteId[];
export const DEFAULT_PALETTE: PaletteId = 'night';

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const TYPOGRAPHY = {
  header: {
    fontSize: 32,
    fontWeight: '800' as const,
    letterSpacing: -0.5,
    lineHeight: 40,
  },
  subheader: {
    fontSize: 20,
    fontWeight: '700' as const,
    letterSpacing: -0.2,
    lineHeight: 28,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400' as const,
  },
  caption: {
    fontSize: 13,
    fontWeight: '500' as const,
    lineHeight: 18,
  },
};

// "Büyük ve sade" view (displayMode 'large'): ~25% larger type. Roomier spacing comes with any simple view.
export const ELDERLY_TYPOGRAPHY = {
  header: { ...TYPOGRAPHY.header, fontSize: 36, lineHeight: 44 },
  subheader: { ...TYPOGRAPHY.subheader, fontSize: 24, lineHeight: 32 },
  body: { ...TYPOGRAPHY.body, fontSize: 20, lineHeight: 28, fontWeight: '500' as const },
  caption: { ...TYPOGRAPHY.caption, fontSize: 16, lineHeight: 22, fontWeight: '600' as const },
};

export const ELDERLY_SPACING: typeof SPACING = { xs: 6, sm: 12, md: 20, lg: 28, xl: 36, xxl: 56 };

// Elderly mode: secondary text takes the main text colour (≥ 7:1, WCAG AAA) in every palette.
const elderlyText = (c: ThemeColors) => ({ textSecondary: c.text, textMuted: c.textSecondary, gray: c.textSecondary });

/** Minimum touch target height (px). */
export const touchSize = (isElderly: boolean) => (isElderly ? 56 : 48);

export const SHADOWS = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 5,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 10,
  }
};

export const useTheme = () => {
  const { themeMode, customThemeColors, appSettings } = useAppContext();
  const mode = displayModeOf(appSettings);
  // Sade: simpler layout, bigger touch targets, stronger text colours. Büyük ve sade: also larger type.
  const isSimple = mode !== 'normal';
  const isLarge = mode === 'large';
  const isElderly = isSimple; // layout decisions across the app
  // Max system font multiplier for Text. With a big system font (≥1.3) the large view's own ~25%
  // would stack into overlapping text, so it gets a tighter cap there.
  const fontCap = !isLarge ? 1.6 : PixelRatio.getFontScale() >= 1.3 ? 1.15 : 1.3;
  const systemColorScheme = useColorScheme();

  const effectiveColorScheme = themeMode === 'system' ? systemColorScheme : themeMode;
  const isDark = effectiveColorScheme === 'dark';

  const palette = PALETTES[(appSettings?.palette as PaletteId) ?? DEFAULT_PALETTE] ?? PALETTES[DEFAULT_PALETTE];
  const base = isDark ? palette.dark : palette.light;
  let dynamicColors: ThemeColors = { ...base, ...(isElderly ? elderlyText(base) : {}) };

  if (customThemeColors) {
    dynamicColors = {
      ...dynamicColors,
      ...customThemeColors,
    };
  }

  return {
    COLORS: dynamicColors,
    SPACING: isElderly ? ELDERLY_SPACING : SPACING,
    TYPOGRAPHY: isLarge ? ELDERLY_TYPOGRAPHY : TYPOGRAPHY,
    SHADOWS,
    isDark,
    isElderly,
    isSimple,
    isLarge,
    fontCap,
  };
};

export type Theme = ReturnType<typeof useTheme>;
