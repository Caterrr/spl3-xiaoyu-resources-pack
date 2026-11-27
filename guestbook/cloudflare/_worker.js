const site='https://caterrr.github.io';
const prefix='/api/guestbook/';
const schema=[
  'CREATE TABLE IF NOT EXISTS avatars(id TEXT PRIMARY KEY,png BLOB NOT NULL)',
  'CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY,thread INTEGER REFERENCES messages(id),parent INTEGER REFERENCES messages(id),author TEXT NOT NULL,avatar TEXT NOT NULL REFERENCES avatars(id),body TEXT NOT NULL,created INTEGER NOT NULL,viewer TEXT NOT NULL,ticket TEXT NOT NULL,UNIQUE(viewer,ticket))',
  'CREATE TABLE IF NOT EXISTS guestbook_pins(rank INTEGER PRIMARY KEY AUTOINCREMENT,message INTEGER NOT NULL UNIQUE REFERENCES messages(id))',
  "CREATE TRIGGER IF NOT EXISTS guestbook_remove_pin AFTER UPDATE OF avatar ON messages WHEN NEW.avatar='removed' BEGIN DELETE FROM guestbook_pins WHERE message=NEW.id; END",
  'CREATE TABLE IF NOT EXISTS moderators(viewer TEXT PRIMARY KEY)',
  'CREATE INDEX IF NOT EXISTS guestbook_avatar_refs ON messages(avatar)',
  'CREATE INDEX IF NOT EXISTS message_thread ON messages(thread,id)',
  'CREATE TABLE IF NOT EXISTS likes(message INTEGER NOT NULL REFERENCES messages(id),viewer TEXT NOT NULL,PRIMARY KEY(message,viewer))',
  'CREATE TABLE IF NOT EXISTS quota(bucket INTEGER NOT NULL,source TEXT NOT NULL,n INTEGER NOT NULL,PRIMARY KEY(bucket,source))'
];
const removed='removed';
const permission='(m.viewer=?1 OR EXISTS(SELECT 1 FROM moderators WHERE viewer=?1))';
const liveReplies="SELECT count(*) FROM messages r WHERE r.thread=m.id AND r.avatar!='removed'";
const select="SELECT m.id,m.thread,m.parent,m.author,m.avatar,m.body,m.created,NULLIF(p.author,'') AS target,"+
  "COALESCE(pin.rank,0) AS pinOrder,(m.thread IS NULL AND m.avatar!='removed' AND EXISTS(SELECT 1 FROM moderators WHERE viewer=?1)) AS canPin,"+
  "(m.avatar='removed') AS deleted,(m.avatar!='removed' AND "+permission+") AS canDelete,"+
  '(SELECT count(*) FROM likes WHERE message=m.id) AS likes,EXISTS(SELECT 1 FROM likes WHERE message=m.id AND viewer=?1) AS liked,'+
  '('+liveReplies+') AS replies FROM messages m LEFT JOIN messages p ON p.id=m.parent LEFT JOIN guestbook_pins pin ON pin.message=m.id ';

