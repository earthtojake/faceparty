export const prepareImageDOM = async (containerID: string): Promise<HTMLImageElement> => {
  const imgEl = getImageDOM(containerID);
  if (!imgEl) {
    return null;
  }
  if (imgEl.complete) {
    return imgEl;
  }
  return new Promise((resolve) => {
    imgEl.onload = () => {
      resolve(imgEl);
    };
  });
}

const getImageDOM = (containerID: string) => {
  const cont = document.getElementById(containerID);
  if (cont) {
    const imgs = cont.getElementsByTagName('img');
    if (imgs.length === 1) {
      return imgs[0];
    }
  }
  return null;
}