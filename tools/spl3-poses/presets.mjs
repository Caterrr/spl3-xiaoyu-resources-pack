const weapons = {Blst:'爆破枪',Brsh:'笔刷',Chrg:'蓄力狙击枪',Chgr:'蓄力狙击枪',Mnvr:'双枪',Rllr:'滚筒',Sber:'刮水刀',Shlt:'伞',Shtr:'射击枪',Slsh:'泼桶',Spnr:'旋转枪',Strn:'猎鱼弓',SlshBathtub:'浴缸泼桶',SlshDouble:'双重泼桶',SpnrDownpour:'鹦鹉螺',SpnrHyperT:'消防栓旋转枪',SpnrQuickT:'轻量旋转枪',SpnrSerein:'圆珠笔',SpnrStandardT:'桶装旋转枪',SpnrHyperShort:'审查者'};
const actions = {Crouching:'蹲姿',FeelingWarm:'取暖',NwBtl:'占地斗士',Shivering:'发抖',SittingCrossedLegs:'盘腿坐',WaveHands:'挥手',BlowKiss:'飞吻',IkachanDance:'鱿鱼舞',TransformationPose:'变身',BigJump:'大跳',Yancha:'调皮',Idol:'偶像',Wait:'自然站立',Tricol:'三色夺宝',IkaPose:'鱿鱼招牌姿势',Vss:'对战',Talk:'交谈',Stretch:'伸懒腰',Relax:'放松',Greeting:'问候',WaitFreeze:'静候'};
const plaza = {Badguy:'耍酷',Brave:'挺胸',Chair:'坐椅子',Dance:'跳舞',DanceHigh:'热舞',HarleyQuinn:'俏皮站姿',Insert:'待机变化',LeanWall:'倚墙',Wall:'靠墙',LookingAtPhone:'看手机',LookAround:'环顾四周',LookImportant:'神气站姿',LookShop:'看商店',PhoneGame:'玩手机',Pitching:'投球',PlayingCard:'打牌',Pondering:'思考',Rhythm:'打节拍',RunwayModel:'走秀',ScratchFace:'挠脸',ScratchHead:'挠头',SittingDangling:'悬腿坐',SittingGround:'席地坐',SittingGroupTalk:'围坐聊天',SittingStairs:'坐台阶',SittingStairsCorner:'坐台阶转角',SquareGirl:'广场站姿',Surprise:'吃惊',TakingPhoto:'拍照',TalkChair:'坐着交谈',TalkOnPhone:'打电话',TeenageHooligan:'街头站姿',WipingAwayDust:'掸灰',Yawn:'打哈欠',CraneGame:'抓娃娃',IdolFan:'应援',TableBook:'桌前看书',TablePhone:'桌前看手机',CheckChoreography:'练习舞步',DanceVideoShooting:'录制舞蹈',VideoShooting:'录像',WaveATowel:'挥毛巾',Drink:'喝饮料',Flag:'挥旗',HeadJelly:'头顶水母',Mosh:'跟着人群跳',Selfy:'自拍',UpHand:'举手',RidingMikoshi:'祭典花车',Making:'角色造型',Clt:'上衣',Hed:'头饰',Shs:'鞋子',Cstm:'自选',Chrg:'蓄力狙击枪',Glng:'旋转枪',Umbrella:'伞',Change:'换装',Transition:'过渡',St:'起始',Sitting:'坐姿',Waiting:'等候',Train:'列车',Disappear:'离场'};
const groups = {photo:'amiibo 拍照',emote:'表情动作',win:'胜利姿势',weapon:'武器胜利姿势',bump:'碰拳',plaza:'广场日常',fes:'祭典',shop:'试穿与造型',art:'宣传造型',test:'开发测试'};
const oldIds = {amiibo_Pose_Wait:'stand',amiibo_Pose_Crouching00_EdWait:'crouch',amiibo_Pose_FeelingWarm00_EdWait:'warm',amiibo_Pose_Win13_EdWait:'win13',amiibo_Pose_Win15_EdWait:'win15'};
const terms = {...plaza,...weapons,...actions};
function word(s){
  if(terms[s])return terms[s];
  const prefix=Object.keys(terms).sort((a,b)=>b.length-a.length).find(k=>s.startsWith(k));
  return prefix?terms[prefix]+' '+s.slice(prefix.length):s;
}
function nameOf(key){
  if(/^Win\d+$/.test(key))return '胜利姿势 '+key.slice(3);
  if(key.startsWith('Win_'))return key.slice(4).replace(/^Pair00([LR])$/,(_,s)=>'双人胜利 '+(s==='L'?'左':'右')).replace(/^X00([ABCD])$/,'X 比赛 $1').split('_').map(word).join(' ');
  return key.split('_').map(word).join(' ').replace(/^(蹲姿|取暖|发抖|占地斗士|变身|大跳) 00$/,'$1');
}
export function presets(clips) {
  const out=[];
  const add=(group,clip,label,frame,id)=>out.push({id:id||oldIds[clip]||clip+(group==='art'?'@'+frame:''),group:groups[group],clip,label,frame});
  for(const [clip,last] of clips){
    const middle=Math.round(last/2);
    const withHold=clips.has(clip+'_EdWait');
    if(clip.startsWith('amiibo_Pose_'))add('photo',clip,nameOf(clip.slice(12).replace(/_EdWait$/,''))+(withHold?' · 动作中':''),withHold?middle:0);
    else if(clip.startsWith('amiiboPose_')){
      const key=clip.slice(11).replace(/^Standing_/,'站姿_').replace(/^Sitting_/,'坐姿_');
      add('photo',clip,nameOf(key),middle);
    }else if(clip.startsWith('amiibo_')){
      add('photo',clip,nameOf(clip.slice(7)),middle);
    }else if(clip.startsWith('Emote_')){
      const match=clip.match(/_EdWait_FistBump_([LR])$/);
      const key=clip.slice(6).replace(/_(?:EdWait_FistBump_[LR]|EdWait|StWait)$/,'');
      const group=match?'bump':/^Win_(?!Pair|Tricol|X00)/.test(key)?'weapon':key.startsWith('Win')?'win':'emote';
      const suffix=match?(match[1]==='L'?' · 左碰拳':' · 右碰拳'):clip.endsWith('_StWait')?' · 起始':withHold?' · 动作中':'';
      add(group,clip,nameOf(key)+suffix,match?middle:clip.endsWith('Wait')?0:middle);
    }else if(/^Test.*[Pp]ose|^Tstance$/.test(clip)){
      const label=clip==='Tstance'?'T 字站姿':clip.endsWith('Wait')?'待机测试':'amiibo 测试 '+clip.match(/\d+/)[0];
      add('test',clip,label,middle);
    }else if(clip.startsWith('AW_')){
      if(clip.includes('Collection')||clip==='AW_MissionPlayer'){
        const step=clip.includes('Collection')?10:1;
        const series=clip.includes('Brand')?'品牌 '+clip.at(-1):clip.includes('Collection')?'宣传 A':'任务';
        for(let f=0;f<=last;f+=step)add('art',clip,series+' · '+String(1+f/step).padStart(2,'0'),f);
      }else{
        const [,kind,style]=clip.match(/^AW_Pose_(\w+?)Player_(\w+)$/)||[];
        if(!kind)throw Error('Unknown artwork '+clip);
        add('art',clip,word(kind)+' · '+style,0);
      }
    }else if(/^Wait_(Plaza_Fes_|Fes_)|^FesAction_/.test(clip)){
      const key=clip.replace(/^Wait_(Plaza_Fes_|Fes_)/,'').replace(/^FesAction_(\w)_SAND$/,'祭典动作_$1');
      add('fes',clip,nameOf(key),middle);
    }else if(clip.startsWith('Wait_Plaza_'))add('plaza',clip,nameOf(clip.slice(11)),middle);
    else if(/^Shop_|^Wait_Shop(?:_|$)/.test(clip)){
      const key=clip.replace(/^Shop_|^Wait_Shop_?/,'');
      add('shop',clip,(clip.startsWith('Shop_')?'试穿':'店内')+(key?' · '+nameOf(key):''),middle);
    }else if(/^(Demo_(Sitting|Waiting)_Train|(?:Demo_)?Wait_Making\d+(_St)?)$/.test(clip)){
      const key=clip.replace(/^(Demo_)?(Wait_)?/,'');
      add(clip.endsWith('Train')?'plaza':'shop',clip,(clip.startsWith('Demo_Wait_Making')?'过场 · ':'')+nameOf(key),middle);
    }
  }
  const order=Object.values(groups);
  return out.sort((a,b)=>order.indexOf(a.group)-order.indexOf(b.group)||(a.id==='stand'?-1:b.id==='stand'?1:a.label.localeCompare(b.label,'zh-Hans',{numeric:true})));
}
