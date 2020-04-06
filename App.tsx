import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, Text, View, Platform } from 'react-native';
import { Camera } from 'expo-camera';
import * as tf from '@tensorflow/tfjs';
import { cameraWithTensors } from '@tensorflow/tfjs-react-native';
import * as facemesh from '@tensorflow-models/facemesh';
import 'react-native-console-time-polyfill';
import Svg, { Circle } from 'react-native-svg';
const BACKEND_TO_USE = 'rn-webgl';

const TensorCamera = cameraWithTensors(Camera);

const FACTOR = 1;

const inputTensorWidth = 152/FACTOR;
const inputTensorHeight = 200/FACTOR;

const NUM_POINTS = 468;

export default function App() {

  const modelRef = useRef(null);
  const circleRefs = useRef(Array(NUM_POINTS).fill(null));

  useEffect(() => {
    async function init() {
      await tf.setBackend(BACKEND_TO_USE);
      await tf.ready();
      modelRef.current = await facemesh.load({
        maxFaces: 1,
      });
    }
    init()
  })

  const [hasPermission, setHasPermission] = useState(null);

  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestPermissionsAsync();
      setHasPermission(status === 'granted');
    })()
  }, [])

  if (hasPermission === null) {
    return <View />
  }
  if (hasPermission === false) {
    return <Text>No access to camera</Text>
  }
  
  let textureDims: { width: number; height: number; };
  if (Platform.OS === 'ios') {
    textureDims = {
      height: 1920,
      width: 1080,
    };
  } else {
    textureDims = {
      height: 1200,
      width: 1600,
    };
  }

  const handleImageTensorReady = (images: IterableIterator<tf.Tensor3D>) => {
    const loop = async () => {
      const imageTensor = images.next().value;
      if (imageTensor && modelRef.current) {
        // console.time("prediction");
        const preds = await modelRef.current.estimateFaces(imageTensor);
        // console.timeEnd("prediction");
        if (preds.length > 0) {
          const face = preds[0];
          const pts = face.scaledMesh.slice(0, NUM_POINTS);
          pts.forEach((pt, idx) => {
            const node = circleRefs.current[idx];
            if (node) {
              node.setNativeProps({cx: pt[0]*FACTOR, cy: pt[1]*FACTOR});
            }
          })
        }
      }
      tf.dispose(imageTensor);
      requestAnimationFrame(loop);
    };
    loop();
  }


  return (
    <View style={styles.cameraContainer}>
      <TensorCamera
        style={styles.camera}
        type={Camera.Constants.Type.front}
        zoom={0}
        cameraTextureHeight={textureDims.height}
        cameraTextureWidth={textureDims.width}
        resizeHeight={inputTensorHeight}
        resizeWidth={inputTensorWidth}
        resizeDepth={3}
        onReady={handleImageTensorReady}
        autorender={true}
      >
      </TensorCamera>
      <View style={styles.modelResults}>
        <Svg height='100%' width='100%'
        viewBox={`0 0 ${inputTensorWidth*FACTOR} ${inputTensorHeight*FACTOR}`}>
          {circleRefs.current.map((_, idx) => <Circle
            ref={ref => circleRefs.current[idx] = ref}
            key={`landmark_${idx}`}
            cx={0}
            cy={0}
            r='1'
            strokeWidth='0'
            fill='black'
          />)}
        </Svg>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  cameraContainer: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    height: '100%',
    backgroundColor: '#fff',
  },
  camera : {
    position:'absolute',
    left: 50,
    top: 100,
    width: 600/2,
    height: 800/2,
    zIndex: 1,
    borderWidth: 1,
    borderColor: 'black',
    borderRadius: 0,
  },
  modelResults: {
    position:'absolute',
    backgroundColor: 'white',
    left: 50,
    top: 100,
    width: 600/2,
    height: 800/2,
    zIndex: 20,
    borderWidth: 1,
    borderColor: 'black',
    borderRadius: 0,
  }
});
