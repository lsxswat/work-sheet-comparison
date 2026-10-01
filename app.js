/* Drawing Overlay Comparison. PDF bytes are processed entirely in the browser. */
const state={original:null,updated:null,plan:[],mode:'overlay',keepNonMatchingOriginal:true,keepNonMatchingUpdated:true,checkAlignment:false};
const $=selector=>document.querySelector(selector);
const escapeHtml=value=>String(value).replace(/[&<>\"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;"}[char]));
const displayLabel=value=>String(value??'').trim();
const matchKey=value=>displayLabel(value).split(/\s+/,1)[0].replace(/\s+/g,'').toUpperCase();

function toast(message){const element=$('#toast');element.textContent=message;element.classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>element.classList.remove('visible'),3000)}
function countOutline(items){return (items||[]).reduce((count,item)=>count+1+countOutline(item.items),0)}
function formatSize(bytes){return bytes>=1048576?`${Math.round(bytes/1048576)} MB`:`${Math.max(1,Math.round(bytes/1024))} KB`}
function isPdf(file){return file&&(file.type==='application/pdf'||/\.pdf$/i.test(file.name))}
function setCardProgress(kind,title,percent,detail='',indeterminate=false){
  const card=$(`#${kind}-card`),progress=card.querySelector('.card-progress');progress.classList.remove('hidden');
  progress.classList.toggle('indeterminate',indeterminate);
  progress.querySelector('.progress-title').textContent=title;
  progress.querySelector('.progress-count').textContent=indeterminate?'Working':`${Math.round(percent)}%`;
  progress.querySelector('b').style.width=indeterminate?'32%':`${percent}%`;
  const info=progress.querySelector('.load-detail');if(info)info.textContent=detail;
}
function startLiveStatus(update){const started=performance.now();let stage='';const render=()=>update(stage,Math.floor((performance.now()-started)/1000));
  const timer=setInterval(render,1000);return {stage(value){stage=value;render()},stop(){clearInterval(timer)}};
}
function showExportStage(stage,seconds){const live=$('#export-live');if(!live)return;live.classList.remove('hidden');$('#export-live-stage').textContent=stage;$('#export-live-elapsed').textContent=`${seconds}s elapsed`}
function openLocalPdf(objectUrl){return pdfjsLib.getDocument({url:objectUrl,disableRange:true,disableStream:true,disableAutoFetch:true})}

async function parsePdf(file,kind){
  if(!window.pdfjsLib)throw new Error('The PDF reader did not load. Check the connection and reload this page.');
  const live=startLiveStatus((stage,seconds)=>{const detail=$(`#${kind}-card .load-detail`);if(detail)detail.textContent=`${stage} · ${seconds}s elapsed`});
  setCardProgress(kind,'Opening PDF',0,`Opening local file · 0s elapsed`,true);
  live.stage('Opening local file');
  const objectUrl=URL.createObjectURL(file);
  try{
    const task=openLocalPdf(objectUrl);
    task.onProgress=event=>{if(event.total>0){const percent=Math.min(90,Math.round(event.loaded/event.total*90));setCardProgress(kind,'Reading PDF bytes',percent,`Read ${formatSize(event.loaded)} of ${formatSize(event.total)}`);live.stage('Reading PDF bytes')}else live.stage(`Reading PDF bytes (${formatSize(event.loaded)})`)};
    const doc=await task.promise;
    setCardProgress(kind,'Reading page labels',92,'Reading native labels and bookmarks',true);live.stage('Reading native labels and bookmarks');
    const [nativeLabels,nativeOutline]=await Promise.all([doc.getPageLabels(),doc.getOutline()]);
    const labels=nativeLabels||Array.from({length:doc.numPages},(_,index)=>String(index+1));
    const outline=nativeOutline||[];
    const entries=labels.map((label,index)=>({label:displayLabel(label)||String(index+1),key:matchKey(label||String(index+1)),index}));
    setCardProgress(kind,'PDF ready',100,`${doc.numPages} pages · ${countOutline(outline)} bookmarks`);
    return {file,objectUrl,doc,labels,outline,entries,bookmarkCount:countOutline(outline)};
  }catch(error){URL.revokeObjectURL(objectUrl);throw error}finally{live.stop()}
}
async function ensurePdfJsDocument(record){if(record?.doc)return record.doc;if(!record?.objectUrl)record.objectUrl=URL.createObjectURL(record.file);const task=openLocalPdf(record.objectUrl);record.doc=await task.promise;return record.doc}
async function releasePdfJsDocuments(){const releases=[];for(const record of [state.original,state.updated]){if(!record?.doc)continue;const doc=record.doc;record.doc=null;releases.push(doc.destroy().catch(error=>console.warn('Could not release a PDF preview document.',error)))}await Promise.all(releases)}
async function disposePdfRecord(record){if(!record)return;if(record.doc){try{await record.doc.destroy()}catch(error){console.warn('Could not release a PDF preview document.',error)}}if(record.objectUrl)URL.revokeObjectURL(record.objectUrl);record.doc=null;record.objectUrl=null}
async function loadPdfLibDocument(record){const bytes=await record.file.arrayBuffer();return PDFLib.PDFDocument.load(bytes,{ignoreEncryption:true,updateMetadata:false,parseSpeed:PDFLib.ParseSpeeds.Fastest})}

async function upload(file,kind){
  if(!file)return;
  if(!isPdf(file)){toast('Please choose a PDF file.');return}
  const card=$(`#${kind}-card`);
  try{
    const previous=state[kind];state[kind]=null;state.plan=[];$('#review-section').classList.add('hidden');card.classList.remove('loaded');await disposePdfRecord(previous);
    const parsed=await parsePdf(file,kind);state[kind]=parsed;card.classList.add('loaded');
    const meta=card.querySelector('.file-meta');meta.classList.remove('empty');meta.innerHTML=`<strong>${escapeHtml(file.name)}</strong><br>${parsed.entries.length} pages · ${parsed.bookmarkCount} bookmarks · ${formatSize(file.size)}`;
    card.querySelector('.dropzone strong').textContent='Choose a replacement PDF';card.querySelector('.dropzone span').textContent='or drop another file here';
    if(state.original&&state.updated)buildPlan();else toast(`${kind==='original'?'Original set':'Updated sheets'} ready. Upload the other PDF when ready.`);
  }catch(error){console.error(error);const detail=String(error?.message||'This PDF could not be read.').slice(0,180);setCardProgress(kind,'Could not read PDF',0);const meta=card.querySelector('.file-meta');meta.classList.remove('empty');meta.textContent=`Could not read ${file.name}: ${detail}`;toast(`Could not read PDF: ${detail}`)}
}

