import React from 'react';
import { Text, View } from 'react-native';

export default function CalendarioScreen() {
  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: '#fff' }}>
      <Text style={{ fontSize: 28, fontWeight: '900' }}>Calendario</Text>
      <Text style={{ marginTop: 8, color: '#6B7280' }}>Próximamente: historial por día.</Text>
    </View>
  );
}