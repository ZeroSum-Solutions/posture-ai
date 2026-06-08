import { StatusBar } from 'expo-status-bar'
import { SafeAreaView, StyleSheet } from 'react-native'

import FixtureAssessmentScreen from './src/FixtureAssessmentScreen'

export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <FixtureAssessmentScreen />
      <StatusBar style="light" />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0B',
  },
})