function buildPlan(){
  const available=new Map();
  for(const entry of state.original.entries){if(!available.has(entry.key))available.set(entry.key,[]);available.get(entry.key).push(entry)}
  
  // Build list of all keys that have matches
  const matchedKeys=new Set();
  for(const updated of state.updated.entries){
    const originals=available.get(updated.key);
    if(originals&&originals.length>0)matchedKeys.add(updated.key);
  }
  
  // Build plan with filtering based on toggles
  state.plan=[];
  
  // Add matching sheets from updated PDF
  const availableCopy=new Map();
  for(const entry of state.original.entries){if(!availableCopy.has(entry.key))availableCopy.set(entry.key,[]);availableCopy.get(entry.key).push(entry)}
  
  for(const updated of state.updated.entries){
    const originals=availableCopy.get(updated.key)||[];
    const original=originals.shift()||null;
    if(original){
      // This is a matched sheet
      state.plan.push({label:updated.label,key:updated.key,updated,original,type:'paired'});
    }else if(state.keepNonMatchingUpdated){
      // This is an inserted sheet and user wants to keep it
      state.plan.push({label:updated.label,key:updated.key,updated,original:null,type:'inserted'});
    }
  }
  
  // Add non-matching sheets from original PDF if user wants to keep them
  if(state.keepNonMatchingOriginal){
    const usedKeys=new Set(state.plan.map(item=>item.key));
    for(const original of state.original.entries){
      if(!usedKeys.has(original.key)){
        state.plan.push({label:original.label,key:original.key,updated:null,original,type:'original-only'});
      }
    }
  }
  
  renderReview();
}

function duplicateKeys(entries){const counts=new Map;for(const entry of entries)counts.set(entry.key,(counts.get(entry.key)||0)+1);return [...counts].filter(([,count])=>count>1).map(([key,count])=>`${key} (${count})`)}

function renderReview(){
  let outputPage=1;
  const rows=state.plan.map(item=>{
    const overlay=state.mode==='overlay',first=outputPage,second=!overlay&&item.type==='paired'?outputPage+1:null;outputPage+=second?2:1;
    item.oldOutput=!overlay&&item.type==='paired'?first:null;item.newOutput=second||first;item.overlayOutput=overlay?first:null;
    const output=second?`<b>${first}</b><i></i><b>${second}</b>`:`<b>${first}</b>`;
    let source,result;
    if(item.type==='paired'){source=`Original p. <strong>${item.original.index+1}</strong> &nbsp;→&nbsp; Updated p. <strong>${item.updated.index+1}</strong>`;result=overlay?'vector':'paired';}
    else if(item.type==='inserted'){source=`Updated p. <strong>${item.updated.index+1}</strong> · no original label match`;result='inserted';}
    else if(item.type==='original-only'){source=`Original p. <strong>${item.original.index+1}</strong> · no updated label match`;result=overlay?'color-modified':'original-only';}
    return `<div class="sheet-row"><span class="output-pages">${output}</span><span class="sheet-label">${escapeHtml(item.label)}</span><span class="source-pages">${source}</span><span class="result ${item.type}">${result}</span></div>`;
  }).join('');
  const paired=state.plan.filter(item=>item.type==='paired').length,inserted=state.plan.filter(item=>item.type==='inserted').length,originalOnly=state.plan.filter(item=>item.type==='original-only').length;
  $('#sheet-list').innerHTML=rows||'<div class="sheet-row">No sheets to compare.</div>';
  $('#summary').innerHTML=`<span class="paired">${paired} paired</span>${inserted?`<span class="inserted">${inserted} inserted</span>`:''}${originalOnly?`<span class="original-only">${originalOnly} original-only</span>`:''}` ;
  $('#review-copy').textContent=`${outputPage-1} ${state.mode==='overlay'?'overlay':'output'} pages, following the updated PDF's sheet order.`;
  const warningParts=[],originalDuplicates=duplicateKeys(state.original.entries),updatedDuplicates=duplicateKeys(state.updated.entries);
  if(originalDuplicates.length)warningParts.push(`Duplicate original labels were matched in page order: ${originalDuplicates.join(', ')}.`);
  if(updatedDuplicates.length)warningParts.push(`Duplicate updated labels were processed in page order: ${updatedDuplicates.join(', ')}.`);
  const warnings=$('#warnings');warnings.classList.toggle('hidden',!warningParts.length);warnings.textContent=warningParts.join(' ');
  $('#review-section').classList.remove('hidden');$('#review-section').scrollIntoView({behavior:'smooth',block:'start'});
}

function setMode(mode){
  state.mode=mode;document.body.classList.toggle('overlay-mode',mode==='overlay');
  document.querySelectorAll('.mode').forEach(button=>button.classList.toggle('active',button.dataset.mode===mode));
  const overlay=mode==='overlay';$('#overlay-settings').classList.toggle('hidden',!overlay);$('.sequence-example')?.classList.toggle('overlay-preview',overlay);
  $('#mode-title').textContent=overlay?'Vector two-color overlay PDF':'Original + Updated pairs';
  $('#mode-description').textContent=overlay?'Original linework in pure green, updated linework in pure magenta, and perfect overlap shown black.':'Two pages per matched sheet for direct page-turn comparison.';
  $('#generate').textContent=overlay?'Generate vector overlay':'Generate paired PDF';$('#export-title').textContent='Ready to build';
  $('#export-status').textContent=overlay?'No rasterization: source PDF vectors remain sharp. Pure green and pure magenta combine to black where they align.':'Both versions receive the same page label. Source bookmarks are retained in separate Original and Updated bookmark groups.';
  $('#export-progress').classList.add('hidden');$('#phase-progress').classList.add('hidden');if(state.plan.length)renderReview();
}

