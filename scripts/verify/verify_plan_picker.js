// verify_plan_picker.js
// ---------------------------------------------------------------------------
// Regression test for the Pick Plan Names dialog. Drives insurance_hub.html
// headlessly and asserts every eligibility rule, the sum-insured guard, the
// plan filter, the per-row overrides and the live status pills.
//
// Needs jsdom, which is test-only and not a project dependency:
//
//     npm install --no-save jsdom
//     node verify_plan_picker.js
//     npm prune
//
// Exits 1 if any assertion fails. No network: the Care catalogue and the
// feature table are served from disk, and the four calculator iframes are
// stubbed, so nothing reaches a live insurer.
// ---------------------------------------------------------------------------
const fs=require('fs');const {JSDOM}=require('jsdom');
const ROOT=__dirname + '/../../';
const cat=JSON.parse(fs.readFileSync(ROOT+'data/care_plans.json','utf8'));
const feat=JSON.parse(fs.readFileSync(ROOT+'data/feature_comparison.json','utf8'));

// Niva's /api/products/<category> response, shaped exactly as the live API
// returns it: products carry their variant tier inside planSubCategory.
function nvProd(value, label, productType, variants, siOpts){
  const sub = [
    { name:'InsuredAdultMember', options:[{value:'1'},{value:'2'}], AdultMinAge:18, AdultMaxAge:99 },
    { name:(productType==='Floater'?'floatercover':'individualCover'),
      options:(siOpts || ['500000','1000000','1500000','2000000']) },
  ];
  if (variants) sub.push({ name:'plantype', options:variants });
  return { value:String(value), label, productType, planSubCategory:sub };
}
const ASPIRE_TIERS = [{value:'1',label:'Gold+'},{value:'2',label:'Diamond+'},
                      {value:'3',label:'Platinum+'},{value:'4',label:'Titanium+'}];
const RA3_TIERS    = [{value:'1',label:'Classic'},{value:'2',label:'Select'},
                      {value:'3',label:'Elite'},{value:'4',label:'Black'}];
const nivaProducts = {
  Individual: [
    nvProd(57,'Aspire Individual','Individual',ASPIRE_TIERS),
    nvProd(54,'ReAssure2.0 Individual','Individual',null),
    nvProd(63,'ReAssure3.0 Individual','Individual',RA3_TIERS),
    nvProd(13,'GoActive Individual','Individual',null),
  ],
  Floater: [
    nvProd(58,'Aspire Family Floater','Floater',ASPIRE_TIERS),
    nvProd(64,'ReAssure3.0 Family Floater','Floater',RA3_TIERS),
  ],
  SeniorCitizen:   [ nvProd(45,'Senior First Individual','Individual',null) ],
  TopUp:           [ nvProd(31,'HealthRechargeV2 Individual','Individual',null) ],
  FamilyFirst:     [ nvProd(49,'HC Health Insurance Plan Family First','Floater',null) ],
  PersonalAccident:[ nvProd(21,'Personal Accident Personal Accident','Individual',null) ],
};

// ManipalCigna's /api/plans response, read straight out of mc_server.js's
// PLAN_CONFIG so this fixture cannot drift from the server it stands in for.
const mcPlans = (function(){
  const s = fs.readFileSync(ROOT+'server/mc_server.js','utf8');
  const i = s.indexOf('const PLAN_CONFIG = {');
  const cfg = new Function('return ' + s.slice(s.indexOf('{', i), s.indexOf('\n};', i) + 2))();
  return { plans: Object.entries(cfg).map(([id,c]) => ({ id, name:c.name,
             siOptions:c.siOptions, minSI:c.minSI, maxSI:c.maxSI,
             minAge:c.minAge, maxChildAge:c.maxChildAge })) };
})();

// Top-level `const`/`let` in a classic script live in the global lexical
// environment, not on `window`, so state has to be reached through w.eval.
// Function declarations are on `window` and can be called directly.

