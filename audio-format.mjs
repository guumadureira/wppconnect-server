// Ogg/Opus duration is counted from packet TOCs, not untrusted duration metadata.
// RFC 6716 section 3.1; automatic transcription is bounded to five minutes.
export function opusDuration(bytes,maxSeconds=300){
  const b=Buffer.from(bytes);let offset=0,serial=null,sequence=null,packet=[],size=0,count=0,samples=0,eos=false;
  const bad=()=>{throw Object.assign(Error('Áudio Ogg/Opus inválido ou acima de 5 minutos.'),{status:415});};
  while(offset<b.length){
    if(eos||offset+27>b.length||b.toString('ascii',offset,offset+4)!=='OggS'||b[offset+4]!==0)bad();
    const flags=b[offset+5],segments=b[offset+26],stream=b.readUInt32LE(offset+14),seq=b.readUInt32LE(offset+18);
    // Some mobile recorders export a complete packet stream with a nonzero
    // first page sequence or without a final EOS page. Neither changes duration.
    if(serial===null){serial=stream;sequence=seq;}
    if(stream!==serial||seq!==sequence||!!(flags&1)!==(size>0)||offset+27+segments>b.length)bad();
    sequence=(seq+1)>>>0;
    let cursor=offset+27+segments;
    for(let i=0;i<segments;i++){
      const len=b[offset+27+i];if(cursor+len>b.length)bad();packet.push(b.subarray(cursor,cursor+len));size+=len;cursor+=len;if(size>65536)bad();
      if(len===255)continue;
      const p=Buffer.concat(packet);packet=[];size=0;
      if(count===0){if(p.length<19||p.toString('ascii',0,8)!=='OpusHead'||p[8]>15||![1,2].includes(p[9])||p[18]!==0)bad();}
      else if(count===1&&p.toString('ascii',0,8)==='OpusTags'){/* Optional metadata; never interpreted as an audio packet. */}
      else{
        if(!p.length){if((flags&4)&&i===segments-1){count++;continue;}bad();}
        const config=p[0]>>3,code=p[0]&3,frames=code===0?1:code===3?(p[1]||0)&63:2;
        const ms=config>=16?2.5*2**(config%4):config>=12?10*2**(config%2):[10,20,40,60][config%4];
        if(!frames||ms*frames>120)bad();samples+=ms*frames*48;if(samples>maxSeconds*48000)bad();
      }
      count++;
    }
    eos=!!(flags&4);offset=cursor;
  }
  if(size||count<2||!samples)bad();return samples/48000;
}

// Playback/storage and transcription have different requirements. Keep a voice
// file even when its packet layout cannot be timed safely for paid transcription.
export function isOggOpus(bytes){
  const b=Buffer.from(bytes);if(b.length<47||b.toString('ascii',0,4)!=='OggS'||b[4]!==0)return false;
  const segments=b[26],start=27+segments;if(!segments||start+19>b.length)return false;
  return b.toString('ascii',start,start+8)==='OpusHead'&&b[start+8]<=15&&[1,2].includes(b[start+9]);
}