function labelIndex(record){const map=new Map;for(const entry of record.entries)if(!map.has(entry.key))map.set(entry.key,entry.index);return map}
function bookmarkTitleKey(title){const token=displayLabel(title).split(/\s+/,1)[0];return /\d/.test(token)?matchKey(token):''}

async function resolveOutline(items,record){
  const fallback=labelIndex(record);
  return Promise.all((items||[]).map(async item=>{
    let destination=item.dest,pageIndex=null;
    try{if(typeof destination==='string')destination=await record.doc.getDestination(destination);if(Array.isArray(destination))pageIndex=typeof destination[0]==='number'?destination[0]:await record.doc.getPageIndex(destination[0])}catch{}
    if(!Number.isInteger(pageIndex)){const key=bookmarkTitleKey(item.title);if(key&&fallback.has(key))pageIndex=fallback.get(key)}
    return {title:item.title||'Untitled bookmark',pageIndex,items:await resolveOutline(item.items||[],record)};
  }));
}

function remapOutline(nodes,pageMap){
  const output=[];
  for(const node of nodes||[]){const items=remapOutline(node.items,pageMap),outputIndex=pageMap.get(node.pageIndex);if(Number.isInteger(outputIndex)||items.length)output.push({title:node.title,outputIndex:Number.isInteger(outputIndex)?outputIndex:null,items})}
  return output;
}
function collectBookmarkPages(nodes,target=new Set){for(const node of nodes||[]){if(Number.isInteger(node.outputIndex))target.add(node.outputIndex);collectBookmarkPages(node.items,target)}return target}
function addFallbackBookmarks(nodes,items,outputField){const used=collectBookmarkPages(nodes);for(const item of items){const outputIndex=item[outputField]-1;if(!used.has(outputIndex))nodes.push({title:item.label,outputIndex,items:[]})}return nodes}

function rebuildPageLabels(pdf,labels){const {PDFName,PDFNumber,PDFString}=PDFLib,nums=[];labels.forEach((label,index)=>nums.push(PDFNumber.of(index),pdf.context.obj({P:PDFString.of(label)})));pdf.catalog.set(PDFName.of('PageLabels'),pdf.context.obj({Nums:nums}))}
function rebuildBookmarks(pdf,nodes){
  if(!nodes.length)return;
  const {PDFName,PDFNumber,PDFHexString}=PDFLib,context=pdf.context,root=context.obj({Type:PDFName.of('Outlines')}),rootRef=context.register(root);
  function build(list,parentRef){let first=null,last=null,previous=null,count=0;for(const node of list){const dictionary=context.obj({Title:PDFHexString.fromText(node.title),Parent:parentRef}),reference=context.register(dictionary);if(previous){previous.set(PDFName.of('Next'),reference);dictionary.set(PDFName.of('Prev'),last)}if(!first)first=reference;let destination=node.outputIndex;if(!Number.isInteger(destination)){const childDestination=(node.items||[]).find(child=>Number.isInteger(child.outputIndex));destination=childDestination?.outputIndex}if(Number.isInteger(destination)&&destination<pdf.getPageCount())dictionary.set(PDFName.of('Dest'),context.obj([pdf.getPage(destination).ref,PDFName.of('Fit')]));const children=build(node.items||[],reference);if(children.first){dictionary.set(PDFName.of('First'),children.first);dictionary.set(PDFName.of('Last'),children.last);dictionary.set(PDFName.of('Count'),PDFNumber.of(children.count))}last=reference;previous=dictionary;count+=1+children.count}return {first,last,count}}
  const result=build(nodes,rootRef);if(result.first){root.set(PDFName.of('First'),result.first);root.set(PDFName.of('Last'),result.last);root.set(PDFName.of('Count'),PDFNumber.of(result.count));pdf.catalog.set(PDFName.of('Outlines'),rootRef)}
}