const dom=new JSDOM(fs.readFileSync(ROOT+'public/hub/insurance_hub.html','utf8'),{
  runScripts:'dangerously', url:'http://localhost:3005/hub', pretendToBeVisual:true,
  beforeParse(w){
    w.ExcelJS=require('exceljs');
    w.fetch=(u)=>{const s=String(u);
      if(s.includes('feature_comparison.json')) return Promise.resolve({ok:true,json:()=>Promise.resolve(feat)});
      // 3003 first: '/api/plans' also contains '/plans', so the Care branch
      // below would otherwise answer ManipalCigna's request with Care's
      // catalogue — which is exactly how the MC ladder went untested.
      if(s.includes(':3003/api/plans')) return Promise.resolve({ok:true,json:()=>Promise.resolve(mcPlans)});
      const nv = s.match(/:3002\/api\/products\/([A-Za-z]+)/);
      if(nv) return nivaProducts[nv[1]]
        ? Promise.resolve({ok:true,json:()=>Promise.resolve({products:nivaProducts[nv[1]]})})
        : Promise.reject(new Error('no such category'));
      if(s.includes('/plans')) return Promise.resolve({ok:true,json:()=>Promise.resolve(cat)});
      return Promise.reject(new Error('offline'));};
  }
});
const w=dom.window;
const G   = e => w.eval(e);                 // read a lexical binding
const RUN = e => w.eval(e);                 // mutate one
let sent;                                   // filled from w.__sent

let pass=0, fail=0;
function ok(name, cond, extra){
  if(cond){ pass++; console.log('  PASS  '+name); }
  else    { fail++; console.log('  FAIL  '+name+(extra!==undefined?('\n          '+JSON.stringify(extra)):'')); }
}
function warnsOf(key){ return w.planWarnings(key, G('_planSel')[key]); }
function warnTexts(key){ return warnsOf(key).map(x=>x.level+': '+x.text.replace(/<[^>]+>/g,'')); }
function has(key, level, re){ return warnsOf(key).some(x=>x.level===level && re.test(x.text)); }
function nMembers(){ return G('members.length'); }
function clearMembers(){
  while(nMembers()) w.removeMember(G('members[members.length-1].id'));
}
function setMembers(list){
  clearMembers();                     // the hub seeds one empty member row
  list.forEach((m)=>{
    w.addMember();
    const id=G('members[members.length-1].id');
    w.memberField(id,'name',m.name); w.memberField(id,'relation',m.rel||'Self');
    w.memberField(id,'gender',m.g||'Male'); w.memberField(id,'pin',m.pin||'700019');
    if(m.age!=null) w.memberField(id,'age',String(m.age));
  });
}

