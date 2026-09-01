// verify_excel_fixture.js
// ---------------------------------------------------------------------------
// Drives insurance_hub.html headlessly and writes _test_output.xlsx, using
// exactly the data in the client reference file "Vivek Bhaia_Quote.xlsx" —
// 4 members, an existing policy, and 5 sum-insured bands x 4 insurers x
// 2 cover modes x 3 tenures, plus a named two-member group and one individual.
//
// Then run:  python verify_excel_format.py _test_output.xlsx
//
// Needs jsdom, which is NOT a project dependency (it is a test-only tool and
// pulls in ~135 packages). Install it just for the run and remove it after:
//
//     npm install --no-save jsdom
//     node verify_excel_fixture.js && python verify_excel_format.py _test_output.xlsx
//     npm prune
// ---------------------------------------------------------------------------
const fs=require('fs');const {JSDOM}=require('jsdom');
const ROOT=__dirname + '/../../';
const feat=JSON.parse(fs.readFileSync(ROOT+'data/feature_comparison.json','utf8'));
const cat=JSON.parse(fs.readFileSync(ROOT+'data/care_plans.json','utf8'));
const careLive=JSON.parse(fs.readFileSync(ROOT+'data/care_features_mapped.json','utf8'));
const nivaLive=JSON.parse(fs.readFileSync(ROOT+'data/niva_features_mapped.json','utf8'));
const mcLive=JSON.parse(fs.readFileSync(ROOT+'data/mc_features_mapped.json','utf8'));
const starLive=JSON.parse(fs.readFileSync(ROOT+'data/star_features_mapped.json','utf8'));

const dom=new JSDOM(fs.readFileSync(ROOT+'public/hub/insurance_hub.html','utf8'),{
  runScripts:'dangerously', url:'http://localhost:3005/hub', pretendToBeVisual:true,
  beforeParse(w){
    w.ExcelJS = require('exceljs');
    w.confirm = ()=>true;
    w.fetch = (u)=>{
      const s=String(u);
      if(s.includes('feature_comparison.json')) return Promise.resolve({ok:true,json:()=>Promise.resolve(feat)});
      if(s.includes('care_features_mapped.json')) return Promise.resolve({ok:true,json:()=>Promise.resolve(careLive)});
      if(s.includes('niva_features_mapped.json')) return Promise.resolve({ok:true,json:()=>Promise.resolve(nivaLive)});
      if(s.includes('mc_features_mapped.json'))    return Promise.resolve({ok:true,json:()=>Promise.resolve(mcLive)});
      if(s.includes('star_features_mapped.json'))  return Promise.resolve({ok:true,json:()=>Promise.resolve(starLive)});
      if(s.includes('/plans')) return Promise.resolve({ok:true,json:()=>Promise.resolve(cat)});
      return Promise.reject(new Error('offline'));
    };
  }
});
const w=dom.window;
let written=null;
w.URL.createObjectURL=(b)=>{ written=b; return 'blob:x'; };
w.URL.revokeObjectURL=()=>{};
const RealBlob=w.Blob;
w.Blob=function(parts,opts){ const b=new RealBlob(parts,opts); b._parts=parts; return b; };

// ── the reference data, transcribed ────────────────────────────────────────
const MC_ADD  = " Coverage for Non-Medical Items and Durable Medical Equipment's,Room Rent Modification";
const NIVA_ADD= 'safeguard plus,';
const CARE_ADD= 'Air Ambulance,Annual Health Checkup, Wellness Benefit,Bonus Benefit,Claim Shield';
const HDFC_ADD= 'Unlimited Restore';
const MCL_ADD = 'Cumulative Bonus, Worldwide Medical Emergency Hospitalization, Shield, Advance';

