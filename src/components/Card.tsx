import { View, type ViewProps } from 'react-native';
import { colors } from '../theme/colors';

export function Card({ style, ...props }: ViewProps) {
  return (
    <View
      style={[
        { backgroundColor: colors.card, borderRadius: 16, borderCurve: 'continuous', padding: 16, gap: 12 },
        style,
      ]}
      {...props}
    />
  );
}