function feedQuery(url,viewer){
  const thread=id(url.searchParams.get('thread'),true);
  const cursor=url.searchParams.get('cursor');
  if(thread){
    return {thread,sql:select+"WHERE m.thread=?2 AND m.id>?3 AND m.avatar!='removed' ORDER BY m.id LIMIT 21",args:[viewer,thread,id(cursor,true)||0]};
  }
  let rank=Number.MAX_SAFE_INTEGER, message=Number.MAX_SAFE_INTEGER;
  if(cursor!==null){
    const parts=cursor.split(':');
    if(parts.length>2 || parts.some(part=>!/^\d+$/.test(part)))fail(400,'分页位置无效。');
    message=id(parts.at(-1));
    rank=parts.length===2?id(parts[0]):0;
  }
  const sql=select+'WHERE '+visibleThread+' AND (COALESCE(pin.rank,0),m.id)<(?2,?3) ORDER BY pin.rank DESC,m.id DESC LIMIT 21';
  return {thread,sql,args:[viewer,rank,message]};
}
function feedPage(rows,thread){
  const items=rows.slice(0,20), last=items.at(-1);
  const next=rows.length>20?(!thread && last.pinOrder?last.pinOrder+':'+last.id:last.id):null;
  return {items,next};
}
const moderatorCheck='EXISTS(SELECT 1 FROM moderators WHERE viewer=?1)';
const availableMessage="EXISTS(SELECT 1 FROM messages WHERE id=?2 AND thread IS NULL AND avatar!='removed')";
function pinStatements(db,viewer,message,pinned){
  const allowed=moderatorCheck+' AND '+availableMessage;
  const write=pinned?'INSERT OR IGNORE INTO guestbook_pins(message) SELECT ?2 WHERE '+allowed:
    'DELETE FROM guestbook_pins WHERE message=?2 AND '+allowed;
  const read='SELECT '+moderatorCheck+' AS allowed,'+availableMessage+' AS available,COALESCE((SELECT rank FROM guestbook_pins WHERE message=?2),0) AS pinOrder';
  return [write,read].map(sql=>db.prepare(sql).bind(viewer,message));
}
function pinReceipt(row){
  if(!row.allowed)fail(403,'只有网站作者可以置顶留言。');
  if(!row.available)fail(404,'这条主留言已不存在。');
  return json({pinOrder:row.pinOrder});
}

const visibleThread="m.thread IS NULL AND (m.avatar!='removed' OR EXISTS(SELECT 1 FROM messages r WHERE r.thread=m.id AND r.avatar!='removed'))";
const token=/^[0-9a-f]{32}$/;
const dbReady=new WeakMap();
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function ready(db) {
  if(!db)fail(503,'留言服务正在连接数据库。');
  if(!dbReady.has(db))dbReady.set(db,db.batch(schema.map(sql=>db.prepare(sql))).catch(e=>{dbReady.delete(db);throw e;}));
  await dbReady.get(db);
}
function fail(status,message){throw Object.assign(new Error(message),{status});}
function word(value,max,message){
  if(typeof value!=='string'||!value.trim()||value.trim().length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))fail(400,message);
  return value.trim();
}
function id(value,optional=false){
  if(value==null && optional)return null;
  const n=Number(value);if(!Number.isSafeInteger(n)||n<1)fail(400,'留言编号无效。');return n;
}
async function digest(bytes){
  if(typeof bytes==='string')bytes=new TextEncoder().encode(bytes);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}