// [siLabel, [company, plan, addon, ff[3] (null = not quoted), mi[3]], ...]
const BANDS = [
  ['10 Lacs', [
    ['Manipal Cigna','Sarvah Param',MC_ADD,[60041,113789,170159],[71853,135038,200548]],
    ['Niva Bupa','Reassure2.0 Bronze',NIVA_ADD,[38504,73158,111461],[60256,114487,169879]],
    ['Care','Care Supreme',CARE_ADD,null,[49273,94850,144488]],
    ['Hdfc Ergo','Optima secure',HDFC_ADD,[51162,96662,144012],[70596,133197,198180]],
  ]],
  ['15 Lacs', [
    ['Manipal Cigna','Sarvah Param',MC_ADD,[62808,118855,177463],[76155,142985,212100]],
    ['Niva Bupa','Reassure2.0 Bronze',NIVA_ADD,[50742,96409,146949],[77803,147824,219356]],
    ['Care','Care Supreme',CARE_ADD,null,[59106,113779,173387]],
    ['Hdfc Ergo','Optima secure',HDFC_ADD,[60109,113661,170286],[82852,156456,233714]],
  ]],
  ['25 Lacs', [
    ['Manipal Cigna','Sarvah Param',MC_ADD,[70749,133889,199921],[85705,160925,238723]],
    ['Niva Bupa','Reassure2.0 Bronze',NIVA_ADD,[58780,111681,170193],[88663,168458,250173]],
    ['Care','Care Supreme',CARE_ADD,null,[69068,132957,202343]],
    ['Hdfc Ergo','Optima secure',HDFC_ADD,[71810,136385,204211],[97686,185237,276940]],
  ]],
  ['50 Lacs', [
    ['Manipal Cigna','Lifetime',MCL_ADD,null,[67934,125678,190188]],
    ['Niva Bupa','Reassure2.0 Bronze',NIVA_ADD,[73029,138756,211664],[110466,209888,311834]],
    ['Care','Care Supreme',CARE_ADD,null,[79013,152100,231630]],
    ['Hdfc Ergo','Optima secure',HDFC_ADD,[90988,173212,259836],[122831,233429,349634]],
  ]],
  ['1 Crore', [
    ['Manipal Cigna','Lifetime',MCL_ADD,null,[74718,138228,209053]],
    ['Niva Bupa','Reassure2.0 Bronze',NIVA_ADD,[90105,171199,261433],[136593,259522,385809]],
    ['Care','Care Supreme',CARE_ADD,null,[99016,190605,290316]],
    ['Hdfc Ergo','Optima secure',HDFC_ADD,[101817,193920,291131],[137303,261039,391232]],
  ]],
];

