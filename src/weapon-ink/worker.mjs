import {unpackBlend,prepareInk,colorBlend,colorGlb} from './model.mjs';

let native,scene,profile;
self.onmessage=async ({data})=>{
  try {
    if(data.type==='init') {
      profile=data.profile;
      native=unpackBlend(data.blend);
      scene=native.then(raw=>prepareInk(data.glb,raw,profile));
      // Both tasks are awaited by colour requests. Handle early failures on init too.
      await scene;
    } else {
      const blob=data.type==='blend'?colorBlend(await native,profile,data.hex):await colorGlb(await scene,data.hex);
      self.postMessage({id:data.id,blob});return;
    }
    self.postMessage({id:data.id});
  } catch(error) { self.postMessage({id:data.id,error:error.message}); }
};
