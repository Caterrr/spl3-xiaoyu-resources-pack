let opening;
function database() {
  if (!opening) opening=new Promise((resolve,reject)=>{
    const request=indexedDB.open('xiaoyu-photo-studio',1);
    request.onupgradeneeded=()=>{
      for(const name of ['projects','looks']) request.result.createObjectStore(name,{keyPath:'id'});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>{opening=null;reject(request.error);};
  });
  return opening;
}
export async function records(store,method,...args) {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(store,['get','getAll'].includes(method)?'readonly':'readwrite');
    const request=tx.objectStore(store)[method](...args);
    tx.oncomplete=()=>resolve(request.result);
    tx.onabort=()=>reject(tx.error||Error('保存失败'));
    tx.onerror=()=>reject(tx.error);
  });
}
// A second tab can keep editing its own copy if the original has changed or was deleted.
export async function writeProject(copy, revision=0) {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('projects','readwrite');
    const store=tx.objectStore('projects');
    const get=store.get(copy.id);
    let forked=false;
    get.onsuccess=()=>{
      const latest=get.result?.revision||0;
      if(latest!==revision){
        copy.id=crypto.randomUUID();
        copy.name+=' · 副本';
        forked=true;
      }
      copy.revision=(forked?0:latest)+1;
      store.put(copy);
    };
    tx.oncomplete=()=>resolve({id:copy.id,name:copy.name,revision:copy.revision,forked});
    tx.onabort=()=>reject(tx.error||Error('项目未能保存'));
  });
}
export const lightPresets={
  studio:{key:2.5,ambient:2.6,angle:32,color:'#ffffff',exposure:1,shadow:true},
  soft:{key:1.2,ambient:3.2,angle:-30,color:'#fff4eb',exposure:1.05,shadow:false},
  sunset:{key:3.4,ambient:1.6,angle:-65,color:'#ffb374',exposure:1,shadow:true},
  night:{key:2.2,ambient:.8,angle:70,color:'#a3bfff',exposure:.9,shadow:true}
};
export function actor(data,index) {
  return {...data,id:crypto.randomUUID(),name:data.name||'角色 '+(index+1),
    x:data.ground?0:index*.85,y:data.ground?-.04:0,z:0,angle:0,scale:1};
}
export function project(name,first) {
  return {id:crypto.randomUUID(),name,actors:[first],selected:first.id,camera:null,updated:Date.now(),
    settings:{size:'1206x2622',width:1206,height:2622,turned:false,scale:1,quality:1,framing:'all',format:'png',background:'gradient',
    first:'#232840',second:'#bc8e97',photo:'',clock:false,clockHeight:100,lightName:'studio',light:{...lightPresets.studio}}};
}
export function handoff() {
  try {return JSON.parse(new URLSearchParams(location.hash.slice(1)).get('look'));}
  catch {return null;}
}
export function handoffURL(file,query,data) {
  const url=new URL(file,location.href);
  url.search=new URLSearchParams(query);
  if(data)url.hash=new URLSearchParams({look:JSON.stringify(data)}).toString();
  return url.href;
}
