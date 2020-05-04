import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, Text, View, Platform } from 'react-native';
import { Camera } from 'expo-camera';
import { THREE } from 'expo-three';
import { GLView, ExpoWebGLRenderingContext } from 'expo-gl'

import * as tf from '@tensorflow/tfjs';
import * as facemesh from '@tensorflow-models/facemesh';
import * as blazeface from '@tensorflow-models/blazeface';
import * as posenet from '@tensorflow-models/posenet';
import * as tfjsWasm from '@tensorflow/tfjs-backend-wasm';
import {version} from '@tensorflow/tfjs-backend-wasm/dist/version';

import 'react-native-console-time-polyfill';
import { isBrowser, isMobile } from 'react-device-detect';
import { initRenderer, initSceneAndCamera, renderFaceMesh } from '../lib/gl';

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

export default () => {

  const models = useRef({
    "facemesh": null,
    "blazeface": null,
    "posenet": null,
  }).current;

  const [modelsReady, setModelsReady] = useState(false);
  const [glReady, setGlReady] = useState(false);
  const [videoReady, setVideoReady] = useState(null);
  const cameraRef = useRef(null);
  const videoDOMRef = useRef(null);
  const glRef = useRef(null);

  const loadFacemesh = async () => {
    const facemeshModel = await facemesh.load({
      maxFaces: 1,
    });
    models.facemesh = facemeshModel;
  }

  const loadBlazeface = async () => {
    const blazefaceModel = await blazeface.load();
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
    models.posenet = posenetModel;
  }

  const loadModels = async () => {
    await tf.setBackend(BACKEND_TO_USE);
    await tf.ready();
    await Promise.all([loadPosenet(), loadBlazeface(), loadFacemesh()]);
    setModelsReady(true);
  }

  const [hasPermission, setHasPermission] = useState(null);

  const initVideo = () => {
    videoDOMRef.current = getVideoElFromDOM();
    if (videoDOMRef.current && videoDOMRef.current.readyState !== 4) {
      setupCamera(videoDOMRef.current).then(() => {
        setVideoReady(true);
      })
    }
  }

  useEffect(() => {
    initVideo()
  })

  useEffect(() => {
    if (!videoReady) {
      initVideo()
    }
  }, [videoReady]);

  useEffect(() => {
    (async () => {
      if (isBrowser) {
        setHasPermission(await Camera.isAvailableAsync());
      } else {
        const { status } = await Camera.requestPermissionsAsync();
        setHasPermission(status === 'granted');
        cameraRef.current.setNativeProps({type: Camera.Constants.Type.front});
      }
      await loadModels()
    })()
  }, [])

  const getVideoElFromDOM = () => {
    const cameraEl = document.getElementById('camera-container');
    if (cameraEl) {
      const videoEls = cameraEl.getElementsByTagName('video');
      if (videoEls.length === 1) {
        return videoEls[0];
      }
    }
  }

  useEffect(() => {

    (async () => {

      if (glReady && modelsReady && videoReady) {

        const renderer = initRenderer(glRef.current, VIDEO_SIZE, VIDEO_SIZE);
        const [scene, camera] = initSceneAndCamera(VIDEO_SIZE, VIDEO_SIZE);

        const animate = async () => {

          const {facemesh} = models;
          let faces = null;
          // hot-reloading unmounts video el, catch and reset here
          try {
            faces = await facemesh.estimateFaces(videoDOMRef.current);
          } catch (_) {
            setVideoReady(false);
            console.warn('video unmount');
          }
          if (faces.length > 0) {
            const {scaledMesh, annotations} = faces[0];
            const normMesh = scaledMesh.map(pt => [VIDEO_SIZE-pt[0], VIDEO_SIZE-pt[1], pt[2]]);
            renderFaceMesh('face1', scene, normMesh, annotations);
          }

          requestAnimationFrame( animate );
          renderer.render( scene, camera );

        }

        animate();
        
      }

    })()

  }, [glReady, modelsReady, videoReady]);

  if (hasPermission === null) {
    return <View />
  }
  if (hasPermission === false) {
    return <Text>No access to camera</Text>
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
      <GLView
        style={styles.overlay}
        onContextCreate={async (gl: ExpoWebGLRenderingContext) => {
          glRef.current = gl;
          setGlReady(true);
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
