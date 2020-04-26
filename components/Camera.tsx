import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, Text, View, Platform } from 'react-native';
import { Camera } from 'expo-camera';
import { Renderer, THREE } from 'expo-three';
import { GLView, ExpoWebGLRenderingContext } from 'expo-gl'

import * as tf from '@tensorflow/tfjs';
import * as facemesh from '@tensorflow-models/facemesh';
import * as blazeface from '@tensorflow-models/blazeface';
import * as posenet from '@tensorflow-models/posenet';
import * as tfjsWasm from '@tensorflow/tfjs-backend-wasm';
import {version} from '@tensorflow/tfjs-backend-wasm/dist/version';

import 'react-native-console-time-polyfill';
import Svg, { G } from 'react-native-svg';
import timeit from '../lib/timeit';
import { isBrowser, isMobile } from 'react-device-detect';
import FaceBox from './FaceBox';
import FacePoint from './FacePoint';

const BACKEND_TO_USE = isBrowser ? 'wasm' : 'rn-webgl';

//@ts-ignore
global.THREE = global.THREE || THREE;

tfjsWasm.setWasmPath(
  `https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@${
      version}/dist/tfjs-backend-wasm.wasm`);

const inputTensorDims = {
  width: 200,
  height: 200,
}

const VIDEO_SIZE = 500;

