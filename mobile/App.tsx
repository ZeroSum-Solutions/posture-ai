import { StatusBar } from 'expo-status-bar'
import { useState } from 'react'
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native'

import CameraCaptureScreen from './src/CameraCaptureScreen'
import FixtureAssessmentScreen from './src/FixtureAssessmentScreen'

type AppMode = 'fixture' | 'capture'

export default function App() {
  const [mode, setMode] = useState<AppMode>('fixture')

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.modeBar} testID="mode-toggle-bar">
        <Pressable
          style={[styles.modeButton, mode === 'fixture' ? styles.modeButtonActive : null]}
          onPress={() => setMode('fixture')}
          testID="show-fixture-mode"
        >
          <Text style={[styles.modeButtonText, mode === 'fixture' ? styles.modeButtonTextActive : null]}>
            Fixture
          </Text>
        </Pressable>
        <Pressable
          style={[styles.modeButton, mode === 'capture' ? styles.modeButtonActive : null]}
          onPress={() => setMode('capture')}
          testID="show-capture-mode"
        >
          <Text style={[styles.modeButtonText, mode === 'capture' ? styles.modeButtonTextActive : null]}>
            Camera
          </Text>
        </Pressable>
      </View>

      {mode === 'fixture' ? <FixtureAssessmentScreen /> : <CameraCaptureScreen />}
      <StatusBar style="light" />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0B',
  },
  modeBar: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: '#0A0A0B',
  },
  modeButton: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingVertical: 10,
  },
  modeButtonActive: {
    backgroundColor: 'rgba(245,158,11,0.18)',
    borderColor: 'rgba(245,158,11,0.75)',
  },
  modeButtonText: {
    color: '#A1A1AA',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  modeButtonTextActive: {
    color: '#F5F5F5',
  },
})
