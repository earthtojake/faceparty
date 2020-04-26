import React, { useRef, useEffect, DOMElement } from 'react'
import { Circle } from 'react-native-svg';
import { isBrowser } from 'react-device-detect';

type Props = {
  onMount: (ref: PointRef) => void,
  id: string | number,
}

type PointProps = {
  x: number,
  y: number,
  width: number,
  height: number,
}

type PointRef = {
  setNativeProps: (props: PointProps) => void,
}

function setAttributes(el, attrs) {
  for(var key in attrs) {
    el.setAttribute(key, attrs[key]);
  }
}

export default ({
  onMount,
  id,
}: Props) => {

  const svgPointRef = useRef(null);

  const elId = `__point_${id}`;

  useEffect(() => {
    const dom = document.getElementById(elId);
    const setNativeProps = (props) => {
      const newProps = {
        ...svgPointRef.current.props,
        ...props,
      };
      if (isBrowser && dom) {
        setAttributes(dom, newProps);
      } else if (!isBrowser && svgPointRef) {
        svgPointRef.current.setNativeProps(newProps);
      }
    }
    onMount({
      setNativeProps,
    })
  }, []);

  return <Circle 
    ref={svgPointRef}
    id={elId}
    cx={-1}
    cy={-1}
    r='1'
    strokeWidth='0'
    fill='red'
  />

}