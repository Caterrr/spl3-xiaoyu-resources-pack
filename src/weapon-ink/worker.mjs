import {unpackBlend,prepareInk,inkSurfaces,colorBlend,colorGlb} from './model.mjs?v=ink-live-1';

let native,scene,profile;
self.onmessage=async ({data})=>{
  try {
    let result;
    const transfers=[];
    switch(data.type) {
      case 'init':
        profile=data.profile;
        native=await unpackBlend(data.blend);
        scene=await prepareInk(data.glb,native,profile);
        break;
      case 'preview':
        result=[];
        for(const surface of inkSurfaces(scene,data.hex)) {
          // CanvasTexture uploads bottom-up. glTF image rows start at the top.
          const {rgba,width,height}=surface, stride=width*4;
          const flipped=new Uint8ClampedArray(rgba.length);
          for(let y=0;y<height;y++)
            flipped.set(rgba.subarray(y*stride,(y+1)*stride),(height-1-y)*stride);
          result.push({...surface,rgba:flipped});
          transfers.push(flipped.buffer);
        }
        break;
      case 'blend': result=colorBlend(native,profile,data.hex);break;
      case 'glb': result=await colorGlb(scene,data.hex);break;
      default: throw Error('Unknown ink request');
    }
    self.postMessage({id:data.id,result},transfers);
  } catch(error) { self.postMessage({id:data.id,error:error.message}); }
};
