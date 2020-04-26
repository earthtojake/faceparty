import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, Text, View, Platform, Dimensions, PixelRatio } from 'react-native';
import { Camera } from 'expo-camera';
import * as tf from '@tensorflow/tfjs';
import { cameraWithTensors } from '@tensorflow/tfjs-react-native';
import * as facemesh from '@tensorflow-models/facemesh';
import * as blazeface from '@tensorflow-models/blazeface';
import * as posenet from '@tensorflow-models/posenet';
import 'react-native-console-time-polyfill';
import Svg, { Circle, Rect, G } from 'react-native-svg';
const BACKEND_TO_USE = 'rn-webgl';

const TensorCamera = cameraWithTensors(Camera);

const inputTensorDims = {
  width: 200,
  height: 200,
}

const textureDims = {
  height: PixelRatio.get()*Dimensions.get('screen').height,
  width: PixelRatio.get()*Dimensions.get('screen').width,
};

export default function App() {

  const models = useRef({
    "facemesh": null,
    "blazeface": null,
    "posenet": null,
  }).current;

  const [numPoints, setNumPoints] = useState(0);
  const svgPointRefs = useRef([]);
  const svgRectRef = useRef(null);
  const rafIDRef = useRef(null);

  const loadFacemesh = async () => {
    const facemeshModel = await facemesh.load({
      maxFaces: 1,
    });
    facemeshModel.estimateFaces = timeit("facemesh", facemeshModel.estimateFaces, 100);
    models.facemesh = facemeshModel;
  }

  const loadBlazeface = async () => {
    const blazefaceModel = await blazeface.load();
    blazefaceModel.estimateFaces = timeit("blazeface", blazefaceModel.estimateFaces, 100);
    models.blazeface = blazefaceModel;
  }

  const loadPosenet = async () => {
    const posenetModel = await posenet.load({
      architecture: 'MobileNetV1',
      outputStride: 16,
      inputResolution: inputTensorDims,
      multiplier: 0.75,
      quantBytes: 2
    });
    posenetModel.estimateSinglePose = timeit("posenet", posenetModel.estimateSinglePose, 100);
    models.posenet = posenetModel;
  }

  const loadModels = async () => {
    await tf.setBackend(BACKEND_TO_USE);
    await tf.ready();
    await Promise.all([loadPosenet(), loadBlazeface(), loadFacemesh()]);
  }

  useEffect(() => {
    async function init() {
      await timeit("init", loadModels)()
    }
    init()
    return () => {
      if (rafIDRef.current) cancelAnimationFrame(rafIDRef.current)
    }
  }, [])

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

  const handleImageTensorReady = (images: IterableIterator<tf.Tensor3D>) => {
    const loop = async () => {
      const imageTensor = images.next().value;

      if (imageTensor) {

        const {facemesh, posenet, blazeface} = models;

        if (facemesh) {
          const faces = await facemesh.estimateFaces(imageTensor);
          if (faces && faces.length > 0) {
            const { scaledMesh, boundingBox } = faces[0];
            const widthRatio = textureDims.width/inputTensorDims.width;
            const heightRatio = textureDims.height/inputTensorDims.height;
            renderBoundingBox(boundingBox.topLeft[0], boundingBox.bottomRight[0]);
            renderPoints(scaledMesh.map(pt => [pt[0]*widthRatio, pt[1]*heightRatio]));
          }
        }

        // if (posenet) {
        //   const flipHorizontal = Platform.OS === 'ios' ? false : true;
        //   const pose = await posenet.estimateSinglePose(
        //     imageTensor, { flipHorizontal });
        //   if (pose && pose.keypoints && pose.keypoints.length > 0) {
        //     const pts = pose.keypoints
        //       .filter(k => k.score > 0.2)
        //       .map(k => [k.position.x, k.position.y])
        //     renderPoints(pts);
        //   }
        // }

        // if (blazeface) {
        //   const returnTensors = false;
        //   const faces = await blazeface.estimateFaces(imageTensor, returnTensors);
        //   if (faces && faces.length > 0) {
        //     const { topLeft, bottomRight, landmarks } = faces[0];
        //     renderBoundingBox(topLeft, bottomRight);
        //     renderPoints(landmarks);
        //   }
        // }

        tf.dispose(imageTensor);

      }

      rafIDRef.current = requestAnimationFrame(loop);

    };
    loop();
  }

  const renderPoints = (pts: number[][]) => {
    setNumPoints(pts.length);
    pts.forEach((pt, idx) => {
      const node = svgPointRefs.current[idx];
      if (node) {
        node.setNativeProps({cx: pt[0], cy: pt[1]});
      }
    })
  }

  const renderBoundingBox = (topLeft: number[], bottomRight: number[]) => {
    const x = topLeft[0]
    const width = bottomRight[0] - x;
    const y = topLeft[1];
    const height = bottomRight[1] - y;
    svgRectRef.current.setNativeProps({x, y, width, height})
  }

  const svgPoints = [];
  for (let i = 0; i < numPoints; i++) {
    svgPoints.push(<Circle
      ref={ref => svgPointRefs.current[i] = ref}
      key={`pt_${i}`}
      cx={-1}
      cy={-1}
      r='1'
      strokeWidth='0'
      fill='red'
    />)
  }

  const svgRect = <Rect 
    ref={ref => svgRectRef.current = ref}
    x={-1}
    y={-1}
    height={0}
    width={0}
    fill='none'
    strokeWidth='3'
    stroke='green'
  />

  return (
    <View style={styles.cameraContainer}>
      <TensorCamera
        style={styles.camera}
        type={Camera.Constants.Type.front}
        zoom={0}
        cameraTextureHeight={textureDims.height}
        cameraTextureWidth={textureDims.width}
        resizeHeight={inputTensorDims.height}
        resizeWidth={inputTensorDims.width}
        resizeDepth={3}
        onReady={handleImageTensorReady}
        autorender={false}
      >
      </TensorCamera>
      <View style={styles.modelResults}>
        <Svg height='100%' width='100%'>
          <G key={'facebox_1'}>
            {svgPoints}
            {svgRect}
          </G>
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
    left: 0,
    top: 0,
    width: 600/2,
    height: 800/2,
    zIndex: 1,
    borderWidth: 1,
    borderColor: 'black',
    borderRadius: 0,
  },
  modelResults: {
    position:'absolute',
    backgroundColor: 'transparent',
    left: 0,
    top: 0,
    width: 600/2,
    height: 800/2,
    zIndex: 20,
  }
});
