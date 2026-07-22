import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/context/LanguageContext';
import { useLocation } from '@/hooks/useLocation';
import { useCatsWithCache } from '@/hooks/useCatsWithCache';
import { OfflineBanner } from '@/components/OfflineBanner';
import { CatCard } from '@/components/CatCard';
import { NotificationBell } from '@/components/NotificationBell';

export default function CatsScreen() {
  const colors = useColors();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const { coords } = useLocation();
  const { cats, isLoading } = useCatsWithCache(
    coords?.latitude,
    coords?.longitude,
  );
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cats;
    return cats.filter((c) => c.name.toLowerCase().includes(q));
  }, [cats, search]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {t('allCats')}
          </Text>
          <NotificationBell />
        </View>
        <View
          style={[
            styles.searchBox,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={t('searchCats')}
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground }]}
          />
        </View>
      </View>
      <OfflineBanner />
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Feather name="github" size={40} color={colors.mutedForeground} />
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>
            {cats.length === 0 ? t('noCats') : t('noCatsSearch')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(c) => String(c.id)}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={{
            padding: 12,
            paddingBottom: insets.bottom + (Platform.OS === 'web' ? 100 : 90),
          }}
          renderItem={({ item }) => <CatCard cat={item} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 10, gap: 10 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 22, fontFamily: 'Poppins_700Bold' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'web' ? 10 : 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Nunito_400Regular',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}),
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
  },
  empty: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    textAlign: 'center',
  },
  row: { gap: 12, paddingHorizontal: 0, marginBottom: 12 },
});