setTimeout(async ()=>{
  const $=i=>w.document.getElementById(i);
  const setM=(id,n,rel,dob,g,ped,pin)=>{ w.memberField(id,'name',n); w.memberField(id,'relation',rel);
    w.memberField(id,'gender',g); w.memberField(id,'ped',ped); w.memberField(id,'pin',pin); w.memberDOB(id,dob); };
  setM(1,'Vivek Bhaia','Self','1971-05-19','Male','Hypertension since 6 years','700019');
  w.addMember(); setM(2,'Pratibha Bhaia','wife','1973-12-04','Female','Uterus Removal - 6 yrs back','700019');
  w.addMember(); setM(3,'Shivangi Bhaia','Daughter','1997-08-29','Female','Na','700019');
  w.addMember(); setM(4,'Shourya Bhaia','Son','2004-06-03','Male','Skin rashes','700019');

  $('rp_client_name').value='Vivek Bhaia';
  $('rp_existing_policy').value='The New India Assurance Co. Ltd.';
  $('rp_ep_plan').value='New India Flexi Floater Group Mediclaim Policy';
  $('rp_existing_si').value='1000000';
  $('rp_existing_prem').value='43319';
  $('rp_ep_renewal_date').value='05.01.2026';
  $('rp_ep_renewal_prem').value='';
  $('rp_ep_type').value='Floater';
  if($('rp_greeting')) $('rp_greeting').value='Greetings from Plan my life.';

  BANDS.forEach(([si, insurers])=>{
    insurers.forEach(([co,plan,addon,ff,mi])=>{
      if(ff) ff.forEach((p,i)=> w.addQuote({company:co,planName:plan,sumAssured:si,
        premium:'₹'+p, addons:addon, tenure:i+1, coverType:'Floater'}));
      if(mi) mi.forEach((p,i)=> w.addQuote({company:co,planName:plan,sumAssured:si,
        premium:'₹'+p, addons:addon, tenure:i+1, coverType:'individual'}));
    });
  });
  w.rpSync();

  // ── a named two-member group and one individual, to exercise the other two
  //    sheet shapes the reference workbook contains ──
  const tagFrom = w.document.querySelectorAll('#rp-tbody tr').length;
  w.addMemberGroup();
  const gid = w.eval('_memberGroups[0].id');
  w.mgToggle(gid,'1',true); w.mgToggle(gid,'2',true);
  w.mgSetName(gid,'Vivek & Pratibha Bhaia Quote');
  // 5 insurers x 2 modes x 3 tenures at 10 L for the group, and 5 insurers at
  // 10 L + 15 L for the individual, matching the reference's shapes.
  const GROUP = [
    ['Manipal Cigna','Sarvah Param',MC_ADD,[45146,85818,128727],null],
    ['Niva Bupa','Reassure2.0 Bronze',NIVA_ADD,[31541,59928,92754],[42540,80826,121159]],
    ['Care','Care Supreme',CARE_ADD,[25830,49723,81035],[35705,68732,106158]],
    ['Star Health','Assure','NA',[24377,46316,74572],null],
    ['Hdfc Ergo','Optima secure',HDFC_ADD,[40557,76917,115012],[49386,93706,140179]],
  ];
  GROUP.forEach(([co,plan,addon,ff,mi])=>{
    if(ff) ff.forEach((p,i)=> w.addQuote({company:co,planName:plan,sumAssured:'10 Lacs',
      premium:'₹'+p, addons:addon, tenure:i+1, coverType:'Floater'}));
    if(mi) mi.forEach((p,i)=> w.addQuote({company:co,planName:plan,sumAssured:'10 Lacs',
      premium:'₹'+p, addons:addon, tenure:i+1, coverType:'individual'}));
  });
  const INDIV = [
    ['Manipal Cigna','Sarvah Param',MC_ADD,[14945,27017,38536]],
    ['Niva Bupa','Reassure2.0 Bronze',NIVA_ADD,[10240,19457,28161]],
    ['Care','Care Supreme',CARE_ADD,[8046,15489,22731]],
    ['Star Health','Assure','NA',[8028,15253,22478]],
    ['Hdfc Ergo','Optima secure',HDFC_ADD,[12311,22915,33647]],
  ];
  INDIV.forEach(([co,plan,addon,ff])=>
    ff.forEach((p,i)=> w.addQuote({company:co,planName:plan,sumAssured:'10 Lacs',
      premium:'₹'+p, addons:addon, tenure:i+1, coverType:'individual'})));
  w.rpSync();

  // tag them: the group block first, then the individual block
  const rows=Array.from(w.document.querySelectorAll('#rp-tbody tr'))
    .map(tr=>Number(tr.getAttribute('data-rid')));
  const gCount = GROUP.reduce((n,[,,,ff,mi])=>n+(ff?3:0)+(mi?3:0),0);
  rows.slice(tagFrom, tagFrom+gCount).forEach(id=>w.rpUpd(id,'member','g:'+gid));
  rows.slice(tagFrom+gCount).forEach(id=>w.rpUpd(id,'member','m:3'));

  await w.generateReport();
  await new Promise(r=>setTimeout(r,600));
  if(!written){ console.log('FAIL — no workbook produced'); process.exit(1); }
  const buf=Buffer.concat(written._parts.map(p=>Buffer.from(p)));
  // Written to the invoking cwd (repo root via npm), not this script's own
  // folder — `npm run verify:excel` hands this filename to a separate Python
  // process by bare name, resolved against that same cwd.
  fs.writeFileSync(require('path').join(process.cwd(), '_test_output.xlsx'), buf);
  console.log('workbook written:', buf.length, 'bytes');
  process.exit(0);
},900);
