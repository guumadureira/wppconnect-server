// Ogg/Opus duration is counted from packet TOCs, not untrusted duration metadata.
// RFC 6716 section 3.1; automatic transcription is bounded to five minutes.
export function opusDuration(bytes,maxSeconds=300){
  const b=Buffer.from(bytes);let offset=0,serial=null,sequence=0,packet=[],size=0,count=0,samples=0,eos=false;
  const bad=()=>{throw Object.assign(Error('Áudio Ogg/Opus inválido ou acima de 5 minutos.'),{status:415});};
  while(offset<b.length){
    if(eos||offset+27>b.length||b.toString('ascii',offset,offset+4)!=='OggS'||b[offset+4]!==0)bad();
    const flags=b[offset+5],segments=b[offset+26],stream=b.readUInt32LE(offset+14),seq=b.readUInt32LE(offset+18);
    if(serial===null){serial=stream;if(!(flags&2))bad();}
    if(stream!==serial||seq!==sequence++||!!(flags&1)!==(size>0)||offset+27+segments>b.length)bad();
    let cursor=offset+27+segments;
    for(let i=0;i<segments;i++){
      const len=b[offset+27+i];if(cursor+len>b.length)bad();packet.push(b.subarray(cursor,cursor+len));size+=len;cursor+=len;if(size>65536)bad();
      if(len===255)continue;
      const p=Buffer.concat(packet);packet=[];size=0;
      if(count===0){if(p.length<19||p.toString('ascii',0,8)!=='OpusHead'||p[8]!==1||![1,2].includes(p[9])||p[18]!==0)bad();}
      else if(count===1){if(p.toString('ascii',0,8)!=='OpusTags')bad();}
      else{
        if(!p.length)bad();const config=p[0]>>3,code=p[0]&3,frames=code===0?1:code===3?(p[1]||0)&63:2;
        const ms=config>=16?2.5*2**(config%4):config>=12?10*2**(config%2):[10,20,40,60][config%4];
        if(!frames||ms*frames>120)bad();samples+=ms*frames*48;if(samples>maxSeconds*48000)bad();
      }
      count++;
    }
    eos=!!(flags&4);offset=cursor;
  }
  if(size||!eos||count<3||!samples)bad();return samples/48000;
}