function download(name,bytes){const blob=bytes instanceof Blob?bytes:new Blob([bytes],{type:'application/pdf'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}
function outputName(mode=state.mode){const base=state.updated.file.name.replace(/\.pdf$/i,'');return `${base}_${mode==='overlay'?'Vector-Overlay':'Original-New-Pairs'}.pdf`}
function setExportProgress(percent,message){$('#export-progress').classList.remove('hidden');$('#export-progress span').style.width=`${percent}%`;$('#export-status').textContent=message}
function resetDetailedProgress(){const panel=$('#phase-progress');panel.classList.remove('hidden');panel.querySelectorAll('.phase-row').forEach(row=>{row.classList.remove('active','done');row.querySelector('b').style.width='0%';row.querySelector('em').textContent='Waiting'});const sub=$('#sub-progress');if(sub){sub.querySelector('#sub-count').textContent='0 / 0';sub.querySelector('b').style.width='0%';sub.querySelector('#sub-detail').textContent='Ready'}}
function setPhaseProgress(id,percent,status){const row=$(`[data-phase="${id}"]`);if(!row)return;row.classList.toggle('done',percent>=100);row.classList.toggle('active',percent<100&&percent>0);row.querySelector('b').style.width=`${Math.max(0,Math.min(100,percent))}%`;row.querySelector('em').textContent=status}
function setSubProgress(current,total,detail,title='Processing sheets'){const sub=$('#sub-progress');if(!sub)return;const pct=total?Math.round(current/total*100):0;sub.querySelector('#sub-title').textContent=title;sub.querySelector('#sub-count').textContent=`${current} / ${total}`;sub.querySelector('b').style.width=`${pct}%`;sub.querySelector('#sub-detail').textContent=detail}


const pdfByteEncoder=new TextEncoder();
function pdfBytes(value){return pdfByteEncoder.encode(value)}
function pdfObjectChunk(reference,object){const prefix=pdfBytes(`${reference.objectNumber} ${reference.generationNumber} obj\n`),suffix=pdfBytes('\nendobj\n\n'),chunk=new Uint8Array(prefix.length+object.sizeInBytes()+suffix.length);chunk.set(prefix,0);const end=prefix.length+object.copyBytesInto(chunk,prefix.length);chunk.set(suffix,end);return chunk}
async function writePdfAsBlob(pdf){
  await pdf.flush();if(!PDFLib.PDFStreamWriter)return new Blob([await pdf.save({useObjectStreams:true,addDefaultPage:false,objectsPerTick:20})],{type:'application/pdf'});
  const writer=PDFLib.PDFStreamWriter.forContext(pdf.context,100,true,50),layout=await writer.computeBufferSize(),parts=[],batchLimit=8*1024*1024;let pending=[],pendingBytes=0,written=0;
  const flush=async()=>{if(!pendingBytes)return;let chunk;if(pending.length===1)chunk=pending[0];else{chunk=new Uint8Array(pendingBytes);let offset=0;for(const part of pending){chunk.set(part,offset);offset+=part.byteLength}}parts.push(chunk);written+=chunk.byteLength;pending=[];pendingBytes=0;setExportProgress(90+Math.min(9,written/Math.max(1,layout.size)*9),`Writing vector PDF · ${Math.round(written/1048576)} MB of ${Math.round(layout.size/1048576)} MB…`);await new Promise(resolve=>setTimeout(resolve,0))};
  const write=async chunk=>{if(chunk.byteLength>=batchLimit){await flush();parts.push(chunk);written+=chunk.byteLength;return}if(pendingBytes+chunk.byteLength>batchLimit)await flush();pending.push(chunk);pendingBytes+=chunk.byteLength};
  const header=new Uint8Array(layout.header.sizeInBytes()+2);let offset=layout.header.copyBytesInto(header,0);header[offset++]=10;header[offset]=10;await write(header);for(const [reference,object] of layout.indirectObjects)await write(pdfObjectChunk(reference,object));const trailer=new Uint8Array(layout.trailer.sizeInBytes());layout.trailer.copyBytesInto(trailer,0);await write(trailer);await flush();return new Blob(parts,{type:'application/pdf'});
}

async function generatePaired(){
  if(!state.original||!state.updated||!window.PDFLib){toast('Upload both PDFs before generating.');return}
  const button=$('#generate');button.disabled=true;button.textContent='Building paired PDF…';$('#export-title').textContent='Building locally';
  try{
    await Promise.all([ensurePdfJsDocument(state.original),ensurePdfJsDocument(state.updated)]);
    const [originalOutline,updatedOutline]=await Promise.all([resolveOutline(state.original.outline,state.original),resolveOutline(state.updated.outline,state.updated)]);await releasePdfJsDocuments();
    setExportProgress(8,'Preparing both drawing PDFs…');
    const originalPdf=await loadPdfLibDocument(state.original),updatedPdf=await loadPdfLibDocument(state.updated),output=await PDFLib.PDFDocument.create();
    const originalIndices=state.plan.filter(item=>item.original).map(item=>item.original.index),updatedIndices=state.plan.map(item=>item.updated.index);
    setExportProgress(25,'Copying selected original and updated pages…');
    const oldCopies=await output.copyPages(originalPdf,originalIndices),newCopies=await output.copyPages(updatedPdf,updatedIndices);let oldCursor=0;const labels=[],oldMap=new Map,newMap=new Map;
    for(let index=0;index<state.plan.length;index++){
      const item=state.plan[index];
      if(item.original){const page=oldCopies[oldCursor++];oldMap.set(item.original.index,output.getPageCount());output.addPage(page);labels.push(item.label)}
      newMap.set(item.updated.index,output.getPageCount());output.addPage(newCopies[index]);labels.push(item.label);
    }
    if(!output.getPageCount())throw new Error('The updated PDF contains no pages.');
    setExportProgress(55,'Applying duplicate old/new page labels…');rebuildPageLabels(output,labels);
    setExportProgress(68,'Preserving applicable source bookmarks…');
    let oldBookmarks=remapOutline(originalOutline,oldMap),newBookmarks=remapOutline(updatedOutline,newMap);
    oldBookmarks=addFallbackBookmarks(oldBookmarks,state.plan.filter(item=>item.original),'oldOutput');newBookmarks=addFallbackBookmarks(newBookmarks,state.plan,'newOutput');
    rebuildBookmarks(output,[{title:'Original set bookmarks',outputIndex:null,items:oldBookmarks},{title:'Updated selected sheets bookmarks',outputIndex:null,items:newBookmarks}]);
    output.setProducer('Drawing Overlay Comparison');output.setCreator('Drawing Overlay Comparison');output.setTitle(`${state.updated.file.name.replace(/\.pdf$/i,'')} - Original and Updated Pairs`);output.setModificationDate(new Date());
    setExportProgress(82,'Writing the paired drawing PDF…');const bytes=await output.save({useObjectStreams:true,addDefaultPage:false,objectsPerTick:50});
    setExportProgress(100,`Created ${output.getPageCount()} pages with paired labels and preserved bookmarks.`);download(outputName('pairs'),bytes);$('#export-title').textContent='Paired PDF created';button.textContent='Generate Again';toast('Paired drawing PDF downloaded.');
  }catch(error){console.error(error);$('#export-title').textContent='Could not create PDF';$('#export-status').textContent=`Could not create the paired PDF: ${String(error.message||'unknown error').slice(0,180)}`;toast('PDF creation failed. See the message above.')}
  finally{button.disabled=false;if(button.textContent==='Building paired PDF…')button.textContent='Generate paired PDF'}
}

function overlayQuality(){const value=$('#overlay-quality')?.value;if(value==='detailed')return {name:'Detailed',maxDimension:3600,maxScale:1.5,mime:'image/png',quality:1,gpu:true};if(value==='fast')return {name:'Fast',maxDimension:2400,maxScale:1.1,mime:'image/jpeg',quality:.9,gpu:true};return {name:'Turbo',maxDimension:1600,maxScale:.8,mime:'image/jpeg',quality:.82,gpu:true}}
function renderScaleFor(viewport,quality=overlayQuality()){return Math.max(.3,Math.min(quality.maxScale,quality.maxDimension/Math.max(viewport.width,viewport.height)))}
async function renderPage(record,index,target){
  const page=await record.doc.getPage(index+1),base=page.getViewport({scale:1}),scale=target?Math.min(target.width/base.width,target.height/base.height):renderScaleFor(base),viewport=page.getViewport({scale});
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(target?.width||viewport.width));canvas.height=Math.max(1,Math.round(target?.height||viewport.height));const context=canvas.getContext('2d',{willReadFrequently:true});context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
  const renderCanvas=target?document.createElement('canvas'):canvas,renderContext=target?renderCanvas.getContext('2d'):context;
  if(target){renderCanvas.width=Math.max(1,Math.round(viewport.width));renderCanvas.height=Math.max(1,Math.round(viewport.height));renderContext.fillStyle='#fff';renderContext.fillRect(0,0,renderCanvas.width,renderCanvas.height)}
  await page.render({canvasContext:renderContext,viewport,background:'rgb(255,255,255)'}).promise;
  if(target){context.drawImage(renderCanvas,(canvas.width-renderCanvas.width)/2,(canvas.height-renderCanvas.height)/2);renderCanvas.width=renderCanvas.height=1}
  return {canvas,base};
}
function luminance(data,index){return (data[index]*77+data[index+1]*150+data[index+2]*29)>>8}
function composeOverlayGpu(freshCanvas,oldCanvas,threshold){
  const canvas=document.createElement('canvas');canvas.width=freshCanvas.width;canvas.height=freshCanvas.height;const gl=canvas.getContext('webgl',{alpha:false,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});if(!gl)return null;
  const vertexSource='attribute vec2 a;attribute vec2 t;varying vec2 v;void main(){gl_Position=vec4(a,0.0,1.0);v=t;}';
  const fragmentSource='precision mediump float;varying vec2 v;uniform sampler2D oldTex;uniform sampler2D newTex;uniform float limit;uniform vec2 texel;float lum(vec3 c){return dot(c,vec3(.299,.587,.114));}float changed(vec2 p){float a=lum(texture2D(oldTex,p).rgb);float b=lum(texture2D(newTex,p).rgb);return step(limit,abs(a-b))*step(min(a,b),.972);}void main(){float mark=0.0;for(int y=-1;y<=1;y++){for(int x=-1;x<=1;x++){mark=max(mark,changed(v+vec2(float(x),float(y))*texel));}}float a=lum(texture2D(oldTex,v).rgb);float b=lum(texture2D(newTex,v).rgb);float ink=clamp((1.0-min(a,b))*1.25,0.0,1.0);float pattern=fract(sin(dot(floor(gl_FragCoord.xy),vec2(12.9898,78.233)))*43758.5453);float dotInk=step(pattern,ink);vec3 gray=vec3(mix(1.0,.36,dotInk));gl_FragColor=vec4(mix(gray,vec3(.804,.169,.157),mark),1.0);}';
  const compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){gl.deleteShader(shader);return null}return shader},vertex=compile(gl.VERTEX_SHADER,vertexSource),fragment=compile(gl.FRAGMENT_SHADER,fragmentSource);if(!vertex||!fragment)return null;
  const program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))return null;gl.useProgram(program);
  const buffer=(name,values)=>{const location=gl.getAttribLocation(program,name),handle=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,handle);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values),gl.STATIC_DRAW);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,2,gl.FLOAT,false,0,0);return handle},position=buffer('a',[-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),texcoords=buffer('t',[0,0,1,0,0,1,0,1,1,0,1,1]);
  const white=document.createElement('canvas');white.width=white.height=1;const whiteContext=white.getContext('2d');whiteContext.fillStyle='#fff';whiteContext.fillRect(0,0,1,1);const texture=(unit,source,name)=>{const handle=gl.createTexture();gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,handle);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);gl.uniform1i(gl.getUniformLocation(program,name),unit);return handle},oldTexture=texture(0,oldCanvas||white,'oldTex'),newTexture=texture(1,freshCanvas,'newTex');
  gl.uniform1f(gl.getUniformLocation(program,'limit'),threshold/255);gl.uniform2f(gl.getUniformLocation(program,'texel'),1/canvas.width,1/canvas.height);gl.viewport(0,0,canvas.width,canvas.height);gl.drawArrays(gl.TRIANGLES,0,6);gl.finish();gl.deleteTexture(oldTexture);gl.deleteTexture(newTexture);gl.deleteBuffer(position);gl.deleteBuffer(texcoords);gl.deleteProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);return canvas;
}
async function buildOverlayImage(item){
  const quality=overlayQuality(),updatedPage=await state.updated.doc.getPage(item.updated.index+1),base=updatedPage.getViewport({scale:1}),scale=renderScaleFor(base,quality),target={width:Math.round(base.width*scale),height:Math.round(base.height*scale)},[fresh,old]=await Promise.all([renderPage(state.updated,item.updated.index,target),item.original?renderPage(state.original,item.original.index,target):Promise.resolve(null)]);
  const width=fresh.canvas.width,height=fresh.canvas.height,threshold=Number($('#difference-threshold').value||40);let composed=null;try{if(quality.gpu)composed=composeOverlayGpu(fresh.canvas,old?.canvas||null,threshold)}catch(error){console.warn('GPU overlay unavailable; using the compatibility renderer.',error)}
  if(!composed){const context=fresh.canvas.getContext('2d'),newData=context.getImageData(0,0,width,height),oldData=old?old.canvas.getContext('2d').getImageData(0,0,width,height):null,output=context.createImageData(width,height),pixels=width*height,mask=new Uint8Array(pixels),wide=new Uint8Array(pixels),tone=new Uint8Array(pixels),bayer=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];for(let pixel=0,index=0;pixel<pixels;pixel++,index+=4){const before=oldData?luminance(oldData.data,index):255,after=luminance(newData.data,index),combined=Math.min(before,after);tone[pixel]=combined;mask[pixel]=Math.abs(before-after)>=threshold&&combined<248?1:0}for(let y=0;y<height;y++){const start=y*width,end=start+width;for(let pixel=start;pixel<end;pixel++)wide[pixel]=mask[pixel]||(pixel>start&&mask[pixel-1])||(pixel+1<end&&mask[pixel+1])?1:0}for(let y=0,pixel=0,index=0;y<height;y++)for(let x=0;x<width;x++,pixel++,index+=4){const changed=wide[pixel]||(y>0&&wide[pixel-width])||(y+1<height&&wide[pixel+width]);if(changed){output.data[index]=205;output.data[index+1]=43;output.data[index+2]=40}else{const ink=255-tone[pixel],dot=ink*1.25>((bayer[(y&3)*4+(x&3)]+.5)/16)*255,value=dot?92:255;output.data[index]=output.data[index+1]=output.data[index+2]=value}output.data[index+3]=255}context.putImageData(output,0,0);composed=fresh.canvas}
  const blob=await new Promise((resolve,reject)=>composed.toBlob(value=>value?resolve(value):reject(new Error('Could not encode overlay page.')),quality.mime,quality.quality));if(old)old.canvas.width=old.canvas.height=1;fresh.canvas.width=fresh.canvas.height=1;if(composed!==fresh.canvas)composed.width=composed.height=1;return {bytes:await blob.arrayBuffer(),width:base.width,height:base.height,mime:quality.mime};
}

