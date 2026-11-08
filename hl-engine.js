/* 百日战纪 script protocol v1.1 (tolerant). No DOM/eval; usable in browser and Node tests.
   v1.1: 分隔符 | 与 [] 双轨、缺 <content>/<hl_meta> 兜底、资源键模糊匹配、meta 跨楼层继承。 */
(function(root){
'use strict';
const NAMES=['澄野拓海','厄师寺猛丸','雫原比留子','饴宫怠美','苍月卫人','川奈翼','丸子乐','九十九今马','九十九过子','银崎晶马','雾藤希','大铃木梦罗','凶鸟狂死香','面影歪','丧白萌子','依娃','SIREI','NIGOU','汐音','过子G'];

function normKey(value){
  return String(value==null?'':value).replace(/[\s_·・|｜\-—–:：、,，.。'"]|/g,'').toLowerCase();
}
function pick(map,key){
  if(!key||!map)return '';
  if(Object.prototype.hasOwnProperty.call(map,key)&&map[key])return map[key];
  const n=normKey(key);
  if(!n)return '';
  for(const k of Object.keys(map)){if(normKey(k)===n&&map[k])return map[k];}
  const hits=Object.keys(map).filter(k=>{const nk=normKey(k);return nk&&map[k]&&(nk.indexOf(n)>-1||n.indexOf(nk)>-1);});
  if(hits.length===1)return map[hits[0]];
  return '';
}
function tokenize(rest){
  const s=String(rest==null?'':rest).trim();
  if(!s)return [];
  if(s.charAt(0)==='|')return s.slice(1).split('|').map(x=>x.trim()).filter(x=>x!=='');
  const out=[];const re=/\[([^\]]*)(?:\]|$)/g;let m;
  while((m=re.exec(s)))out.push(m[1].trim());
  if(!out.length)out.push(s.replace(/^[|\s]+/,'').replace(/[|\s]+$/,'').trim());
  return out.filter(x=>x!=='');
}
function readCommand(line){
  if(line.slice(0,2)!=='::')return null;
  const inner=line.replace(/^::\s*/,'').replace(/\s*:+$/,'');
  const m=inner.match(/^([^|\[\]]+)([\s\S]*)$/);
  if(!m)return null;
  return {cmd:m[1].replace(/::/g,'').trim(),args:tokenize(m[2])};
}
function readLine(line){
  if(line.charAt(0)!=='[')return null;
  const m=line.match(/^\[([^\]]+)\]([\s\S]*)$/);
  if(!m)return null;
  let head=m[1],tail=m[2]||'';
  const parts=head.split('|');
  const name=parts[0].trim();
  let expr=parts.length>1?parts[1].trim():'';
  const m2=tail.match(/^\s*\[([^\]]+)\]\s*([\s\S]*)$/);
  if(m2&&!expr){expr=m2[1].trim();tail=m2[2]||'';}
  tail=tail.replace(/^\s*\|/,'').trim();
  if(!tail)return null;
  return {name:name,expr:expr,text:tail};
}

function parse(raw,assets,playerName,fallbackMeta){
  assets=assets||{};
  const warnings=[],events=[];
  const text=String(raw==null?'':raw);
  const block=text.match(/<content>([\s\S]*?)<\/content>/i);
  const mm=text.match(/<hl_meta>([\s\S]*?)<\/hl_meta>/i);

  const base={schema:1,opening:1,route:'',day:0,phase:'',location:'',bgm:'',battle:'非战斗',known:[],dead:[],player:''};
  const meta=Object.assign({},base,fallbackMeta&&typeof fallbackMeta==='object'?fallbackMeta:{});
  if(meta.schema!==1)meta.schema=1;

  let fromMeta=false;
  if(mm){
    try{
      const input=JSON.parse(mm[1]);
      if(input&&typeof input==='object'&&!Array.isArray(input)){
        for(const k of Object.keys(base))if(Object.prototype.hasOwnProperty.call(input,k))meta[k]=input[k];
        fromMeta=true;
      }else warnings.push('元数据不是对象');
    }catch(e){warnings.push('元数据JSON无法解析，沿用上一轮');}
  }else warnings.push('缺少hl_meta，已沿用上一轮状态');

  let body;
  if(block)body=block[1];
  else{
    body=text.replace(/<hl_meta>[\s\S]*?<\/hl_meta>/gi,'').replace(/<\/?content>/gi,'');
    warnings.push('缺少content标签，已按全文解析');
  }

  if(![1,2,3,4].includes(meta.opening)){if(!fallbackMeta)warnings.push('开局编号无效');meta.opening=1;}
  if(!Number.isInteger(meta.day)||meta.day<0||meta.day>100){if(!fallbackMeta)warnings.push('天数无效');meta.day=fallbackMeta&&Number.isInteger(fallbackMeta.day)?fallbackMeta.day:0;}
  for(const key of ['route','phase','location','bgm','battle'])if(typeof meta[key]!=='string')meta[key]='';
  for(const key of ['known','dead'])if(!Array.isArray(meta[key]))meta[key]=[];
  if(typeof meta.player!=='string'||meta.opening!==2)meta.player='';
  const effectivePlayer=playerName||meta.player;
  const validName=name=>NAMES.indexOf(name)>-1||(meta.opening===2&&effectivePlayer&&name===effectivePlayer);

  const ids=new Set();let choiceReached=false;let inferredLocation='';
  function image(name,expr){
    const table=pick(assets.CHAR_SPRITES||{},name);
    if(!table||typeof table!=='object'){warnings.push('立绘表未映射：'+name);return '';}
    const src=pick(table,expr||'通常')||pick(table,'通常');
    if(!src)warnings.push('立绘键未映射：'+name+'/'+expr);
    return src||'';
  }

  for(const rawLine of body.split(/\r?\n/)){
    const line=rawLine.replace(/^\s*[-*·]\s+/,'').trim();
    if(!line)continue;
    let m;

    const cmd=readCommand(line);
    if(cmd){
      const a=cmd.args;
      if(cmd.cmd==='选项'){
        if(a.length<2){warnings.push('选项参数不足：'+line.slice(0,40));continue;}
        const id=a[0],txt=a.slice(1).join('｜');
        if(ids.has(id)){warnings.push('重复选项ID：'+id);continue;}
        ids.add(id);events.push({type:'choice',id:id,text:txt});choiceReached=true;continue;
      }
      if(cmd.cmd==='地点'){
        if(!a[0]){warnings.push('地点缺参数：'+line.slice(0,40));continue;}
        const src=pick(assets.BG_MAP||{},a[0]);
        if(!src)warnings.push('背景键未映射：'+a[0]);
        if(!inferredLocation)inferredLocation=a[0];
        events.push({type:'location',key:a[0],src:src});continue;
      }
      if(cmd.cmd==='出场'){
        if(!a[0]){warnings.push('出场缺参数：'+line.slice(0,40));continue;}
        if(!validName(a[0])){warnings.push('未知或禁用角色：'+a[0]);continue;}
        const expr=a[1]||'通常';
        let pos=a[2]||'中';
        if(['左','中','右'].indexOf(pos)<0)pos='中';
        events.push({type:'enter',name:a[0],expression:expr,position:pos,src:image(a[0],expr)});continue;
      }
      if(cmd.cmd==='离场'){
        if(a[0]&&validName(a[0]))events.push({type:'exit',name:a[0]});
        else warnings.push('未知离场角色：'+a[0]);
        continue;
      }
      warnings.push('未知指令：'+cmd.cmd);
      continue;
    }

    if(choiceReached){warnings.push('忽略选项后的剧情：'+line.slice(0,32));continue;}

    const ml=readLine(line);
    if(ml){
      if(ml.name!=='旁白'&&!validName(ml.name)){warnings.push('未知或禁用角色：'+ml.name);continue;}
      events.push({type:'line',name:ml.name,text:ml.text,expression:ml.expr||'',src:ml.name==='旁白'?'':image(ml.name,ml.expr||'通常')});
      continue;
    }
    warnings.push('未识别脚本行：'+line.slice(0,60));
  }

  if(!fromMeta&&!meta.location&&inferredLocation)meta.location=inferredLocation;
  return {meta:meta,events:events,warnings:warnings,degraded:!block||!mm};
}

function safeAsset(path){
  return typeof path==='string'&&!/^(?:[a-z]+:|\/\/|\/)|(?:^|\/)\.\.(?:\/|$)|[\\%?#\x00-\x1f]/i.test(path)&&/\.(?:png|webp|jpg|jpeg|ogg|mp3|wav)$/i.test(path);
}
const api={NAMES:NAMES,parse:parse,safeAsset:safeAsset,normKey:normKey};
root.HLEngine=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
