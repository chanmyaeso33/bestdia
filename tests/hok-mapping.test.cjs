const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync('functions/api/[[path]].js','utf8');
const apiPromise = import('data:text/javascript;base64,'+Buffer.from(source+'\nexport { getMappedStockReleaseId };').toString('base64'));
const ids=['hok-80','hok-240','hok-400','hok-560','hok-2400-108','hok-4000-180','hok-honor-point-pack','hok-premium-purchase-rebate-pack','hok-standard-purchase-rebate-pack','hok-weekly-pass','hok-weekly-pass-plus'];
const map=Object.fromEntries(ids.map((id,i)=>[id,String(100+i)]));
async function call(route,body,env={}) { const api=await apiPromise; const res=await api.onRequest({request:new Request('https://test/api/'+route,{method:'POST',body:JSON.stringify(body)}),env,params:{path:[route]}});return {status:res.status,data:await res.json()}; }
test('removed HOK packages are rejected before persistence for every payment method',async()=>{
 for(const [packageId,pay] of ['hok-16','hok-800-30','hok-1200-45','hok-8000-360'].flatMap(packageId=>[['kbz','KBZPay'],['wave','Wave Money'],['truemoney','TrueMoney'],['balance','BestDia Balance']].map(pay=>[packageId,pay]))) {
 const result=await call('create-order',{order:{gameKey:'hok',pkg:{id:packageId,mxshopStockReleaseId:'999'},userId:'123',contact:'test',payKey:pay[0],payment:pay[1]}});
 assert.equal(result.status,400);
 }
});
test('mapping resolution ignores untrusted IDs and malformed configuration',async()=>{
 const {getMappedStockReleaseId:resolve}=await apiPromise;
 assert.equal(resolve('hok-16',{}, {pkg:{mxshopStockReleaseId:'999'}}),'');
 assert.equal(resolve('hok-80',{}, {pkg:{mxshopStockReleaseId:'999'}}),'16802454');
 assert.equal(resolve('hok-16',{MXSHOP_HOK_STOCK_IDX:'77',MXSHOP_HOK_PACKAGE_MAP:JSON.stringify({'hok-16':'100'})}),'' );
 assert.equal(resolve('hok-unknown',{MXSHOP_HOK_STOCK_IDX:'77',MXSHOP_HOK_PACKAGE_MAP:JSON.stringify({'hok-unknown':'100'})}),'');
 assert.equal(resolve('hok-16',{MXSHOP_HOK_STOCK_IDX:'77',MXSHOP_HOK_PACKAGE_MAP:'invalid'}),'');
});
test('diagnostic requires admin and includes every sellable HOK package',async()=>{
 assert.equal((await call('hok-mapping-diagnostic',{}, {ADMIN_PASSWORD:'test'})).status,401);
 const {data}=await call('hok-mapping-diagnostic',{adminPassword:'test'},{ADMIN_PASSWORD:'test'});
 assert.equal(data.ready,false);assert.equal(data.rows.length,11);assert.ok(data.rows.every(r=>r.status==='unverified'));
});
test('diagnostic verifies supplier membership, availability and duplicate mappings without buying',async()=>{
 const original=global.fetch;
 const live=[['hok-80','16802454','80 Tokens'],['hok-240','16802455','240 Tokens'],['hok-400','16802456','400 Tokens'],['hok-560','16802457','560 Tokens'],['hok-2400-108','16802458','2400+108 Tokens'],['hok-4000-180','16802459','4000+180 Tokens'],['hok-honor-point-pack','16802462','Honor Point Pack'],['hok-premium-purchase-rebate-pack','16802463','Premium Purchase Rebate Pack'],['hok-standard-purchase-rebate-pack','16802464','Standard Purchase Rebate Pack'],['hok-weekly-pass','16802465','Weekly Card'],['hok-weekly-pass-plus','16802466','Weekly Card Plus']];
 let items=live.map(([,variationId,name])=>({stockreleaselist_id:variationId,product_stockname:name,not_available:0}));
 global.fetch=async(url,opts)=>{assert.ok(url.endsWith('/get_stockreleaselist'));assert.equal(JSON.parse(opts.body).StockIDX,'77');return new Response(JSON.stringify({success:true,result:items}));};
 const env={ADMIN_PASSWORD:'test',MXSHOP_MX_KEY:'test',MXSHOP_PASSKEY:'test',MXSHOP_HOK_STOCK_IDX:'77'};
 try {
 assert.equal((await call('hok-mapping-diagnostic',{adminPassword:'test'},env)).data.ready,true);
 items[0].not_available=1;
 assert.equal((await call('hok-mapping-diagnostic',{adminPassword:'test'},env)).data.rows.find(r=>r.packageId==='hok-80').status,'unavailable');
 items=[];
 assert.equal((await call('hok-mapping-diagnostic',{adminPassword:'test'},env)).data.rows.find(r=>r.packageId==='hok-80').status,'missing');
 env.MXSHOP_HOK_PACKAGE_MAP=JSON.stringify({'hok-240':'16802454'});
 items=live.map(([,variationId,name])=>({stockreleaselist_id:variationId,product_stockname:name,not_available:0}));
 assert.equal((await call('hok-mapping-diagnostic',{adminPassword:'test'},env)).data.rows.find(r=>r.packageId==='hok-80').status,'duplicate');
 } finally {global.fetch=original;}
});
test('catalog exposes only mapped HOK packages',async()=>{
 const {data}=await call('catalog',{});
 const hok=data.products.find(product=>product.key==='hok');
 assert.deepEqual(hok.packages.map(pkg=>pkg.id),ids);
 assert.ok(hok.packages.every(pkg=>pkg.checkoutAvailable===true && pkg.mxshopStockId==='1712'));
 assert.deepEqual(Object.fromEntries(hok.packages.map(pkg=>[pkg.id,pkg.priceThb])),{
  'hok-80':33,'hok-240':96,'hok-400':156,'hok-560':218,'hok-2400-108':941,'hok-4000-180':1576,
  'hok-honor-point-pack':13,'hok-premium-purchase-rebate-pack':44,'hok-standard-purchase-rebate-pack':13,
  'hok-weekly-pass':35,'hok-weekly-pass-plus':104,
 });
});
test('catalog exposes the complete mapped Free Fire catalog with margin prices',async()=>{
 const {data}=await call('catalog',{});
 const freeFire=data.products.find(product=>product.key==='free-fire');
 assert.equal(freeFire.packages.length,22);
 assert.equal(new Set(freeFire.packages.map(pkg=>pkg.id)).size,22);
 assert.ok(freeFire.packages.every(pkg=>/^\d+$/.test(pkg.mxshopStockReleaseId) && pkg.mxshopStockId==='15'));
 const byId=Object.fromEntries(freeFire.packages.map(pkg=>[pkg.id,pkg]));
 assert.equal(byId['free-fire-33'].priceThb,10);
 assert.equal(byId['free-fire-weekly-lite'].priceThb,34);
 assert.equal(byId['free-fire-3698'].priceThb,1031);
 assert.equal(byId['free-fire-growth-all'].priceThb,104);
});
test('unknown Free Fire packages are rejected before persistence',async()=>{
 const result=await call('create-order',{order:{gameKey:'free-fire',pkg:{id:'free-fire-unmapped',mxshopStockReleaseId:'999'},userId:'123',contact:'test',payKey:'kbz',payment:'KBZPay'}});
 assert.equal(result.status,400);
});
test('both HTML script blocks parse',()=>{for(const file of ['index.html','admin.html'])for(const match of fs.readFileSync(file,'utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) if(match[1].trim())assert.equal(require('node:child_process').spawnSync(process.execPath,['--input-type=module','--check'],{input:match[1],encoding:'utf8'}).status,0);});
