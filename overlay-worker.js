/* Vector overlay runs off the UI thread. No PDF bytes leave this browser. */
importScripts('https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js');
const progress=(stage,percent,done=0,total=0)=>self.postMessage({type:'progress',stage,percent,done,total});
const yieldWorker=()=>new Promise(resolve=>setTimeout(resolve,0));
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

function paintVectorInk(page,mask,color,targetWidth,targetHeight,blendMode='Normal',alignment=null){
  const {PDFName}=PDFLib,context=page.doc.context,scale=Math.min(targetWidth/mask.width,targetHeight/mask.height);
  const sx=alignment?alignment.sx*targetWidth/mask.width:scale,sy=alignment?alignment.sy*targetHeight/mask.height:scale;
  const x=alignment?(alignment.newBox.left-alignment.oldBox.left*alignment.sx)*targetWidth:(targetWidth-mask.width*scale)/2;
  const y=alignment?((1-alignment.newBox.bottom)-(1-alignment.oldBox.bottom)*alignment.sy)*targetHeight:(targetHeight-mask.height*scale)/2;
  const graphicsState=context.register(context.obj({Type:PDFName.of('ExtGState'),SMask:mask.softMask,BM:PDFName.of(blendMode),AIS:false})),key=page.node.newExtGState('InkMask',graphicsState);
  page.pushOperators(PDFLib.pushGraphicsState(),PDFLib.concatTransformationMatrix(sx,0,0,sy,x,y),PDFLib.setGraphicsState(key),PDFLib.setFillingRgbColor(color[0],color[1],color[2]),PDFLib.rectangle(0,0,mask.width,mask.height),PDFLib.fill(),PDFLib.popGraphicsState());
}


self.onmessage=async({data})=>{
 try{
  const {originalBytes,updatedBytes,plan,outline,alignment}=data;
  progress('Parsing original PDF into vector objects',5,0,plan.length);
  let originalPdf=await PDFLib.PDFDocument.load(originalBytes,{ignoreEncryption:true,updateMetadata:false,parseSpeed:PDFLib.ParseSpeeds.Fastest});
  progress('Original PDF parsed; preparing original vector ink',10,0,plan.length);
  const output=await PDFLib.PDFDocument.create(),originalMasks=new Array(plan.length).fill(null);
  for(let index=0;index<plan.length;index++){
   const item=plan[index];
   if(item.original){const stage=await prepareVectorInkStage(originalPdf,item.original.index);originalMasks[index]=await embedVectorInkMask(output,stage)}
   progress(`Extracting original vectors: ${item.label}`,10+30*(index+1)/plan.length,index+1,plan.length);
   await yieldWorker();
  }
  originalPdf=null;
  progress('Parsing updated PDF into vector objects',43,0,plan.length);
  let updatedPdf=await PDFLib.PDFDocument.load(updatedBytes,{ignoreEncryption:true,updateMetadata:false,parseSpeed:PDFLib.ParseSpeeds.Fastest});
  progress('Updated PDF parsed; assembling overlays',48,0,plan.length);
  const labels=[],pageMap=new Map();
  for(let index=0;index<plan.length;index++){
   const item=plan[index],original=originalMasks[index];
   if(!item.updated)throw new Error(`No updated page for ${item.label}`);
   const freshStage=await prepareVectorInkStage(updatedPdf,item.updated.index),fresh=await embedVectorInkMask(output,freshStage);
   const page=output.addPage([fresh.width,fresh.height]);
   page.drawRectangle({x:0,y:0,width:fresh.width,height:fresh.height,color:PDFLib.rgb(1,1,1)});
   if(original)paintVectorInk(page,original,[0,1,0],fresh.width,fresh.height,'Normal',alignment[index]);
   paintVectorInk(page,fresh,[1,0,1],fresh.width,fresh.height,original?'Multiply':'Normal');
   labels.push(item.label);pageMap.set(item.updated.index,index);
   progress(`Assembling overlay: ${item.label}`,48+32*(index+1)/plan.length,index+1,plan.length);
   await yieldWorker();
  }
  updatedPdf=null;
  if(!output.getPageCount())throw new Error('The updated PDF contains no pages.');
  progress('Applying page labels and bookmarks',83,plan.length,plan.length);
  rebuildPageLabels(output,labels);
  let bookmarks=remapOutline(outline,pageMap);
  const bookmarkItems=plan.map((item,index)=>({...item,overlayOutput:index+1}));
  bookmarks=addFallbackBookmarks(bookmarks,bookmarkItems,'overlayOutput');rebuildBookmarks(output,bookmarks);
  output.setProducer('Drawing Overlay Comparison - Vector Overlay');output.setCreator('Drawing Overlay Comparison');
  output.setTitle(`${data.title} - Vector Overlay`);output.setModificationDate(new Date());
  progress('Writing PDF file',88,plan.length,plan.length);
  const bytes=await output.save({useObjectStreams:true,addDefaultPage:false,objectsPerTick:20});
  progress('Download ready',100,plan.length,plan.length);
  self.postMessage({type:'complete',bytes:bytes.buffer,pageCount:output.getPageCount()},[bytes.buffer]);
 }catch(error){self.postMessage({type:'error',message:String(error?.message||error)})}
};
