// Small, deterministic text PDF writer. Runs on the existing Node runtime;
// no browser, remote fonts, model calls, HTML execution or external renderer.
const fail=message=>{throw Object.assign(Error(message),{status:415});};
const decoder=new TextDecoder('windows-1252'),encoding=new Map();
for(let n=32;n<256;n++)encoding.set(decoder.decode(Uint8Array.of(n)),n);
const widths=[278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,1015,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,761,556,761,278,556,500,1000,556,556,333,1000,667,333,1000,761,611,761,761,278,278,500,500,350,556,1000,333,1000,556,333,944,761,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556];
const clean=text=>String(text).normalize('NFC').replace(/\r\n?/g,'\n').replace(/\t/g,'    ');
function bytes(text){return Buffer.from([...clean(text)].map(c=>{const n=encoding.get(c),code=c.codePointAt(0);if(n===undefined||code<32||(code>=127&&code<=159))fail('A página contém símbolos que este PDF de texto não suporta. Anexe o PDF original para preservar a apresentação.');return n;}));}
const width=(text,size)=>[...bytes(text)].reduce((sum,n)=>sum+(widths[n-32]||1015),0)*size/1000;
function wrap(text,size,max){
  const lines=[];
  for(const paragraph of clean(text).split('\n')){
    if(!paragraph){lines.push('');continue;}
    let line='';
    for(const word of paragraph.split(/ +/)){
      if(!word)continue;
      if(line&&width(line+' '+word,size)>max){lines.push(line);line='';}
      if(width(word,size)>max){
        for(const c of word){if(line&&width(line+c,size)>max){lines.push(line);line='';}line+=c;}
      }else line+=(line?' ':'')+word;
    }
    if(line)lines.push(line);
  }
  return lines;
}
export function pageTextPDF({title,blocks}){
  // Reject rather than silently replacing a price, name, emoji or formula.
  bytes(title);for(const b of blocks)for(const t of b.cells||[b.text||''])for(const line of clean(t).split('\n'))bytes(line);
  const pages=[];let commands=[],y=0;
  const text=(value,x,top,size=11,bold=false,color='0.13 0.12 0.12')=>commands.push(`BT /${bold?'F2':'F1'} ${size} Tf ${color} rg 1 0 0 1 ${x.toFixed(2)} ${top.toFixed(2)} Tm <${bytes(value).toString('hex')}> Tj ET`);
  const line=(x1,y1,x2,y2)=>commands.push(`0.86 0.83 0.81 RG 0.6 w ${x1} ${y1} m ${x2} ${y2} l S`);
  function next(){
    if(commands.length)pages.push(commands.join('\n'));
    if(pages.length>=30)fail('A página excede o limite de 30 páginas de PDF. Anexe o documento original.');
    commands=[];y=751;
    text('DOMUM',48,801,16,true);text('ENGENHARIA',140,802,8,false,'0.60 0.29 0.13');line(48,781,547,781);
  }
  const space=h=>{if(y-h<64)next();};
  function paragraph(value,size=11,bold=false,indent=0){
    const lines=wrap(value,size,499-indent),height=size*1.4;
    // Keep ordinary paragraphs together; split only a paragraph taller than a page.
    space(lines.length*height+8<=650?lines.length*height+8:3*height);
    for(const value of lines){space(height);text(value,48+indent,y,size,bold);y-=height;}
    y-=8;
  }
  next();paragraph(title,21,true);y-=5;
  for(const b of blocks){
    if(b.type==='divider'){space(18);line(48,y,547,y);y-=18;continue;}
    if(b.type==='table_row'){
      const n=b.cells.length;if(!n||n>8)fail('A tabela precisa de até 8 colunas. Anexe o PDF original para preservar tabelas maiores.');
      const cellWidth=499/n,lines=b.cells.map(c=>wrap(c,10,cellWidth-14)),count=Math.max(...lines.map(c=>c.length),1),h=count*14+14;
      if(h>650)fail('Uma linha da tabela é longa demais para este PDF. Anexe o documento original.');
      space(h);line(48,y+4,547,y+4);
      for(let i=0;i<n;i++)for(let j=0;j<lines[i].length;j++)text(lines[i][j],55+i*cellWidth,y-12-j*14,10,!!b.header);
      y-=h;line(48,y+4,547,y+4);y-=4;continue;
    }
    const heading=/^heading_[123]$/.test(b.type);
    paragraph(b.text,heading?({heading_1:17,heading_2:14,heading_3:12}[b.type]):11,heading,b.indent||0);
  }
  pages.push(commands.join('\n'));
  const objects=[null,'<< /Type /Catalog /Pages 2 0 R >>',null,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
  const kids=[];
  for(let i=0;i<pages.length;i++){
    const pageId=objects.length,streamId=pageId+1;kids.push(pageId+' 0 R');
    const footer=`BT /F1 8 Tf 0.45 0.42 0.40 rg 1 0 0 1 48 33 Tm <${bytes('Domum Engenharia').toString('hex')}> Tj 1 0 0 1 503 33 Tm (${i+1} / ${pages.length}) Tj ET`;
    const stream=pages[i]+'\n'+footer;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamId} 0 R >>`,`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects[2]=`<< /Type /Pages /Count ${pages.length} /Kids [${kids.join(' ')}] >>`;
  let body='%PDF-1.4\n',offsets=[0];
  for(let i=1;i<objects.length;i++){offsets.push(Buffer.byteLength(body));body+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(body);body+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`+offsets.slice(1).map(x=>String(x).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}