function avatarPng(value){
  if(typeof value!=='string'||value.length>110000||!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value))fail(400,'请重新选择头像。');
  let bytes;
  try{bytes=Uint8Array.from(atob(value.slice(22)),c=>c.charCodeAt(0));}catch{fail(400,'头像格式无效。');}
  const u=new DataView(bytes.buffer);
  if(bytes.length<45||u.getUint32(0)!==0x89504e47||u.getUint32(4)!==0x0d0a1a0a||u.getUint32(8)!==13||u.getUint32(12)!==0x49484452||
    u.getUint32(16)!==128||u.getUint32(20)!==128||u.getUint32(bytes.length-12)!==0||u.getUint32(bytes.length-8)!==0x49454e44||u.getUint32(bytes.length-4)!==0xae426082)fail(400,'请选择 128 像素的留言头像。');
  return bytes;
}
async function payload(req){
  if(!req.headers.get('Content-Type')?.startsWith('application/json'))fail(415,'请求格式无效。');
  const reader=req.body?.getReader();if(!reader)fail(400,'请求内容为空。');
  const decoder=new TextDecoder();let count=0,raw='';
  try{while(true){const {done,value}=await reader.read();if(done)break;count+=value.byteLength;if(count>118000){await reader.cancel();fail(413,'内容过大。');}raw+=decoder.decode(value,{stream:true});}
    const obj=JSON.parse(raw+decoder.decode());if(!obj||typeof obj!=='object')fail(400,'请求格式无效。');return obj;
  }catch(e){if(e.status)throw e;fail(400,'请求格式无效。');}
}
async function limit(req,db,group,max,viewer){
  const bucket=Math.floor(Date.now()/300000);
  const source=await digest([bucket,group,req.headers.get('CF-Connecting-IP')||viewer].join('|'));
  const [,record]=await db.batch([
    db.prepare('DELETE FROM quota WHERE bucket < ?').bind(bucket-1),
    db.prepare('INSERT INTO quota VALUES(?,?,1) ON CONFLICT(bucket,source) DO UPDATE SET n=n+1 WHERE n < ? RETURNING n').bind(bucket,source,max)
  ]);
  if(!record.results.length)fail(429,'操作太频繁，请稍后再试。');
}
async function dispatch(req,env,url){
  if(!url.pathname.startsWith(prefix))return env.ASSETS ? env.ASSETS.fetch(req) : json({error:'找不到这个页面。'},404);
  const path=url.pathname.slice(prefix.length),db=env.DB;
  await ready(db);
  if(req.method==='GET'&&path==='health'){
    await db.prepare('SELECT id FROM messages LIMIT 1').first();return json({ready:true,moderation:1,pinning:1});
  }
  const photo=/^avatars\/([0-9a-f]{64})$/.exec(path);
  if(req.method==='GET'&&photo){
    const rec=await db.prepare('SELECT png FROM avatars WHERE id=?').bind(photo[1]).first();
    if(!rec)fail(404,'找不到头像。');
    return new Response(new Uint8Array(rec.png),{headers:{'Content-Type':'image/png','X-Content-Type-Options':'nosniff','Cache-Control':'public,max-age=31536000,immutable'}});
  }
  const who=req.headers.get('x-guest-id')||'';
  if(!token.test(who))fail(400,'无法识别访客，请刷新页面。');
  const viewer=await digest(who);
  // Only the authenticated D1 dashboard can enroll an author's browser.
  if(req.method==='GET' && path==='device'){
    const admin=await db.prepare('SELECT 1 AS yes FROM moderators WHERE viewer=?').bind(viewer).first();
    return json({fingerprint:viewer,moderator:!!admin});
  }
  const deletion=/^messages\/(\d+)$/.exec(path);
  if(req.method==='DELETE' && deletion){
    const message=id(deletion[1]);
    const row=await db.prepare('SELECT m.avatar,'+permission+' AS allowed FROM messages m WHERE m.id=?2').bind(viewer,message).first();
    if(!row)fail(404,'这条留言已不存在。');
    if(!row.allowed)fail(403,'你没有删除这条留言的权限。');
    if(row.avatar===removed)return json({deleted:true});
    await limit(req,db,'delete',100,viewer);
    const allowed='(viewer=? OR EXISTS(SELECT 1 FROM moderators WHERE viewer=?))';
    const [,update]=await db.batch([
      db.prepare("INSERT OR IGNORE INTO avatars(id,png) VALUES('removed',X'')"),
      db.prepare("UPDATE messages SET author='',body='',avatar='removed' WHERE id=? AND avatar!='removed' AND "+allowed+" RETURNING id").bind(message,viewer,viewer),
      db.prepare("DELETE FROM likes WHERE message=? AND EXISTS(SELECT 1 FROM messages WHERE id=? AND avatar='removed')").bind(message,message),
      db.prepare('DELETE FROM avatars WHERE id=? AND NOT EXISTS(SELECT 1 FROM messages WHERE avatar=?)').bind(row.avatar,row.avatar)
    ]);
    if(!update.results.length){
      const current=await db.prepare('SELECT avatar FROM messages WHERE id=?').bind(message).first();
      if(current?.avatar!==removed)fail(403,'删除权限已变更，请刷新。');
    }
    return json({deleted:true});
  }
  if(req.method==='GET' && path==='messages'){
    const {sql,args,thread}=feedQuery(url,viewer);
    const {results}=await db.prepare(sql).bind(...args).all();
    return json(feedPage(results,thread));
  }
  if(req.method==='POST'&&path==='messages'){
    const data=await payload(req);
    const author=word(data.author,24,'请输入 1–24 个字符的昵称。'),body=word(data.body,500,'留言长度为 1–500 个字符。');
    const parent=id(data.parent,true);if(!token.test(data.ticket||''))fail(400,'发送标记无效。');
    const bytes=avatarPng(data.avatar),avatar=await digest(bytes);
    const lookup=db.prepare('SELECT id,thread,parent,author,body,avatar FROM messages WHERE viewer=? AND ticket=?').bind(viewer,data.ticket);
    const receipt=(row,status)=>{if(!row||row.parent!==parent||row.author!==author||row.body!==body||row.avatar!==avatar)fail(409,'同一次发送的内容已更改。');return json({id:row.id,thread:row.thread},status);};
    const old=await lookup.first();if(old)return receipt(old,200);
    const target=parent&&await db.prepare("SELECT COALESCE(thread,id) AS thread FROM messages WHERE id=? AND avatar!='removed'").bind(parent).first();
    if(parent&&!target)fail(404,'原留言已不存在。');
    await limit(req,db,'post',20,viewer);
    const liveParent="(? IS NULL OR EXISTS(SELECT 1 FROM messages WHERE id=? AND avatar!='removed'))";
    const [,insert,read]=await db.batch([
      db.prepare('INSERT OR IGNORE INTO avatars(id,png) SELECT ?,? WHERE '+liveParent).bind(avatar,bytes.buffer,parent,parent),
      db.prepare('INSERT OR IGNORE INTO messages(thread,parent,author,avatar,body,created,viewer,ticket) SELECT ?,?,?,?,?,?,?,? WHERE '+liveParent)
        .bind(target?.thread??null,parent,author,avatar,body,Date.now(),viewer,data.ticket,parent,parent),lookup]);
    if(!read.results.length)fail(404,'原留言已删除。');
    return receipt(read.results[0],insert.meta.changes?201:200);
  }
  const pin=/^messages\/(\d+)\/pin$/.exec(path);
  if(req.method==='PUT' && pin){
    const message=id(pin[1]),data=await payload(req);
    if(typeof data.pinned!=='boolean')fail(400,'置顶状态无效。');
    const [,read]=await db.batch(pinStatements(db,viewer,message,data.pinned));
    return pinReceipt(read.results[0]);
  }
  const like=/^messages\/(\d+)\/like$/.exec(path);
  if(req.method==='PUT'&&like){
    const n=id(like[1]),data=await payload(req);if(typeof data.liked!=='boolean')fail(400,'点赞状态无效。');
    await limit(req,db,'like',100,viewer);
    const change=data.liked
      ? db.prepare("INSERT OR IGNORE INTO likes(message,viewer) SELECT id,? FROM messages WHERE id=? AND avatar!='removed'").bind(viewer,n)
      : db.prepare('DELETE FROM likes WHERE message=? AND viewer=?').bind(n,viewer);
    const [,read]=await db.batch([change,db.prepare("SELECT (SELECT count(*) FROM likes WHERE message=?1) AS likes,EXISTS(SELECT 1 FROM likes WHERE message=?1 AND viewer=?2) AS liked FROM messages WHERE id=?1 AND avatar!='removed'").bind(n,viewer)]);
    if(!read.results.length)fail(404,'原留言已删除。');
    return json({likes:read.results[0].likes,liked:!!read.results[0].liked});
  }
  fail(404,'找不到这个操作。');
}
export default {async fetch(req,env){
  const url=new URL(req.url),origin=req.headers.get('Origin');
  if(origin && origin!==site && origin!==url.origin)return json({error:'请从留言板页面操作。'},403);
  let res;
  try{res=req.method==='OPTIONS'?new Response(null,{status:204}):await dispatch(req,env,url);}
  catch(e){if(!e.status)console.error('guestbook: '+e.name);res=json({error:e.status?e.message:'留言服务暂时不可用。'},e.status||503);}
  if(origin && url.pathname.startsWith(prefix)){res.headers.set('Access-Control-Allow-Origin',origin);res.headers.set('Vary','Origin');res.headers.set('Access-Control-Allow-Methods','GET, POST, PUT, DELETE, OPTIONS');res.headers.set('Access-Control-Allow-Headers','Content-Type, X-Guest-Id');res.headers.set('Access-Control-Max-Age','86400');}
  return res;
}};
