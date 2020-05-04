import React from 'react';
import { StyleSheet, View } from 'react-native';
import StaticImageTest from '../components/StaticImageTest';

export default function FaceTest() {
  return (
    <View style={styles.container}>
      <StaticImageTest testID='hugh' source={require('../assets/face.png')} />
      <StaticImageTest testID='blink' source={require('../assets/face-blink.png')} />
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
