import now from 'performance-now';

const AsyncFunction = (async () => {}).constructor;

let _perf = {};
export default function timeit(funcKey: string, func: Function, it = 1, max = 1000) {

  const getAvg = (grades) => {
    const total = grades.reduce((acc, c) => acc + c, 0);
    return total / grades.length;
  }
  const getSD = (data) => {
    let m = getAvg(data);
    return Math.sqrt(data.reduce((sq, n) => {
      return sq + Math.pow(n - m, 2);
    }, 0) / (data.length - 1));
  }

  const endTimer = (start) => {
    const delta = parseFloat((now()-start).toFixed(3));
    if (!_perf[funcKey]) {
      _perf[funcKey] = []; // initialize array ref
    }
    const perf = _perf[funcKey];
    perf.push(delta);
    if (perf.length % it === 0) {
      console.log(`${funcKey}: avg = ${getAvg(perf)} std = ${getSD(perf)}`);
    }
    while (perf.length > max) {
      perf.shift()
    }
  }

  if (func instanceof AsyncFunction) {
    return async function(...args) {
      const start = now();
      const result = await func.call(this, ...args);
      endTimer(start);
      return result;
    }
  } else {
    return function(...args) {
      const start = now();
      const result = func.call(this, ...args);
      endTimer(start);
      return result;
    }
  }

}
