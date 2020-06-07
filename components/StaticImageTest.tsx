import React, { useState, useEffect } from 'react';
import { View, Image, Text } from 'react-native';
import { GLView, ExpoWebGLRenderingContext } from 'expo-gl';
import * as facemesh from '@tensorflow-models/facemesh';
import { prepareImageDOM } from '../lib/dom';
import { useTFModel } from '../lib/ml';
import { initRenderer, initSceneAndCamera, renderFaceMesh, renderPoint, createLine } from '../lib/gl';
import { TRIANGULATION } from '../lib/triangulation';

const IMG_WIDTH = 400;
const IMG_HEIGHT = 400;

const getFaceForPoint = (mesh: number[][], i: number) => {
  return [
    TRIANGULATION[i * 3], TRIANGULATION[i * 3 + 1],
    TRIANGULATION[i * 3 + 2]
  ].map(index => mesh[index]);
}

// point = xy, vs = polygon border
function inside(point, vs) {
  // ray-casting algorithm based on
  // http://www.ecse.rpi.edu/Homepages/wrf/Research/Short_Notes/pnpoly.html

  var x = point[0], y = point[1];

  // check if contains xy coord
  const isBorder = vs.some(pt => pt[0] === x && pt[1] === y);
  if (isBorder) {
    return true;
  }

  var inside = false;
  for (var i = 0, j = vs.length - 1; i < vs.length; j = i++) {
      var xi = vs[i][0], yi = vs[i][1];
      var xj = vs[j][0], yj = vs[j][1];

      var intersect = ((yi > y) != (yj > y))
          && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
  }

  return inside;
};

const computeTriIndexes = (annoSet: any, normMesh: number[][]): number[]=> {
  const annoFaceTriIdxs = new Set();
  annoSet.forEach(([_, annoIdx]) => {
    TRIANGULATION.forEach((triIdx, i) => {
      if (triIdx === annoIdx) {
        const j = (i-i%3)/3;
        const facePts = getFaceForPoint(normMesh, j);
        // check that every face pt is in anno pts
        const fullMatch = facePts.every(facePt => {
          let match = false;
          annoSet.forEach(([annoPt, _]) => {
            // console.log(facePt, annoPt);
            if (facePt[0] === annoPt[0] && facePt[1] === annoPt[1]) {
              match = true;
            }
          });
          return match;
        })
        if (fullMatch) {
          annoFaceTriIdxs.add(j);
        }
      }
    })
  });
  return Array.from(annoFaceTriIdxs) as number[];
}

