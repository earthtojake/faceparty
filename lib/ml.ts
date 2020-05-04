import { useState, useEffect } from "react";

// callback when model loads, state containing model
const defaultParams = {}
export function useTFModel(tfModel: any, params: Object = null) {
  const [model, setModel] = useState(null);
  useEffect(() => {
    (async () => {
      const loadedModel = await tfModel.load(params || defaultParams);
      if (!model) setModel(loadedModel);
    })();
  }, [model]);
  return model;
}