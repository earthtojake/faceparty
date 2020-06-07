import { ExpoWebGLRenderingContext } from "expo-gl";
import { Renderer, THREE } from "expo-three";
import {TRIANGULATION} from './triangulation';
import {ANNOTATION_TRIANGULATION, ANNOTATION_INDEXES} from './annotations';

const FACE_PREFIX = '__face_';
const N_FACES_IN_FACE_PLANE = TRIANGULATION.length/3;

type PlaneFeature = {
  annotationKeys: Array<string>,
  color: string | number,
}

const PLANE_FEATURES: {[key: string]: PlaneFeature} = {
  lipsOuter: {
    annotationKeys: ["lipsOuter"],
    color: 'black',
  },
  eyes: {
    annotationKeys: ["rightEye0", "leftEye0"],
    color: 'white',
  },
  eyesOuter: {
    annotationKeys: ["rightEye1", "leftEye1"],
    color: 'white',
  },
  eyebrows: {
    annotationKeys: ["leftEyebrow", "rightEyebrow"],
    color: 'black',
  },
}

const SKIN_COLOR = 0x6b3bce;

const centroid = function (arr: Array<[number, number, number]>): [number, number, number]
{
    var minX, maxX, minY, maxY, minZ, maxZ;
    for (var i = 0; i < arr.length; i++)
    {
        minX = (arr[i][0] < minX || minX == null) ? arr[i][0] : minX;
        maxX = (arr[i][0] > maxX || maxX == null) ? arr[i][0] : maxX;
        minY = (arr[i][1] < minY || minY == null) ? arr[i][1] : minY;
        maxY = (arr[i][1] > maxY || maxY == null) ? arr[i][1] : maxY;
        minZ = (arr[i][2] < minZ || minZ == null) ? arr[i][2] : minZ;
        maxZ = (arr[i][2] > maxZ || maxZ == null) ? arr[i][2] : maxZ;
    }
    return [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
}

// given face ID + facemesh prediction, render face onto scene
export const renderFaceMesh = (
  faceID: string,
  scene: THREE.Scene,
  meshPoints: Array<[number, number, number]>,
  _customIndexMap: {[key: string]: Array<number>} = null,
  _customTriangulationMap: {[key: string]: Array<number>} = null,
): void => {

  const customIndexMap = _customIndexMap || ANNOTATION_INDEXES;
  const customTriMap = _customTriangulationMap || ANNOTATION_TRIANGULATION;

  const faceName = FACE_PREFIX + faceID;

  const getOrCreatePlane = (ID: string, color: string | number): THREE.Mesh => {
    let facePlane = scene.getObjectByName(faceName + ID) as THREE.Mesh;
    if (!facePlane) {
      facePlane = createFacePlane(color);
      facePlane.name = faceName + ID;
      scene.add(facePlane);
    }
    return facePlane;
  }
  
  const basePlane = getOrCreatePlane('base', SKIN_COLOR);
  const basePoints = [];
  for (let i = 0; i < N_FACES_IN_FACE_PLANE; i++) {
    const face = getFaceForPoint(meshPoints, i);
    basePoints.push(face);
  }
  updatePlane(basePlane, basePoints);

  Object.entries(PLANE_FEATURES).forEach(([key, {annotationKeys, color}]) => {
    annotationKeys.forEach(annotation => {
      const plane = getOrCreatePlane(key + annotation, color);
      const triangulation = customTriMap[annotation];
      const faces = triangulation.map(idx => getFaceForPoint(meshPoints, idx));
      updatePlane(plane, faces);
    })
  })

  const renderEye = (ID: string, eyePoints: Array<[number, number, number]>, color: number | string, radius: number): void => {
    const ctr = centroid(eyePoints);
    let eyePlane = scene.getObjectByName(faceName + ID) as THREE.Mesh;
    if (!eyePlane) {
      eyePlane = createCirclePlane(color, radius);
      eyePlane.name = faceName + ID;
      scene.add(eyePlane);
    }
    updateCircle(eyePlane, ctr);
  }

  const {eyes} = PLANE_FEATURES;
  const {annotationKeys} = eyes;
  annotationKeys.forEach(annotation => {
    const eyeIndexes = customIndexMap[annotation];
    const eyePoints = eyeIndexes.map(idx => meshPoints[idx]);
    renderEye('pupil' + annotation, eyePoints, 'black', 12);
  });

}

const createShape = (points: number[][]): THREE.Mesh => {
  const shape = new THREE.Shape();
  points.forEach(point => {
    shape.moveTo(point[0], point[1]);
  });
  const extrudeSettings = { amount: 8, bevelEnabled: true, bevelSegments: 2, steps: 2, bevelSize: 1, bevelThickness: 1 };
  const geometry = new THREE.ExtrudeBufferGeometry( shape, extrudeSettings );
  return new THREE.Mesh( geometry, new THREE.MeshPhongMaterial() );
}

const createFacePlane = (color: string | number) => {
  const geometry = new THREE.BufferGeometry();
  const vertices = new Float32Array(new Array(N_FACES_IN_FACE_PLANE*9).fill(0))
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
  const material = new THREE.MeshToonMaterial( { side: THREE.DoubleSide, color } );
  const plane = new THREE.Mesh( geometry, material );
  return plane;
}

const createCirclePlane = (color: string | number, radius: number): THREE.Mesh => {
  var geometry = new THREE.CircleGeometry( radius, 32 );
  var material = new THREE.MeshBasicMaterial( { color } );
  var circle = new THREE.Mesh( geometry, material );
  return circle;
}

const updateCircle = (circle: THREE.Mesh, point: [number, number, number]) => {
  circle.position.set(...point);
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
  smoothPlane(plane);
}

const smoothPlane = (plane: THREE.Mesh): void => {
  if (plane.geometry instanceof THREE.Geometry) {
    return;
  }
  plane.geometry = new THREE.Geometry().fromBufferGeometry( plane.geometry );
  plane.geometry.mergeVertices();
  plane.geometry.computeVertexNormals();
  plane.geometry = new THREE.BufferGeometry().fromGeometry( plane.geometry );
}

export const createLine = (points: number[][]) => {
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

const getFaceForPoint = (mesh: number[][], i: number) => {
  return [
    TRIANGULATION[i * 3], TRIANGULATION[i * 3 + 1],
    TRIANGULATION[i * 3 + 2]
  ].map(index => mesh[index]);
}

export const renderPoint = (pointID: string, scene: THREE.Scene, points: number[][], color = 0x888888) => {
  const dotName = '__point_' + pointID;
  let dot = scene.getObjectByName(dotName) as THREE.Points;
  if (dot) {
    console.log('found point', dotName, dot);
    return dot;
  }
  const dotGeometry = new THREE.Geometry();
  points.forEach(point => dotGeometry.vertices.push(new THREE.Vector3(...point)));
  const dotMaterial = new THREE.PointsMaterial( { color, size: 10, sizeAttenuation: false } );
  dot = new THREE.Points( dotGeometry, dotMaterial );
  dot.name = '__point_' + pointID;
  scene.add( dot );
}

export const initRenderer = (
  gl: ExpoWebGLRenderingContext,
  width: number,
  height: number,
): Renderer => {
  const renderer = new Renderer({ gl, width: width*2, height: height*2 });
  return renderer;
}

export const initSceneAndCamera = (
  width: number,
  height: number,
): [THREE.Scene, THREE.PerspectiveCamera] => {

  const fov = 45
  const z = height / Math.tan(fov*Math.PI/360)

  const camera = new THREE.PerspectiveCamera(fov, 1, 0.01, z*2)
  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog( 0xffffff, 1, 5000 );
  scene.fog.color.setHSL( 0.6, 0, 1 );

  camera.position.z = z/2;
  camera.position.y = width/2;
  camera.position.x = height/2;

  const dirLight = new THREE.DirectionalLight( 0xffffff, 0.5 );
  dirLight.position.set( width, height, z );
  dirLight.color.setHSL( 0.1, 0.1, 1 );
  dirLight.castShadow = true;
  dirLight.position.multiplyScalar( 50 );
  scene.add(dirLight);

  const hemiLight = new THREE.HemisphereLight( 0xffffff, 0xffffff, 0.5 );
  hemiLight.color.setHSL( 0.6, 0.75, 1 );
  hemiLight.groundColor.setHSL( 0.095, 0.5, 1 );
  scene.add(hemiLight);

  return [scene, camera];

}