const StaticImageTest = ({
  testID,
  source,
}) => {

  const imgContainerID = `${testID}-img-container`;

  const [gl, setGL] = useState(null);
  const [imgReady, setImgReady] = useState(false);
  const facemeshModel = useTFModel(facemesh, { maxFaces: 1 });

  const [triIdxs, setTriIdxs] = useState({});
  const [idxs, setIdxs] = useState({});

  useEffect(() => {
    (async () => {
      if (facemeshModel && gl && imgReady) {
        const imgEl = await prepareImageDOM(imgContainerID);
        const faces = await facemeshModel.estimateFaces(imgEl);
        const renderer = initRenderer(gl, IMG_WIDTH, IMG_HEIGHT);
        const [scene, camera] = initSceneAndCamera(IMG_WIDTH, IMG_HEIGHT);

        if (faces.length > 0) {
          const {scaledMesh, annotations, boundingBox} = faces[0];
          const {topLeft, bottomRight} = boundingBox;
          console.log(topLeft, bottomRight);
          const width = Math.abs(topLeft[0][0] - bottomRight[0][0]);
          const height = Math.abs(topLeft[0][1] - bottomRight[0][1]);
          console.log(width, height);

          const norm = (pts) => pts.map(pt => [pt[0], (IMG_HEIGHT-pt[1]) * width / height, pt[2]]);
          const normMesh = norm(scaledMesh);
          
          const featurePointsDict = {
            'lipsOuter': [
              ...norm(annotations["lipsUpperOuter"]),
              ...norm(annotations["lipsLowerOuter"]).reverse()
            ],
            'lipsInner': [
              ...norm(annotations["lipsUpperInner"]),
              ...norm(annotations["lipsLowerInner"]).reverse()
            ],
            'rightEyebrow': [
              ...norm(annotations['rightEyebrowUpper']).slice(1),
              ...norm(annotations['rightEyebrowLower']).reverse(),
            ],
            'leftEyebrow': [
              ...norm(annotations['leftEyebrowUpper']).slice(1),
              ...norm(annotations['leftEyebrowLower']).reverse(),
            ],
            'rightEye3': [
              ...norm(annotations['rightEyeUpper2']),
              ...norm(annotations['rightEyeLower3']).reverse(),
            ],
            'leftEye3': [
              ...norm(annotations['leftEyeUpper2']),
              ...norm(annotations['leftEyeLower3']).reverse(),
            ],
            'rightEye2': [
              ...norm(annotations['rightEyeUpper2']),
              ...norm(annotations['rightEyeLower2']).reverse(),
            ],
            'leftEye2': [
              ...norm(annotations['leftEyeUpper2']),
              ...norm(annotations['leftEyeLower2']).reverse(),
            ],
            'rightEye1': [
              ...norm(annotations['rightEyeUpper1']),
              ...norm(annotations['rightEyeLower1']).reverse(),
            ],
            'leftEye1': [
              ...norm(annotations['leftEyeUpper1']),
              ...norm(annotations['leftEyeLower1']).reverse(),
            ],
            'rightEye0': [
              ...norm(annotations['rightEyeUpper0']),
              ...norm(annotations['rightEyeLower0']).reverse(),
            ],
            'leftEye0': [
              ...norm(annotations['leftEyeUpper0']),
              ...norm(annotations['leftEyeLower0']).reverse(),
            ]
          }

          // for each feature point, find in scaled mesh, save scaled mesh idx
          const featurePointIdxs: {[key: string]: Array<number>} = {};
          const featurePointsEntries = Object.entries(featurePointsDict);
          featurePointsEntries.forEach(([featureKey, featurePoints]) => {
            featurePointIdxs[featureKey] = []; // init array
            featurePoints.forEach(featurePoint => {
              const idx = normMesh.findIndex((meshPoint) => featurePoint[0] === meshPoint[0] && featurePoint[1] === meshPoint[1] && featurePoint[2] === meshPoint[2])
              if (idx !== -1) {
                featurePointIdxs[featureKey].push(idx);
              }
            })
          });
          setIdxs(featurePointIdxs);

          const featureSetsDict = {};

          normMesh.forEach((pt, idx) => {
            Object.entries(featurePointsDict).forEach(([featureKey, featurePoints]) => {
              if (inside(pt, featurePoints)) {
                if (!featureSetsDict[featureKey]) {
                  featureSetsDict[featureKey] = new Set();
                }
                featureSetsDict[featureKey].add([pt, idx]);
              }
            });
          });

          const featureTriIdxs = {}
          Object.entries(featureSetsDict).forEach(([featureKey, featureSet]) => {
            featureTriIdxs[featureKey] = computeTriIndexes(featureSet, normMesh);
          });
          setTriIdxs(featureTriIdxs);
          
          renderFaceMesh(testID+'face', scene, normMesh, featurePointIdxs, featureTriIdxs);

          Object.values(featurePointIdxs).forEach((featureIdxs) => {
            const points = featureIdxs.map(idx => normMesh[idx]);
            const line = createLine(points);
            scene.add(line);
          })
          
        }
        renderer.render( scene, camera );
      }
    })();
  }, [facemeshModel, gl, imgReady])

  return <View style={{width: '100%'}}>
    <View style={{ flex: 1, flexDirection: 'row' }} nativeID={imgContainerID}>
      <Image
        style={{ width: IMG_WIDTH, height: IMG_HEIGHT }}
        source={source}
        onLoad={() => setImgReady(true)}
      />
      <GLView
        style={{ width: IMG_WIDTH, height: IMG_HEIGHT }}
        onContextCreate={async (gl: ExpoWebGLRenderingContext) => {
          setGL(gl);
        }}
      />
    </View>
    <Text>
      TRIANGULATION ={' '}
      {JSON.stringify(triIdxs)}
    </Text>
    <Text>
      INDEXES ={' '}
      {JSON.stringify(idxs)}
    </Text>
  </View>

}

export default StaticImageTest;