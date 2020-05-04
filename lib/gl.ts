import { ExpoWebGLRenderingContext } from "expo-gl";
import { Renderer, THREE } from "expo-three";
import {TRIANGULATION} from './triangulation';

const FACE_PREFIX = '__face_';
const N_FACES_IN_FACE_PLANE = TRIANGULATION.length/3;

// given face ID + facemesh prediction, render face onto scene
export const renderFaceMesh = (
  faceID: string,
  scene: THREE.Scene,
  mesh: Array<[number, number, number]>,
  triIdxs: Array<number> = null,
  color = 0xC68642,
): void => {

  const faceName = FACE_PREFIX + faceID;

  let facePlane = scene.getObjectByName(faceName) as THREE.Mesh;
  if (!facePlane) {
    facePlane = createFacePlane(color);
    facePlane.name = faceName;
    scene.add(facePlane);
  }
  
  const facePoints = [];
  if (triIdxs) {
    triIdxs.forEach(triIdx => {
      const face = getFaceForPoint(mesh, triIdx);
      facePoints.push(face);
    })
  } else {
    for (let i = 0; i < N_FACES_IN_FACE_PLANE; i++) {
      const face = getFaceForPoint(mesh, i);
      facePoints.push(face);
    }
  }

  updatePlane(facePlane, facePoints);

  // Object.entries(annotationGroups).forEach(([key, _featurePoints]) => {
  //   //@ts-ignore
  //   const featurePoints = _featurePoints.map(pt => [normalizeX(pt[0]), normalizeY(pt[1]), pt[2]]);
  //   //@ts-ignore
  //   if (!featureLines[key]) {
  //     //@ts-ignore
  //     featureLines[key] = createLine(featurePoints);
  //     //@ts-ignore
  //     scene.add(featureLines[key]);
  //   } else {
  //     //@ts-ignore
  //     updateLine(featureLines[key], featurePoints);
  //   }
  // })

}

const createFacePlane = (color = 0xC68642) => {
  const geometry = new THREE.BufferGeometry();
  const vertices = new Float32Array(new Array(N_FACES_IN_FACE_PLANE*9).fill(0))
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
  return new Renderer({ gl, width: width*2, height: height*2, clearColor: 0xFFFFFF });
}

export const initSceneAndCamera = (
  width: number,
  height: number,
): [THREE.Scene, THREE.PerspectiveCamera] => {

  const fov = 45
  const z = height / Math.tan(fov*Math.PI/360)

  const camera = new THREE.PerspectiveCamera(fov, 1, 0.01, z*2)
  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog( 0xffffff, 1, 10000 );
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