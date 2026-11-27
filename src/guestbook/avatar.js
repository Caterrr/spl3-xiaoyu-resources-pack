function loadImage(src) {
  return new Promise((resolve,reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}
export function makeAvatarPainter(whiteURL, blackURL) {
  let images;
  const scratch = document.createElement('canvas');
  scratch.width = scratch.height = 128;
  const ctx = scratch.getContext('2d',{willReadFrequently:true});
  const linear = Array.from({length:256},(_,i) => {
    const s = i/255; return s <= .04045 ? s/12.92 : ((s+.055)/1.055)**2.4;
  });
  function channel(v) { return Math.round(255*(v <= .0031308 ? 12.92*v : 1.055*v**(1/2.4)-.055)); }
  function sample(image,actor,face) {
    ctx.clearRect(0,0,128,128);
    ctx.drawImage(image,face*128,actor*128,128,128,0,0,128,128);
    return ctx.getImageData(0,0,128,128);
  }
  return async function paint(target,{actor,face,ink,paper}) {
    images ||= Promise.all([loadImage(whiteURL),loadImage(blackURL)]).catch(err=>{images=null;throw err;});
    const [white,black] = await images;
    const light = sample(white,actor,face), dark = sample(black,actor,face);
    const tone = [1,3,5].map(i=>linear[parseInt(ink.slice(i,i+2),16)]);
    for (let i=0;i<light.data.length;i+=4) {
      for (let c=0;c<3;c++) {
        const a=linear[dark.data[i+c]], b=linear[light.data[i+c]];
        light.data[i+c]=channel(a+(b-a)*tone[c]);
      }
    }
    ctx.putImageData(light,0,0);
    const out=target.getContext('2d');
    out.fillStyle=paper; out.fillRect(0,0,128,128); out.drawImage(scratch,0,0);
  };
}
