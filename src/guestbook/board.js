import {mountBoard} from './ui.js?v=39aa3c49452d';
import {makeAvatarPainter} from './avatar.js';
const base=new URL(document.querySelector('meta[name=guestbook-api]').content,document.baseURI);
const memory=new Map();
let store;
try {localStorage.setItem('ink-board-check','1');localStorage.removeItem('ink-board-check');store=localStorage;}
catch {store={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)};}
let token=store.getItem('ink-board-visitor');
if(!/^[0-9a-f]{32}$/.test(token||'')) {
  token=Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
  store.setItem('ink-board-visitor',token);
}
async function api(path,method='GET',data) {
  let res, result;
  try {
    res=await fetch(new URL(path,base),{method,cache:'no-store',headers:{'x-guest-id':token,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
    result=await res.json();
  } catch {throw new Error('暂时连不上留言板，请稍后重试。');}
  if(!res.ok)throw new Error(result?.error||'操作未完成，请重试。');
  return result;
}
const paint=makeAvatarPainter(new URL('./ink-white.webp',import.meta.url),new URL('./ink-black.webp',import.meta.url));
mountBoard(document.getElementById('ink-guestbook'),{api,avatarURL:id=>new URL('avatars/'+id,base).href,paint,store});