export default () => {

  const models = useRef({
    "facemesh": null,
    "blazeface": null,
    "posenet": null,
  }).current;

  const [numPoints, setNumPoints] = useState(0);
  const [modelsReady, setModelsReady] = useState(false);
  const [videoEl, setVideoEl] = useState(null);
  const svgRectRef = useRef(null);
  const svgPointRefs = useRef([]).current;
  const cameraRef = useRef(null);
  const glRef = useRef(null);

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
    setModelsReady(true);
  }

  const [hasPermission, setHasPermission] = useState(null);

  useEffect(() => {
    (async () => {
      if (videoEl && modelsReady) {
        // start animation loop
        renderPredictions();
      }
    })()
  }, [videoEl, modelsReady]);

  useEffect(() => {
    const cameraEl = document.getElementById('camera-container');
    if (cameraEl && !videoEl) {
      const videoEls = cameraEl.getElementsByTagName('video');
      if (videoEls.length === 1) {
        (async () => {
          const videoEl = await setupCamera(videoEls[0]);
          setVideoEl(videoEl);
        })()
      }
    }
  })

  const setupCamera = async (videoEl) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      'audio': false,
      'video': {
        facingMode: 'user',
        // Only setting the video to a specified size in order to accommodate a
        // point cloud, so on mobile devices accept the default size.
        width: isMobile ? undefined : VIDEO_SIZE,
        height: isMobile ? undefined : VIDEO_SIZE
      },
    });
    videoEl.srcObject = stream;
    return new Promise((resolve) => {
      videoEl.onloadedmetadata = () => {
        resolve(videoEl);
      };
    });
  }

  useEffect(() => {
    (async () => {
      if (isBrowser) {
        setHasPermission(await Camera.isAvailableAsync());
      } else {
        const { status } = await Camera.requestPermissionsAsync();
        setHasPermission(status === 'granted');
        cameraRef.current.setNativeProps({type: Camera.Constants.Type.front});
      }
      await timeit("init", loadModels)()
    })()
  }, [])

  if (hasPermission === null) {
    return <View />
  }
  if (hasPermission === false) {
    return <Text>No access to camera</Text>
  }

  const renderPredictions = async () => {

    if (videoEl && modelsReady) {

      const {facemesh, posenet, blazeface} = models;

      if (facemesh) {
        const faces = await facemesh.estimateFaces(videoEl);
        if (faces && faces.length > 0) {
          const { scaledMesh, boundingBox } = faces[0];
          renderBoundingBox(boundingBox.topLeft[0], boundingBox.bottomRight[0]);
          renderPoints(scaledMesh.map(pt => [pt[0], pt[1]]));
        }
      }

      // if (blazeface) {
      //   const faces = await blazeface.estimateFaces(videoEl, false);
      //   if (faces && faces.length > 0) {
      //     const { topLeft, bottomRight, landmarks } = faces[0];
      //     // renderBoundingBox(topLeft, bottomRight);
      //   }
      // }

      // if (posenet) {
      //   const flipHorizontal = Platform.OS === 'ios' ? false : true;
      //   const pose = await posenet.estimateSinglePose(videoEl, { flipHorizontal });
      //   if (pose && pose.keypoints && pose.keypoints.length > 0) {
      //     const pts = pose.keypoints
      //       .filter(k => k.score > 0.2)
      //       .map(k => [k.position.x, k.position.y])
      //     // renderPoints(pts);
      //   }
      // }

    }

    requestAnimationFrame(renderPredictions);

  }

  const renderPoints = (pts: number[][]) => {
    setNumPoints(pts.length);
    pts.forEach((pt, idx) => {
      const node = svgPointRefs[idx];
      if (node) {
        node.setNativeProps({cx: VIDEO_SIZE-pt[0], cy: pt[1]});
      }
    })
  }

  const renderBoundingBox = (topLeft: number[], bottomRight: number[]) => {
    const width = bottomRight[0] - topLeft[0];
    const x = VIDEO_SIZE-topLeft[0]-width;
    const y = topLeft[1];
    const height = bottomRight[1] - y;
    if (svgRectRef.current) {
      svgRectRef.current.setNativeProps({x, y, width, height});
    }
  }

  const svgPoints = [];
  for (let i = 0; i < numPoints; i++) {
    svgPoints.push(<FacePoint 
      key={i}
      id={i}
      onMount={(ref) => svgPointRefs[i] = ref}
    />)
  }

  return (
    <View
      style={styles.cameraContainer}
      nativeID='camera-container'
    >
      <Camera
        style={{flex: 1}}
        ref={cameraRef}
      />
      {modelsReady && <View style={styles.overlay}>
        <Svg height='100%' width='100%'>
          <G key={'facebox_1'}>
            {svgPoints}
            <FaceBox
              id={'facebox'}
              onMount={(ref) => svgRectRef.current = ref}
            />
          </G>
        </Svg>
      </View>}
      <GLView
        style={styles.overlay}
        onContextCreate={async (gl: ExpoWebGLRenderingContext) => {
          
          // const { drawingBufferWidth: width, drawingBufferHeight: height } = gl
          // const sceneColor = 0x6ad6f0

          // // Create a WebGLRenderer without a DOM element
          // const renderer = new Renderer({ gl, width, height, clearColor: sceneColor })
          // const camera = new THREE.PerspectiveCamera(75, width / height, 0.01, 1000)
          // const scene = new THREE.Scene()

          // var geometry = new THREE.BoxGeometry();
          // var material = new THREE.MeshBasicMaterial( { color: 0x00ff00 } );
          // var cube = new THREE.Mesh( geometry, material );
          // scene.add( cube );

          // renderer.render(scene, camera);

          // let faceShape = null;

          // async function animate() {
          //   if (videoEl && modelsReady) {
          //     const {facemesh} = models;
          //     if (facemesh) {
          //       const faces = await facemesh.estimateFaces(videoEl);
          //       if (faces.length > 0) {
          //         const {scaledMesh} = faces[0];
          //         if (!faceShape) {
          //           const geometry = new THREE.Geometry();
          //           scaledMesh.forEach(pt => geometry.vertices.push(
          //             new THREE.Vector3(pt[0], pt[1], pt[2])
          //           ))
          //           geometry.computeBoundingSphere();
          //           const material = new THREE.MeshBasicMaterial( {color: 0xffff00, side: THREE.DoubleSide} );
          //           const plane = new THREE.Mesh( geometry, material );
          //           scene.add(plane)
          //           // create shape, add to scene
          //         }
          //       }
          //     }
          //   }
          //   requestAnimationFrame( animate );
          //   renderer.render( scene, camera );
          // }
          // animate();

        }}
      />
    </View>
  )

}

const styles = StyleSheet.create({
  cameraContainer: {
    width: VIDEO_SIZE,
    height: VIDEO_SIZE,
    borderWidth: 1,
    borderColor: 'black',
  },
  camera : {
    flex: 1,
  },
  overlay: {
    position:'absolute',
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
    zIndex: 20,
  }
});
