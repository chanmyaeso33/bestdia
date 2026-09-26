const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('functions/api/[[path]].js','utf8');
const apiPromise=import('data:text/javascript;base64,'+Buffer.from(source+'\nexport { PRODUCTS, buildMxUid, getMappedStockReleaseId, performMxshopTopup, productsWithSupplierPrices };').toString('base64'));
async function orderResult(order){const api=await apiPromise;return api.onRequest({request:new Request('https://test/api/create-order',{method:'POST',body:JSON.stringify({order:{contact:'test',payKey:'kbz',payment:'KBZPay',...order}})}),env:{},params:{path:['create-order']}});}

test('new catalogs have complete supplier mappings and markup prices',async()=>{
 const {PRODUCTS}=await apiPromise;
 for(const [key,count,stock] of [['magic-chess-go-go',11,'91'],['genshin-impact',14,'89']]){
  const p=PRODUCTS[key];assert.equal(p.packages.length,count);assert.equal(new Set(p.packages.map(x=>x.mxshopStockReleaseId)).size,count);assert.ok(p.packages.every(x=>x.mxshopStockId===stock&&x.price>0&&x.priceThb>0));
 }
 assert.equal(PRODUCTS['genshin-impact'].packages.find(p=>p.mxshopStockReleaseId==='51103').price,5000);
 assert.equal(PRODUCTS['magic-chess-go-go'].packages.find(p=>p.mxshopStockReleaseId==='16800919').priceThb,50);
 assert.equal(PRODUCTS['call-of-duty'],undefined);
});

test('missing and unsupported server selections are rejected before persistence',async()=>{
 for(const zoneId of ['', 'America', 'Asia/Europe'])assert.equal((await orderResult({gameKey:'genshin-impact',userId:'812345678',zoneId,pkg:{id:'genshin-impact-51103'}})).status,400);
 for(const [userId,zoneId] of [['2605021',''],['2605021','bad'],['2605021(2011)','2011']])assert.equal((await orderResult({gameKey:'magic-chess-go-go',userId,zoneId,pkg:{id:'magic-chess-go-go-16800919'}})).status,400);
 for(const key of ['genshin-impact','magic-chess-go-go'])assert.equal((await orderResult({gameKey:key,userId:'812345678',zoneId:'Asia',pkg:{id:key+'-unknown',mxshopStockReleaseId:'999'}})).status,400);
});

test('cart items are validated against the trusted catalog before persistence',async()=>{
 const response=await orderResult({gameKey:'free-fire',pkg:{id:'free-fire-68'},items:[{id:'free-fire-68',quantity:2},{id:'free-fire-unmapped',quantity:1}],userId:'123456789',payment:'KBZPay',payKey:'kbz'});
 assert.equal(response.status,400);
 assert.match((await response.json()).error,/Invalid package selection/);
});

test('new game supplier mappings ignore caller supplied IDs and preserve required UID formats',async()=>{
 const {buildMxUid,getMappedStockReleaseId}=await apiPromise;
 assert.equal(buildMxUid({gameKey:'genshin-impact',userId:'812345678',zoneId:'Asia'},{}),'812345678/Asia');
 assert.equal(buildMxUid({gameKey:'genshin-impact',userId:'812345678',zoneId:'Europe'},{}),'');
 assert.equal(buildMxUid({gameKey:'magic-chess-go-go',userId:'2605021',zoneId:'2011'},{}),'2605021(2011)');
 assert.equal(getMappedStockReleaseId('genshin-impact-51103',{}, {gameKey:'genshin-impact',pkg:{mxshopStockReleaseId:'999'}}),'51103');
 assert.equal(getMappedStockReleaseId('magic-chess-go-go-unknown',{}, {gameKey:'magic-chess-go-go',pkg:{mxshopStockReleaseId:'999'}}),'');
});

test('fulfillment sends the trusted package ID and supplier-specific server format',async()=>{
 const {performMxshopTopup}=await apiPromise;const original=global.fetch,calls=[];
 global.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return new Response(JSON.stringify({success:true,result:{transaction_id:'test'}}));};
 try{const env={MXSHOP_AUTO_TOPUP_ENABLED:'true',MXSHOP_MX_KEY:'test',MXSHOP_PASSKEY:'test'};
 await performMxshopTopup(env,{gameKey:'genshin-impact',userId:'812345678',zoneId:'Asia',pkg:{id:'genshin-impact-51103',mxshopStockReleaseId:'999'}});
 await performMxshopTopup(env,{gameKey:'magic-chess-go-go',userId:'2605021',zoneId:'2011',pkg:{id:'magic-chess-go-go-16802105',mxshopStockReleaseId:'999'}});
 assert.deepEqual(calls.map(c=>c.body),[{stockreleaselist_id:'51103',uid:'812345678/Asia'},{stockreleaselist_id:'16802105',uid:'2605021(2011)'}]);assert.ok(calls.every(c=>c.url.endsWith('/api/v1/buy')));
 }finally{global.fetch=original;}
});

test('supplier refresh includes both catalogs and updates prices',async()=>{
 const {productsWithSupplierPrices}=await apiPromise;const original=global.fetch,stocks=[];
 global.fetch=async(url,options)=>{assert.ok(url.endsWith('/get_stockreleaselist'));const stock=JSON.parse(options.body).StockIDX;stocks.push(stock);return new Response(JSON.stringify({success:true,result:stock==='89'?[{stockreleaselist_id:'51103',price:30}]:stock==='91'?[{stockreleaselist_id:'16800919',price:40}]:[]}));};
 try{const {products,supplierUpdated}=await productsWithSupplierPrices({MXSHOP_MX_KEY:'test',MXSHOP_PASSKEY:'test'});assert.ok(stocks.includes('89')&&stocks.includes('91'));assert.ok(supplierUpdated);assert.equal(products['genshin-impact'].packages.find(p=>p.id==='genshin-impact-51103').priceThb,32);assert.equal(products['magic-chess-go-go'].packages[0].priceThb,42);}finally{global.fetch=original;}
});