setTimeout(async ()=>{
 try{
  // stub the four iframes so pselSend has somewhere to post
  w.__sent = [];
  sent = w.__sent;
  RUN(`Object.entries(CALC_IFRAME).forEach(function(e){
        var k=e[0], el=document.querySelector(e[1]);
        if(!el){ console.log('  (no iframe for '+k+')'); return; }
        Object.defineProperty(el,'contentWindow',{configurable:true,
          value:{ postMessage:function(m){ window.__sent.push({k:k,msg:m}); } }});
      });`);

  console.log('\n── catalogue ──');
  ok('CARE_PLAN_META populated from /plans', G('Object.keys(CARE_PLAN_META).length')===48,
     G('Object.keys(CARE_PLAN_META).length'));
  ok('meta keeps the rich fields', G("!!CARE_PLAN_META['2813'].ageRange && !!CARE_PLAN_META['2813'].memberOptions"));

  console.log('\n── age range parsing (four portal spellings) ──');
  ok('"18 – 99"',                  JSON.stringify(w.parseAgeRange('18 – 99'))==='{"min":18,"max":99}');
  ok('"61 – 99"',                  JSON.stringify(w.parseAgeRange('61 – 99'))==='{"min":61,"max":99}');
  ok('"12 - 40 – 12 - 40"',        JSON.stringify(w.parseAgeRange('12 - 40 – 12 - 40'))==='{"min":12,"max":40}');
  ok('"12 - 17 Year – 46 - 55 Year"', JSON.stringify(w.parseAgeRange('12 - 17 Year – 46 - 55 Year'))==='{"min":12,"max":55}');
  ok('empty / missing',            w.parseAgeRange('')===null && w.parseAgeRange(null)===null);

  console.log('\n── guard: no members, no band ──');
  clearMembers();
  ok('no members blocks', w.pselProblems().some(p=>/no members/.test(p)), w.pselProblems());

  setMembers([{name:'Vivek',age:54},{name:'Pratibha',age:52,rel:'Spouse',g:'Female'}]);
  ok('members added clears that problem', !w.pselProblems().some(p=>/no members/.test(p)), w.pselProblems());

  // empty the SI set to prove the guard the hub never had
  const keep=G('Array.from(selectedSIs)'); RUN('selectedSIs.clear()');
  ok('no sum-insured band blocks', w.pselProblems().some(p=>/sum-insured/.test(p)), w.pselProblems());
  w.openPlanSelect();
  ok('  → Fill All disabled',  w.document.getElementById('psel-btn-fill').disabled===true);
  ok('  → summary says why',   /no sum-insured band/.test(w.document.getElementById('psel-summary').textContent));
  const before=sent.length; w.planSelectFillAll(true);
  ok('  → Fill All sends nothing', sent.length===before, sent.length-before);
  keep.forEach(k=>RUN("selectedSIs.add('"+k+"')"));
  ok('band restored clears it', w.pselProblems().length===0, w.pselProblems());

  console.log('\n── ManipalCigna: unconfigured plans are blocked ──');
  RUN("_planSel.mc='critical-illness'"); RUN("_po.mc.plan='critical-illness'");
  ok('Critical Illness blocked',      has('mc','block',/No product code/));
  ok('  → _pselBlocked agrees',       w._pselBlocked('mc')===true);
  RUN("_planSel.mc='personal-accident'");  ok('Personal Accident blocked', w._pselBlocked('mc')===true);
  RUN("_planSel.mc='accident-shield'");    ok('Accident Shield blocked',   w._pselBlocked('mc')===true);
  RUN("_planSel.mc='lifetime-health'"); RUN("_po.mc.plan='lifetime-health'");
  ok('Lifetime Health NOT blocked',   w._pselBlocked('mc')===false, warnTexts('mc'));
  ok('  → still warns about the 50 L floor when below',
     (RUN('_po.mc.si=1000000'), has('mc','warn',/will be sent <b>50 L<\/b> — its floor/)));
  RUN('_po.mc.si=5000000');
  ok('  → floor warning gone at 50 L', !has('mc','warn',/will be sent/), warnTexts('mc'));

  console.log('\n── ManipalCigna: the ladder is per plan, not Lifetime\'s ──');
  ok('MC_PLAN_META loaded from :3003/api/plans', G('Object.keys(MC_PLAN_META).length')===8,
     G('Object.keys(MC_PLAN_META).length'));
  ok('  → keyed by plan id, not Care ids', G("!!MC_PLAN_META['prohealth-prime']"));
  // The defect: Lifetime Health's 50 L floor was applied to all eight plans,
  // so a 10 L ProHealth Prime request silently became a 50 L one.
  RUN("_planSel.mc='prohealth-prime'"); RUN("_po.mc.plan='prohealth-prime'");
  [500000,1000000,1500000,2000000].forEach(si=>{
    RUN('_po.mc.si='+si);
    ok('ProHealth Prime keeps '+(si/100000)+' L', G('buildParamsForProvider("mc").si')===si);
    ok('  → and does not warn',                   !has('mc','warn',/will be sent/), warnTexts('mc'));
  });
  RUN("_planSel.mc='lifetime-health'"); RUN("_po.mc.plan='lifetime-health'");
  RUN('_po.mc.si=1000000');
  ok('Lifetime Health still floors 10 L to 50 L', G('buildParamsForProvider("mc").si')===5000000);
  RUN("_planSel.mc='accident-shield'"); RUN("_po.mc.plan='accident-shield'");
  RUN('_po.mc.si=20000000');
  ok('Accident Shield caps 2 Cr at its 50 L max', G('buildParamsForProvider("mc").si')===5000000);
  RUN('_po.mc.si=400000');
  ok('  → and snaps 4 L to the nearest rung it sells', G('buildParamsForProvider("mc").si')===500000);
  RUN("_planSel.mc='sarvah'"); RUN("_po.mc.plan='sarvah'"); RUN('_po.mc.si=2500000');
  ok('Sarvah keeps 25 L, which Prime does not sell', G('buildParamsForProvider("mc").si')===2500000);

  console.log('\n── Care: age eligibility ──');
  RUN("_planSel.care='3487'");                     // Care Senior, 61–99
  ok('Care Senior warns for a 54-year-old', has('care','warn',/ages/) );
  ok('  → names the member and the range',  has('care','warn',/61.99/) && has('care','warn',/Vivek is 54/));
  ok('  → says nobody is eligible',         has('care','warn',/nobody on the list/));
  setMembers([{name:'Elder',age:70},{name:'Vivek',age:54}]);
  ok('mixed ages: only the ineligible one is named',
     has('care','warn',/Vivek is 54/) && !/Elder is 70/.test(warnTexts('care').join(' ')), warnTexts('care'));
  ok('  → no longer claims nobody is eligible', !has('care','warn',/nobody on the list/));
  setMembers([{name:'Elder',age:70},{name:'Elder2',age:65}]);
  ok('all eligible → no age warning', !has('care','warn',/covers ages/), warnTexts('care'));

  console.log('\n── Care: member count and children ──');
  setMembers([{name:'A',age:30}]);
  RUN("_planSel.care='2813'");                     // Care Supreme, memberOptions "2,3,4"
  ok('1 member against "2,3,4" warns', has('care','warn',/sold for/), warnTexts('care'));
  setMembers([{name:'A',age:30},{name:'B',age:28,rel:'Spouse'}]);
  ok('2 members against "2,3,4" is fine', !has('care','warn',/sold for/), warnTexts('care'));
  setMembers([{name:'A',age:30},{name:'B',age:28},{name:'C',age:8,rel:'Son'}]);
  RUN("_planSel.care='6740'");                     // Secure Child: children false, fiveYearOnly true
  ok('children:false warns on a child',  has('care','warn',/no children/), warnTexts('care'));
  ok('fiveYearOnly warns',               has('care','warn',/5-year only/));
  ok('userSelectableSI:false warns',     has('care','warn',/no sum-insured selector/));

  console.log('\n── Care: sum insured the plan does not sell ──');
  setMembers([{name:'A',age:30},{name:'B',age:28}]);
  RUN("_planSel.care='3487'"); RUN('_po.care.si=5000000');   // Care Senior sells 3,5,7,10 lakhs
  ok('50 L against [3,5,7,10] warns',    has('care','warn',/does not sell/), warnTexts('care'));
  ok('  → lists what it does sell',      has('care','warn',/3, 5, 7, 10/));
  RUN('_po.care.si=1000000');
  ok('10 L is accepted silently',        !has('care','warn',/does not sell/), warnTexts('care'));

  console.log('\n── Care: the three unit mismatches ──');
  ['107','5674','5673'].forEach(id=>{
    RUN("_planSel.care='"+id+"'");
    ok('plan '+id+' carries the unit warning', has('care','warn',/Do not quote from this/), warnTexts('care'));
  });
  RUN("_planSel.care='2813'");
  ok('a normal plan carries none', !has('care','warn',/Do not quote from this/));

  console.log('\n── Care: the informational note ──');
  ok('portal default is shown',        has('care','info',/portal default 10 lakhs/));
  ok('unmapped field count is shown',  has('care','info',/5 portal inputs the calculator does not set/), warnTexts('care'));

  console.log('\n── plan list filter and POS grouping ──');
  w.openPlanSelect();
  const optAll=w._pselOptions('care','');
  ok('two optgroups',        (optAll.match(/<optgroup/g)||[]).length===2, optAll.match(/<optgroup[^>]*>/g));
  ok('POS group is separate', /label="POS variants"/.test(optAll));
  const optS=w._pselOptions('care','supreme');
  ok('filter "supreme" narrows', (optS.match(/<option/g)||[]).length < (optAll.match(/<option/g)||[]).length
      && /Care Supreme/.test(optS) && !/Care Heart/.test(optS));
  ok('filter is case-insensitive', w._pselOptions('care','SUPREME')===optS);
  ok('no match says so', /nothing matches/.test(w._pselOptions('care','zzzz')));
  w.document.getElementById('pself-care').value='senior';   // as a keystroke would
  w.pselFilter('care','senior');
  ok('typing rewrites only the select, keeps the box',
     /Care Senior/.test(w.document.querySelector('#pselc-care .psel-sel').innerHTML)
     && w.document.getElementById('pself-care').value==='senior');
  w.pselFilter('care','');

  console.log('\n── per-row overrides reach the right calculator ──');
  setMembers([{name:'A',age:35},{name:'B',age:33,rel:'Spouse'}]);
  RUN("_planSel.care='2813'"); RUN("_planSel.star='BPRD-034'"); RUN("_planSel.niva='Floater'");
  RUN("_planSel.mc='sarvah'"); RUN("_po.mc.plan='sarvah'");
  w.pselSetParam('care','si',1500000); w.pselSetParam('care','tenure',2); w.pselSetParam('care','cover','ff');
  w.pselSetParam('star','si',2500000); w.pselSetParam('star','tenure',3); w.pselSetParam('star','cover','individual');
  w.pselSetParam('mc','si',1000000);
  sent.length=0;
  w.planSelectFillAll(true);
  const by=k=>(sent.find(s=>s.k===k)||{}).msg;
  ok('all four received params', sent.length===4, sent.map(s=>s.k));
  ok('Care got its own 15 L / 2 yr / floater',
     by('care') && by('care').data.si===1500000 && by('care').data.tenure===2 && by('care').data.coverType==='ff',
     by('care') && by('care').data);
  ok('Star got its own 25 L / 3 yr / individual',
     by('star') && by('star').data.si===2500000 && by('star').data.tenure===3 && by('star').data.coverType==='individual',
     by('star') && by('star').data);
  ok('Care 15 L did NOT leak into Star', by('star').data.si!==1500000);
  // Sarvah sells 10 L, so it keeps it. Only Lifetime Health has the 50 L floor,
  // and Fill All must apply it to that plan alone.
  ok('Sarvah kept its own 10 L', by('mc') && by('mc').data.si===1000000, by('mc') && by('mc').data.si);
  RUN("_planSel.mc='lifetime-health'"); RUN("_po.mc.plan='lifetime-health'");
  sent.length=0; w.planSelectFillAll(true);
  ok('  → Lifetime Health raised to 50 L on the same 10 L row',
     by('mc') && by('mc').data.si===5000000, by('mc') && by('mc').data.si);
  // Put Sarvah back and re-send, so the assertions below read its message
  // rather than the Lifetime Health one this check just queued.
  RUN("_planSel.mc='sarvah'"); RUN("_po.mc.plan='sarvah'");
  sent.length=0; w.planSelectFillAll(true);
  ok('MC plan id is the canonical one', by('mc').data.plan==='sarvah', by('mc').data.plan);
  ok('Star plan is the product code',   by('star').data.plan==='BPRD-034', by('star').data.plan);
  ok('Niva plan is the category id',    by('niva').data.plan==='Floater', by('niva').data.plan);
  ok('Niva cover derived from category', by('niva').data.coverType==='ff', by('niva').data.coverType);

  console.log('\n── Care: the portal\'s Plan Type (field_23) ──');
  // Five of 48 plans carry it. The hub never sent it, so the portal took the
  // first option: Super Mediclaim was always quoted as the Cancer policy.
  ok('the catalogue carries the options',
     G("careTypeOptions('2813').join('|')")==='Care Supreme|Senior Premium|Senior Super',
     G("careTypeOptions('2813')"));
  ok('  → Super Mediclaim has its four',
     G("careTypeOptions('362').join('|')")==='Cancer|Critical|Operation|Heart',
     G("careTypeOptions('362')"));
  ok('a plan without the field has none', G("careTypeOptions('3485').length")===0);
  ok('  → and is not asked about it',     G("careHasTypeField('3485')")===false);
  ok('four plans offer a real choice',
     G("Object.values(CARE_PLAN_META).filter(p=>(p.planTypeOptions||[]).length>1).length")===4,
     G("Object.values(CARE_PLAN_META).filter(p=>(p.planTypeOptions||[]).length>1).map(p=>p.name)"));

  RUN("_planSel.care='362'");                       // Super Mediclaim
  ok('unpicked, the head of the list is what would go out', G("careChosenType('362')")==='Cancer');
  ok('  → and the picker warns, because these are different policies',
     has('care','warn',/No plan type picked/), warnTexts('care'));
  w.pselSetCareType('Heart');
  ok('picking one sticks', G("careChosenType('362')")==='Heart');
  ok('  → and the warning clears', !has('care','warn',/No plan type picked/), warnTexts('care'));
  sent.length=0; w.planSelectFillAll(true);
  ok('it reaches the calculator', by('care').data.planType==='Heart', by('care').data.planType);

  // A plan with no such field must not carry the previous plan's choice over.
  RUN("_planSel.care='3485'"); sent.length=0; w.planSelectFillAll(true);
  ok('a plan without the field sends no plan type',
     by('care').data.planType===undefined, by('care').data.planType);
  RUN("_planSel.care='362'");
  ok('and the earlier choice is still remembered', G("careChosenType('362')")==='Heart');

  // Per-plan, not global: Care Supreme's choice must not become Super Mediclaim's.
  RUN("_planSel.care='2813'");
  ok('a different plan starts at its own first option', G("careChosenType('2813')")==='Care Supreme');
  w.pselSetCareType('Senior Premium');
  RUN("_planSel.care='362'");
  ok('  → and setting it did not disturb the other plan', G("careChosenType('362')")==='Heart');

  // Enhance (748) is flagged as having the field but its options were never
  // captured, so the hub cannot set it. That must be said, not ignored.
  RUN("_planSel.care='748'");
  ok('a field with uncaptured options is flagged',
     has('care','warn',/the hub has no options for it/), warnTexts('care'));
  ok('  → and the note names the stale-server cause too',
     has('care','warn',/restart it/), warnTexts('care'));
  sent.length=0; w.planSelectFillAll(true);
  ok('  → and nothing is invented for it', by('care').data.planType===undefined, by('care').data.planType);

  // Surrogacy has exactly one option — no choice to make, nothing to warn about.
  RUN("_planSel.care='6395'");
  ok('a single-option field needs no warning',
     !has('care','warn',/No plan type picked/), warnTexts('care'));
  sent.length=0; w.planSelectFillAll(true);
  ok('  → but it is still sent', by('care').data.planType==='SURROGACY', by('care').data.planType);
  RUN("_planSel.care='2813'");

  console.log('\n── Niva: category → plan name → variant ──');
  // Niva's top dropdown is a category, not a product. Before this cascade the
  // hub sent only the category, so whichever product headed Niva's list was
  // quoted — and its first variant tier with it.
  await w.loadNivaProducts('Floater');
  await w.loadNivaProducts('Individual');
  ok('product list fetched per category',
     G('nivaProductList("Floater").length')===2 && G('nivaProductList("Individual").length')===4,
     [G('nivaProductList("Floater").length'), G('nivaProductList("Individual").length')]);
  ok('  → variants come along in the same fetch',
     G('nivaProductList("Floater")[0].variants.length')===4,
     G('nivaProductList("Floater")[0].variants'));
  ok('  → a product with no tier reports none',
     G('nivaProductList("Individual").find(p=>p.label.indexOf("GoActive")===0).variants.length')===0);

  RUN("_planSel.niva='Floater'");
  ok('unpicked, the head of the list is what would go out',
     G('nivaChosenProduct("Floater").label')==='Aspire Family Floater');
  ok('  → and the picker says so rather than staying silent',
     has('niva','info',/heads Niva's list/), warnTexts('niva'));
  ok('  → and warns the tier is a default too',
     has('niva','warn',/No variant picked/), warnTexts('niva'));

  w.pselSetNivaProduct('64');                       // ReAssure3.0 Family Floater
  ok('picking a product sticks', G('nivaChosenProduct("Floater").label')==='ReAssure3.0 Family Floater');
  ok('  → the default-product note is gone', !has('niva','info',/heads Niva's list/), warnTexts('niva'));
  ok('  → its own tier list is offered', G('nivaChosenVariant("Floater").label')==='Classic');
  w.pselSetNivaVariant('3');
  ok('picking a tier sticks', G('nivaChosenVariant("Floater").label')==='Elite');
  ok('  → and the variant warning clears', !has('niva','warn',/No variant picked/), warnTexts('niva'));

  sent.length=0; w.planSelectFillAll(true);
  ok('the product id reaches the calculator', by('niva').data.product==='64', by('niva').data.product);
  ok('  → with its label, for honest clamp reporting', by('niva').data.productLabel==='ReAssure3.0 Family Floater');
  ok('  → and the chosen tier, not the first', by('niva').data.variant==='3', by('niva').data.variant);
  ok('  → with its label too', by('niva').data.variantLabel==='Elite');

  // Switching category must not carry the other category's product across.
  RUN("_planSel.niva='Individual'");
  ok('a different category offers its own products',
     G('nivaChosenProduct("Individual").label')==='Aspire Individual');
  sent.length=0; w.planSelectFillAll(true);
  ok('  → and sends that one', by('niva').data.product==='57', by('niva').data.product);
  RUN("_planSel.niva='Floater'");
  ok('switching back restores the earlier choice',
     G('nivaChosenProduct("Floater").label')==='ReAssure3.0 Family Floater');
  ok('  → including its tier', G('nivaChosenVariant("Floater").label')==='Elite');

  // Changing product must drop the old tier rather than carry the index over:
  // tier "3" means Platinum+ on Aspire and Elite on ReAssure 3.0.
  w.pselSetNivaProduct('58');                       // back to Aspire
  ok('changing product resets the tier to that product\'s first',
     G('nivaChosenVariant("Floater").label')==='Gold+', G('nivaChosenVariant("Floater")'));

  // A product with no tier must not send a stale variant from a previous pick.
  RUN("_planSel.niva='Individual'"); w.pselSetNivaProduct('13');   // GoActive, no tiers
  sent.length=0; w.planSelectFillAll(true);
  ok('a tierless product sends no variant', by('niva').data.variant===undefined, by('niva').data.variant);
  ok('  → and no tier warning is raised', !has('niva','warn',/No variant picked/), warnTexts('niva'));

  console.log('\n── Niva: the product list failing is said out loud ──');
  RUN("_planSel.niva='SeniorCitizen'");
  await w.loadNivaProducts('SeniorCitizen');
  ok('a good category loads', G('nivaProductList("SeniorCitizen").length')===1);
  RUN("NIVA_PRODUCTS['SeniorCitizen']=null");        // as if the fetch had failed
  ok('a failed fetch warns instead of quoting blind',
     has('niva','warn',/product list could not be loaded/), warnTexts('niva'));
  RUN("_planSel.niva='Floater'");
  ok('autoCalc passed through',         sent.every(s=>s.msg.autoCalc===true));

  console.log('\n── Fill All skips a blocked provider ──');
  RUN("_planSel.mc='accident-shield'"); RUN("_po.mc.plan='accident-shield'");
  sent.length=0; w.planSelectFillAll(true);
  ok('three sent, MC skipped', sent.length===3 && !sent.some(s=>s.k==='mc'), sent.map(s=>s.k));
  w.openPlanSelect();
  ok('summary counts the skip', /skip 1 blocked provider/.test(w.document.getElementById('psel-summary').textContent),
     w.document.getElementById('psel-summary').textContent);
  ok('per-row Fill is disabled',
     w.document.querySelector('#pselc-mc .psel-fill').disabled===true);
  const b2=sent.length; w.pselFillOne('mc',true);
  ok('per-row Fill on a blocked row sends nothing', sent.length===b2);
  RUN("_planSel.mc='lifetime-health'"); RUN("_po.mc.plan='lifetime-health'");

  console.log('\n── live status inside the modal ──');
  w.openPlanSelect();
  w.setProvStatus('care','loading');
  ok('card pill shows calculating', /calculating/.test(w.document.querySelector('#pselc-care .psel-stat').textContent),
     w.document.querySelector('#pselc-care .psel-stat').textContent);
  w.setProvStatus('care','ready');
  ok('card pill shows the quote',   /quote/.test(w.document.querySelector('#pselc-care .psel-stat').textContent));
  ok('the filter box survived a status update', !!w.document.getElementById('pself-care'));

  console.log('\n── summary line content ──');
  w.openPlanSelect();
  const sum=w.document.getElementById('psel-summary').textContent;
  ok('names every provider', ['Care Health','ManipalCigna','Star Health','Niva Bupa'].every(x=>sum.includes(x)), sum);
  ok('shows the member count', /2 members/.test(sum), sum);
  ok('shows the pincode',      /700019/.test(sum));

  console.log('\n── the old dialog still agrees ──');
  ok('Plan Config writes the same state', (w.setPO('care','si',2500000,{parentElement:{querySelectorAll:()=>[]},classList:{add(){}}}),
     G('_po.care.si')===2500000));
  ok('and the picker shows it', (w.openPlanSelect(),
     w.document.querySelector('#pselc-care .psel-chips').innerHTML.includes('on')));

  console.log('\n── sum-insured bands ──');
  const SI = G('RP_SI_LIST');
  ok('13 bands, from what the four providers actually sell', SI.length === 13, SI.length);
  ok('every band has a short chip label', SI.every(b => b.short), SI.filter(b=>!b.short));
  ok('the reference quotation\'s five are all present',
     ['10','15','25','50','100'].every(k => SI.some(b => b.key === k)), SI.map(b=>b.key));
  ok('the picker chips come from the list',
     JSON.stringify(G('_PSEL_SI').map(x=>x.t)) === JSON.stringify(SI.map(b=>b.short)));
  ok('every band has an Excel label', SI.every(b => G('XL_SI_LABEL')[b.key]),
     SI.filter(b => !G('XL_SI_LABEL')[b.key]).map(b=>b.key));
  ok('the reference\'s exact wording is untouched',
     G("XL_SI_LABEL['100']") === '1 cr' && G("XL_SI_LABEL['10']") === '10 Lacs');

  // The banding rule has to get tighter as the ladder gets denser: 3 L and 5 L
  // are two lakhs apart, so a flat +/-1 lakh would swallow a real 4 L quote.
  const band = v => w.getSIKey(v);
  ok('exact amounts band correctly',
     band('3 Lacs')==='3' && band('7.5 Lacs')==='7.5' && band('20 Lacs')==='20'
     && band('2 Cr')==='200' && band('3 Cr')==='300');
  ok('display rounding is still absorbed', band('1050000')==='10', band('1050000'));
  ok('4 L is NOT swallowed by 3 L or 5 L', band('4 Lacs')===null, band('4 Lacs'));
  ok('45 L and 90 L still excluded', band('45 Lacs')===null && band('90 Lacs')===null);
  ok('1.5 Cr still excluded', band('1.5 Cr')===null, band('1.5 Cr'));

  console.log('\n'+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
 }catch(e){ console.log('\nHARNESS ERROR: '+e.message+'\n'+e.stack); process.exit(1); }
},1000);
