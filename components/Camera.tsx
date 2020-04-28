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
import {ANNOTATIONS} from '../lib/annotations';

import 'react-native-console-time-polyfill';
import { isBrowser, isMobile } from 'react-device-detect';

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

        const width = VIDEO_SIZE*2;
        const height = VIDEO_SIZE*2;

        const renderer = new Renderer({ gl:glRef.current, width, height, clearColor: 0xFFFFFF })

        const fov = 30
        const z = (height/2) / Math.tan(fov*Math.PI/360)

        const camera = new THREE.PerspectiveCamera(fov, 1, 0.01, z)
        const scene = new THREE.Scene()
        scene.fog = new THREE.Fog( 0xffffff, 1, 5000 );
        scene.fog.color.setHSL( 0.6, 0, 1 );

        camera.position.z = z/2;
        camera.position.y = VIDEO_SIZE/2
        camera.position.x = VIDEO_SIZE/2

        const dirLight = new THREE.DirectionalLight( 0xffffff, 0.5 );
        dirLight.position.set( VIDEO_SIZE/2, VIDEO_SIZE/2, z );
        dirLight.color.setHSL( 0.1, 0.1, 1 );
        dirLight.castShadow = true;
				dirLight.position.multiplyScalar( 50 );
        scene.add(dirLight);

        const hemiLight = new THREE.HemisphereLight( 0xffffff, 0xffffff, 0.5 );
        // hemiLight.position.set( VIDEO_SIZE/2, VIDEO_SIZE/2, z );
        hemiLight.color.setHSL( 0.6, 0.75, 1 );
				hemiLight.groundColor.setHSL( 0.095, 0.5, 1 );
        scene.add(hemiLight);

        const createPlane = (nFaces: number, color = 0xC68642) => {
          const geometry = new THREE.BufferGeometry();
          const vertices = new Float32Array(new Array(nFaces*9).fill(0))
          geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
          const material = new THREE.MeshToonMaterial( { side: THREE.DoubleSide, color } );
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

        const updatePlane = (plane: THREE.Mesh, faces: number[][][]) => {
          
          faces.forEach((face, pos) => updateFace(plane, pos, face));

          //smooth planes
          //@ts-ignore
          facePlane.geometry = new THREE.Geometry().fromBufferGeometry( facePlane.geometry );
          facePlane.geometry.mergeVertices();
          facePlane.geometry.computeVertexNormals();
          facePlane.geometry = new THREE.BufferGeometry().fromGeometry( facePlane.geometry );

        }

        const createLine = (points: number[][]) => {
          const vec = points.map(point => new THREE.Vector3(...point));
          const geometry = new THREE.BufferGeometry().setFromPoints(vec);
          const material = new THREE.LineBasicMaterial( { color: 0x0000ff } );
          return new THREE.LineLoop( geometry, material );
        }

        const updateLine = (line: THREE.Line, points: number[][]) => {
          //@ts-ignore
          const position = line.geometry.attributes.position.array;
          points.forEach((point, index) => {
            //@ts-ignore
            position[index*3] = point[0];
            //@ts-ignore
            position[index*3+1] = point[1];
            //@ts-ignore
            position[index*3+2] = point[2];
          })
          //@ts-ignore
          line.geometry.attributes.position.needsUpdate = true;
        }

        const normalizeX = (x) => VIDEO_SIZE-x;
        const normalizeY = (y) => VIDEO_SIZE-y;

        const N_FACES = TRIANGULATION.length/3;
        const facePlane = createPlane(N_FACES);
        scene.add(facePlane);

        let lipsPlane = null;

        const getFaceForPoint = (mesh: number[][], i: number) => {
          return [
            TRIANGULATION[i * 3], TRIANGULATION[i * 3 + 1],
            TRIANGULATION[i * 3 + 2]
          ].map(index => mesh[index]);
        }

        let featureLines = {};

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

            const normalizedMesh = scaledMesh.map(pt => [normalizeX(pt[0]), normalizeY(pt[1]), pt[2]]);

            const annotationGroups = {};
            
            annotationGroups['leftEyebrow'] = [
              ...annotations["leftEyebrowLower"],
              ...annotations["leftEyebrowUpper"].reverse()
            ];

            const lipFaces = [];
            let triIndexes = {};
            scaledMesh.forEach((_, index) => {
              if (ANNOTATIONS[index] === 'leftEyebrowLower' || ANNOTATIONS[index] === 'leftEyebrowUpper') {
                // this index maps to a TRIANGULATION index VALUE
                TRIANGULATION.forEach((t,i) => {
                  if (t === index) {
                    const j = (i-i%3)/3;
                    const pts = getFaceForPoint(scaledMesh, j);
                    const inBounds = pts.every(pt => annotationGroups['leftEyebrow'].indexOf(pt) !== -1);
                    if (!inBounds) {
                      return;
                    }
                    if (!triIndexes[j]) triIndexes[j] = []
                    triIndexes[j].push(t);
                  }
                })
              }
            })
            
            const facePoints = [];
            for (let i = 0; i < N_FACES; i++) {
              const face = getFaceForPoint(normalizedMesh, i);
              facePoints.push(face);
            }

            //@ts-ignore
            Object.keys(triIndexes).forEach(i => {
              const face = getFaceForPoint(normalizedMesh, parseInt(i)).map(pts => [pts[0], pts[1], pts[2]]);
              lipFaces.push(face);
            })

            if (!lipsPlane) {
              lipsPlane = createPlane(Object.keys(lipFaces).length, 0xdc3753);
              scene.add(lipsPlane);
            }

            updatePlane(facePlane, facePoints);
            updatePlane(lipsPlane, lipFaces);

            annotationGroups['rightEyebrow'] = [
              ...annotations["rightEyebrowLower"],
              ...annotations["rightEyebrowUpper"].reverse()
            ];

            annotationGroups['leftEye2'] = [
              ...annotations["leftEyeLower2"],
              ...annotations["leftEyeUpper2"].reverse()
            ];
          
            annotationGroups['rightEye2'] = [
              ...annotations["rightEyeLower2"],
              ...annotations["rightEyeUpper2"].reverse()
            ];
          
            annotationGroups['leftEye1'] = [
              ...annotations["leftEyeLower1"],
              ...annotations["leftEyeUpper1"].reverse()
            ];
          
            annotationGroups['rightEye1'] = [
              ...annotations["rightEyeLower1"],
              ...annotations["rightEyeUpper1"].reverse()
            ];
          
            annotationGroups['leftEye0'] = [
              ...annotations["leftEyeLower0"],
              ...annotations["leftEyeUpper0"].reverse()
            ];
          
            annotationGroups['rightEye0'] = [
              ...annotations["rightEyeLower0"],
              ...annotations["rightEyeUpper0"].reverse()
            ];
          
            annotationGroups['outerMouth'] = [
              ...annotations["lipsUpperOuter"],
              ...annotations["lipsLowerOuter"].reverse()
            ];
          
            annotationGroups['innerMouth'] = [
              ...annotations["lipsUpperInner"],
              ...annotations["lipsLowerInner"].reverse()
            ];

            Object.entries(annotationGroups).forEach(([key, _featurePoints]) => {
              //@ts-ignore
              const featurePoints = _featurePoints.map(pt => [normalizeX(pt[0]), normalizeY(pt[1]), pt[2]]);
              //@ts-ignore
              if (!featureLines[key]) {
                //@ts-ignore
                featureLines[key] = createLine(featurePoints);
                //@ts-ignore
                scene.add(featureLines[key]);
              } else {
                //@ts-ignore
                updateLine(featureLines[key], featurePoints);
              }
            })

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