function normalizedRotation(page){return ((Math.round(Number(page.getRotation().angle||0)/90)*90)%360+360)%360}
function visiblePageBox(page){const crop=page.getCropBox(),media=page.getMediaBox(),box=crop&&Number.isFinite(crop.x)&&Number.isFinite(crop.y)&&crop.width>0&&crop.height>0?crop:media;return {left:box.x,bottom:box.y,right:box.x+box.width,top:box.y+box.height}}
function visualVectorSize(embedded,rotation){return rotation%180?{width:embedded.height,height:embedded.width}:{width:embedded.width,height:embedded.height}}
function drawVectorInVisualOrientation(page,embedded,rotation){const width=embedded.width,height=embedded.height;if(rotation===90)page.drawPage(embedded,{x:0,y:width,width,height,rotate:PDFLib.degrees(-90)});else if(rotation===180)page.drawPage(embedded,{x:width,y:height,width,height,rotate:PDFLib.degrees(-180)});else if(rotation===270)page.drawPage(embedded,{x:height,y:0,width,height,rotate:PDFLib.degrees(-270)});else page.drawPage(embedded,{x:0,y:0,width,height})}
async function prepareVectorInkStage(sourcePdf,pageIndex){
  const stage=await PDFLib.PDFDocument.create(),source=sourcePdf.getPage(pageIndex),sourcePage=await stage.embedPage(source,visiblePageBox(source)),rotation=normalizedRotation(source),visualSize=visualVectorSize(sourcePage,rotation),stagePage=stage.addPage([visualSize.width,visualSize.height]);
  stagePage.drawRectangle({x:0,y:0,width:visualSize.width,height:visualSize.height,color:PDFLib.rgb(1,1,1)});drawVectorInVisualOrientation(stagePage,sourcePage,rotation);stagePage.drawRectangle({x:0,y:0,width:visualSize.width,height:visualSize.height,color:PDFLib.rgb(1,1,1),blendMode:PDFLib.BlendMode.Difference});await stage.flush();if(Array.isArray(stage.embeddedPages))stage.embeddedPages.length=0;
  return stagePage;
}
async function embedVectorInkMask(output,stagePage){
  const embedded=await output.embedPage(stagePage);await output.flush();
  const {PDFName}=PDFLib,context=output.context,form=context.lookup(embedded.ref);if(!form?.dict)throw new Error('Could not create a vector ink mask for this sheet.');
  form.dict.set(PDFName.of('Group'),context.obj({Type:PDFName.of('Group'),S:PDFName.of('Transparency'),CS:PDFName.of('DeviceRGB'),I:true,K:false}));
  const softMask=context.obj({Type:PDFName.of('Mask'),S:PDFName.of('Luminosity'),G:embedded.ref,BC:[0,0,0]});
  const result={width:embedded.width,height:embedded.height,softMask};if(Array.isArray(output.embeddedPages))output.embeddedPages.length=0;return result;
}
// Preserve v10's broad five-pixel border detection and confidence gate.
// Refine only inside the detected rule using its grayscale center of mass.
async function detectDrawingFrame(record,index){
  await ensurePdfJsDocument(record);
  const pdfPage=await record.doc.getPage(index+1),base=pdfPage.getViewport({scale:1});
  const viewport=pdfPage.getViewport({scale:2400/Math.max(base.width,base.height)});
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  try{
    await pdfPage.render({canvasContext:ctx,viewport,background:'rgb(255,255,255)'}).promise;
    const {width:w,height:h}=canvas,data=ctx.getImageData(0,0,w,h).data;
    const dark=(x,y)=>{const i=(y*w+x)*4;return (data[i]*77+data[i+1]*150+data[i+2]*29)<(205*256)};
    const strength=(x,y)=>{const i=(y*w+x)*4;return Math.max(0,255-(data[i]*77+data[i+1]*150+data[i+2]*29)/256)};
    const score=(axis,pos)=>{let hit=0,total=0;
      if(axis==='x'){for(let y=Math.round(h*.07);y<h*.93;y+=4){total++;for(let k=-2;k<=2;k++)if(dark(pos+k,y)){hit++;break}}}
      else{for(let x=Math.round(w*.08);x<w*.86;x+=4){total++;for(let k=-2;k<=2;k++)if(dark(x,pos+k)){hit++;break}}}
      return hit/Math.max(1,total)};
    const pick=(axis,lo,hi)=>{const size=axis==='x'?w:h;let best={pos:0,score:0};
      for(let v=Math.max(4,Math.floor(size*lo));v<Math.min(size-4,Math.ceil(size*hi));v++){
        const value=score(axis,v);if(value>best.score)best={pos:v,score:value};}
      if(best.score<.55)return null;
      // The v10 peak can sit up to two pixels from the actual line center.
      // Find the strongest continuous rule near it, then use its subpixel centroid.
      let candidate=best.pos,peak=-1;
      for(let v=best.pos-3;v<=best.pos+3;v++){
        let sum=0,count=0;
        if(axis==='x')for(let y=Math.round(h*.07);y<h*.93;y+=4){sum+=strength(v,y);count++}
        else for(let x=Math.round(w*.08);x<w*.86;x+=4){sum+=strength(x,v);count++}
        if(sum/count>peak){peak=sum/count;candidate=v}
      }
      let mass=0,weighted=0;
      for(let v=candidate-2;v<=candidate+2;v++){
        let sum=0,count=0;
        if(axis==='x')for(let y=Math.round(h*.07);y<h*.93;y+=4){sum+=strength(v,y);count++}
        else for(let x=Math.round(w*.08);x<w*.86;x+=4){sum+=strength(x,v);count++}
        const weight=Math.max(0,sum/count-30);mass+=weight;weighted+=v*weight;
      }
      return (mass?weighted/mass:candidate)/size;
    };
    const left=pick('x',.008,.045),right=pick('x',.885,.94),top=pick('y',.005,.045),bottom=pick('y',.955,.995);
    if([left,right,top,bottom].some(value=>value===null))return null;
    return {left,right,top,bottom};
  }finally{canvas.width=canvas.height=1}
}
async function sheetAlignment(item){
  if(!state.checkAlignment||!item.original)return null;
  const [oldBox,newBox]=await Promise.all([detectDrawingFrame(state.original,item.original.index),detectDrawingFrame(state.updated,item.updated.index)]);
  if(!oldBox||!newBox)return null;
  const sx=(newBox.right-newBox.left)/(oldBox.right-oldBox.left),sy=(newBox.bottom-newBox.top)/(oldBox.bottom-oldBox.top);
  if(![sx,sy].every(v=>Number.isFinite(v)&&v>.97&&v<1.03))return null;
  return {oldBox,newBox,sx,sy};
}
function paintVectorInk(page,mask,color,targetWidth,targetHeight,blendMode='Normal',alignment=null){
  const {PDFName}=PDFLib,context=page.doc.context,scale=Math.min(targetWidth/mask.width,targetHeight/mask.height);
  const sx=alignment?alignment.sx*targetWidth/mask.width:scale,sy=alignment?alignment.sy*targetHeight/mask.height:scale;
  const x=alignment?(alignment.newBox.left-alignment.oldBox.left*alignment.sx)*targetWidth:(targetWidth-mask.width*scale)/2;
  const y=alignment?((1-alignment.newBox.bottom)-(1-alignment.oldBox.bottom)*alignment.sy)*targetHeight:(targetHeight-mask.height*scale)/2;
  const graphicsState=context.register(context.obj({Type:PDFName.of('ExtGState'),SMask:mask.softMask,BM:PDFName.of(blendMode),AIS:false})),key=page.node.newExtGState('InkMask',graphicsState);
  page.pushOperators(PDFLib.pushGraphicsState(),PDFLib.concatTransformationMatrix(sx,0,0,sy,x,y),PDFLib.setGraphicsState(key),PDFLib.setFillingRgbColor(color[0],color[1],color[2]),PDFLib.rectangle(0,0,mask.width,mask.height),PDFLib.fill(),PDFLib.popGraphicsState());
}

