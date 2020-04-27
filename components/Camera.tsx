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
import {TRIANGULATION} from '../lib/triangulation';

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

  const [numPoints, setNumPoints] = useState(0);
  const [modelsReady, setModelsReady] = useState(false);
  const [glReady, setGlReady] = useState(false);
  const [videoReady, setVideoReady] = useState(null);
  const svgRectRef = useRef(null);
  const svgPointRefs = useRef([]).current;
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
      await timeit("init", loadModels)()
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

        const width = VIDEO_SIZE*2;
        const height = VIDEO_SIZE*2;

        const renderer = new Renderer({ gl:glRef.current, width, height, clearColor: 0xFFFFFF })
        // renderer.setClearColor( 0xffff00, 0.1 );

        const fov = 45
        const z = (height/2) / Math.tan(fov*Math.PI/360)

        const camera = new THREE.PerspectiveCamera(fov, 1, 0.01, z)
        const scene = new THREE.Scene()
        camera.position.z = z/2;
        camera.position.y = VIDEO_SIZE/2
        camera.position.x = VIDEO_SIZE/2

        const sun = new THREE.DirectionalLight( 0xffffff, 0.75 );
        sun.position.set( VIDEO_SIZE/2, VIDEO_SIZE/2, z );
        sun.castShadow = true;
        scene.add(sun);

        const createPlane = (nFaces: number) => {
          const geometry = new THREE.BufferGeometry();
          const vertices = new Float32Array(new Array(nFaces*9).fill(0))
          geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
          const material = new THREE.MeshPhongMaterial( { side: THREE.DoubleSide, color: 0xE0AC69 } );
          const plane = new THREE.Mesh( geometry, material );
          return plane;
        }

        const updateFace = (plane: THREE.Mesh, pos: number, face: number[][]) => {
          face.forEach((points, index) => {
            //@ts-ignore
            updateVertex(plane.geometry, pos*3+index, points)
          })
        }

        const updateVertex = (geometry: THREE.BufferGeometry, index: number, point: number[]) => {
          const position = geometry.attributes.position.array;
          //@ts-ignore
          position[index*3] = point[0];
          //@ts-ignore
          position[index*3+1] = point[1];
          //@ts-ignore
          position[index*3+2] = point[2];
          //@ts-ignore
          geometry.attributes.position.needsUpdate = true;
        }

        const normalizeX = (x) => VIDEO_SIZE-x;
        const normalizeY = (y) => VIDEO_SIZE-y;

        const N_FACES = TRIANGULATION.length/3;
        const facePlane = createPlane(N_FACES);
        scene.add(facePlane);

        sun.target = facePlane;

        async function animate() {

          const {facemesh} = models;
          let faces = null;
          // hot-reloading unmounts video el, catch and reset here
          try {
            faces = await facemesh.estimateFaces(videoDOMRef.current);
          } catch (_) {
            setVideoReady(false);
          }
          
          if (faces && faces.length > 0) {
            
            const { scaledMesh, annotations } = faces[0];

            const scaledMeshIndexMap = {};
            scaledMesh.forEach((point, ptIdx) => {
              Object.entries(annotations).forEach(([key, values]) => {
                //@ts-ignore
                const idx = values.indexOf(point);
                if (idx !== -1) {
                  if (!scaledMeshIndexMap[key]) scaledMeshIndexMap[key] = [];
                  scaledMeshIndexMap[key].push(ptIdx);
                }
              })
            })

            const normalizedMesh = scaledMesh.map(pt => [normalizeX(pt[0]), normalizeY(pt[1]), pt[2]]);

            for (let i = 0; i < N_FACES; i++) {
              const facePoints = [
                TRIANGULATION[i * 3], TRIANGULATION[i * 3 + 1],
                TRIANGULATION[i * 3 + 2]
              ]
                .map(index => normalizedMesh[index])
              updateFace(facePlane, i, facePoints);
            }
            //@ts-ignore
            facePlane.geometry = new THREE.Geometry().fromBufferGeometry( facePlane.geometry );
            facePlane.geometry.mergeVertices();
            facePlane.geometry.computeVertexNormals();
            facePlane.geometry = new THREE.BufferGeometry().fromGeometry( facePlane.geometry );

          }

          requestAnimationFrame( animate );
          renderer.render( scene, camera );

        }

        animate();
        
      }
    })()

  }, [glReady, modelsReady, videoReady]);

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
      {/* {modelsReady && <View style={styles.overlay}>
        <Svg height='100%' width='100%'>
          <G key={'facebox_1'}>
            {svgPoints}
            <FaceBox
              id={'facebox'}
              onMount={(ref) => svgRectRef.current = ref}
            />
          </G>
        </Svg>
      </View>} */}
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
