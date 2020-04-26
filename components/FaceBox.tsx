import React, { useRef, useEffect, DOMElement } from 'react'
import { Rect } from 'react-native-svg';
import { isBrowser } from 'react-device-detect';

type Props = {
  onMount: (ref: RectRef) => void,
  id: string | number,
}

type RectProps = {
  x: number,
  y: number,
  width: number,
  height: number,
}

type RectRef = {
  setNativeProps: (props: RectProps) => void,
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

  const svgRectRef = useRef(null);

  const elId = `__face_rect_${id}`;

  useEffect(() => {
    const dom = document.getElementById(elId);
    const setNativeProps = (props) => {
      const newProps = {
        ...svgRectRef.current.props,
        ...props,
      };
      if (isBrowser && dom) {
        setAttributes(dom, newProps);
      } else if (!isBrowser && svgRectRef) {
        svgRectRef.current.setNativeProps(newProps);
      }
    }
    onMount({
      setNativeProps,
    })
  }, []);

  return <Rect 
    ref={svgRectRef}
    id={elId}
    x={-1}
    y={-1}
    height={0}
    width={0}
    fill='none'
    strokeWidth='3'
    stroke='green'
  />

}