async function generateOverlay(){
  if(!state.original||!state.updated||!window.PDFLib){toast('Upload both PDFs before generating.');return}
  if(!state.plan.length){toast('No sheets selected for the overlay.');return}
  const button=$('#generate');button.disabled=true;button.textContent='Building vector overlay…';$('#export-title').textContent='Building vector overlays';
  resetDetailedProgress();setExportProgress(1,'Preparing drawing sources…');$('#master-sheet').textContent='Current operation: Preparing drawing sources';
  const exportLive=startLiveStatus(showExportStage);exportLive.stage('Preparing drawing sources');$('#export-progress').classList.add('working');
  let worker=null,workerUrl=null;
  try{
    const alignmentResults={};let aligned=0,skipped=0;
    if(state.checkAlignment){
      await Promise.all([ensurePdfJsDocument(state.original),ensurePdfJsDocument(state.updated)]);
      for(let i=0;i<state.plan.length;i++){
        const item=state.plan[i];if(!item.original)continue;
        exportLive.stage(`Checking drawing frame ${i+1}/${state.plan.length}: ${item.label}`);
        setPhaseProgress('sources',Math.round(30*(i+1)/state.plan.length),`Checking frame ${i+1}/${state.plan.length}`);
        const transform=await sheetAlignment(item);alignmentResults[i]=transform;
        if(transform)aligned++;else skipped++;
        await new Promise(resolve=>setTimeout(resolve,0));
      }
    }
    exportLive.stage('Reading updated bookmarks');setPhaseProgress('sources',35,'Reading bookmarks');
    await ensurePdfJsDocument(state.updated);
    const outline=await resolveOutline(state.updated.outline,state.updated);
    await releasePdfJsDocuments();
    exportLive.stage('Reading source PDF bytes');setPhaseProgress('sources',45,'Reading PDF bytes');
    const [originalBytes,updatedBytes]=await Promise.all([state.original.file.arrayBuffer(),state.updated.file.arrayBuffer()]);
    const plan=state.plan.map(item=>({label:item.label,original:item.original?{index:item.original.index}:null,updated:item.updated?{index:item.updated.index}:null}));
    const workerSource=$('#overlay-worker-source')?.textContent;if(!workerSource)throw new Error('Overlay worker source is missing.');
    workerUrl=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));
    worker=new Worker(workerUrl);
    const result=await new Promise((resolve,reject)=>{
      worker.onmessage=({data})=>{
        if(data.type==='error'){reject(new Error(data.message));return}
        if(data.type==='complete'){resolve(data);return}
        if(data.type!=='progress')return;
        const currentSheet=data.done>0&&data.done<=plan.length?plan[data.done-1]:null;
        const sheetNumber=currentSheet?String(currentSheet.label).trim().split(/\s+/)[0]:'';
        const isOriginal=data.percent>=10&&data.percent<43;
        const isAssembly=data.percent>=48&&data.percent<83;
        const shortStage=isOriginal?'Extracting original vectors':isAssembly?'Assembling overlay pages':data.stage;
        exportLive.stage(shortStage);setExportProgress(data.percent,shortStage);
        $('#master-sheet').textContent=currentSheet&&(isOriginal||isAssembly)?`Current sheet: ${currentSheet.label}`:`Current operation: ${shortStage}`;
        if(data.percent<10){
          setPhaseProgress('sources',data.percent>=5?45:25,data.percent>=5?'Parsing original PDF':'Reading source bytes');
        }else if(data.percent<43){
          setPhaseProgress('sources',65,'Original PDF loaded');
          setPhaseProgress('masks',Math.round((data.percent-10)/30*50),sheetNumber?`Mask ${sheetNumber}`:'Preparing original vectors');
        }else if(data.percent<48){
          setPhaseProgress('sources',data.percent>=48?100:85,data.percent>=48?'Both PDFs loaded':'Parsing updated PDF');
          setPhaseProgress('masks',50,'Original vectors ready');
        }else if(data.percent<83){
          setPhaseProgress('sources',100,'Both PDFs loaded');
          setPhaseProgress('masks',Math.min(100,50+Math.round((data.percent-48)/32*50)),sheetNumber?`Mask ${sheetNumber}`:'Building updated masks');
          setPhaseProgress('pages',Math.min(100,Math.round((data.percent-48)/32*100)),sheetNumber?`Page ${sheetNumber}`:'Assembling pages');
        }else{
          setPhaseProgress('sources',100,'Both PDFs loaded');setPhaseProgress('masks',100,'Masks ready');
          setPhaseProgress('pages',100,'Pages assembled');
          setPhaseProgress('write',Math.min(100,Math.round((data.percent-83)/17*100)),data.percent>=100?'Download ready':'Writing PDF');
        }
        if(data.total)setSubProgress(data.done,data.total,`${isOriginal?'Original vectors':isAssembly?'Overlay pages':'Processing'}: ${data.done} / ${data.total}`,isOriginal?'Extracting original vectors':isAssembly?'Assembling overlays':'Processing sheets');
      };
      worker.onerror=event=>reject(new Error(event.message||'Overlay worker failed'));
      worker.onmessageerror=()=>reject(new Error('Could not receive the completed PDF from the worker'));
      worker.postMessage({originalBytes,updatedBytes,plan,outline,alignment:alignmentResults,title:state.updated.file.name.replace(/\.pdf$/i,'')},[originalBytes,updatedBytes]);
    });
    setPhaseProgress('write',100,'Download ready');setExportProgress(100,`Created ${result.pageCount} vector overlay pages.${state.checkAlignment?` Alignment: ${aligned} applied, ${skipped} skipped.`:''}`);
    download(outputName('overlay'),result.bytes);$('#export-title').textContent='Vector overlay created';button.textContent='Generate Again';toast('Vector overlay PDF downloaded.');
  }catch(error){console.error(error);$('#export-title').textContent='Could not create overlay';$('#export-status').textContent=`Could not create the vector overlay PDF: ${String(error.message||'unknown error').slice(0,180)}`;toast('Vector overlay creation failed. See the message above.')}
  finally{worker?.terminate();if(workerUrl)URL.revokeObjectURL(workerUrl);$('#export-progress').classList.remove('working');exportLive.stop();$('#export-live')?.classList.add('hidden');button.disabled=false;if(button.textContent==='Building vector overlay…')button.textContent='Generate vector overlay'}
}
async function generate(){return state.mode==='overlay'?generateOverlay():generatePaired()}

