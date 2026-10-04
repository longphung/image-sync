import { Stack } from 'expo-router';
import { colors } from '../../../src/theme/colors';

// Own stack per tab, for the large-title header.
export default function TabStackLayout() {
  return <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background }, headerLargeTitle: true }} />;
}
