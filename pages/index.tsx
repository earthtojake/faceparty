import React from 'react';
import { StyleSheet, View } from 'react-native';
import Camera from '../components/Camera';

export default function App() {
  return (
    <View style={styles.container}>
      <Camera />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    fontSize: 16,
  },
});