document.addEventListener('DOMContentLoaded',()=>{
  pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  document.querySelectorAll('.upload-card').forEach(card=>{const kind=card.dataset.kind,input=card.querySelector('.file-input'),dropzone=card.querySelector('.dropzone');dropzone.addEventListener('click',()=>input.click());input.addEventListener('change',()=>upload(input.files?.[0],kind));for(const eventName of ['dragenter','dragover'])card.addEventListener(eventName,event=>{event.preventDefault();card.classList.add('drag')});for(const eventName of ['dragleave','drop'])card.addEventListener(eventName,event=>{event.preventDefault();card.classList.remove('drag')});card.addEventListener('drop',event=>upload(event.dataTransfer?.files?.[0],kind))});
  document.querySelectorAll('.mode').forEach(button=>button.addEventListener('click',()=>setMode(button.dataset.mode)));
  setMode('overlay');
  $('#check-alignment').addEventListener('click',event=>{state.checkAlignment=!state.checkAlignment;const button=event.currentTarget;button.classList.toggle('active',state.checkAlignment);button.setAttribute('aria-pressed',String(state.checkAlignment));button.setAttribute('aria-label',`Check Alignment: ${state.checkAlignment?'On':'Off'}`);});
  $('#generate').addEventListener('click',generate);
  $('#keep-original').addEventListener('change',event=>{state.keepNonMatchingOriginal=event.target.checked;if(state.original&&state.updated)buildPlan();});
  $('#keep-updated').addEventListener('change',event=>{state.keepNonMatchingUpdated=event.target.checked;if(state.original&&state.updated)buildPlan();});
});
window.addEventListener('beforeunload',()=>{for(const record of [state.original,state.updated])if(record?.objectUrl)URL.revokeObjectURL(record.objectUrl)});
