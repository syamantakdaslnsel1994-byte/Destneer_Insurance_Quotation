/**
 * mc_test_covertype.js
 * Tries all known coverType values for 1 adult, ZONE2, 50L
 * Run: node mc_test_covertype.js
 */
const https  = require('https');
const crypto = require('crypto');

const AES_KEY = Buffer.from('lv39eptlvuhaqqer', 'utf8');
const GATEWAY = 'https://online.gateway.manipalcigna.com';
const VIEWS   = `${GATEWAY}/sellonlineltappformservice/udaanapi/quoteservice/viewPlans`;

const BROWSER_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin':          'https://online.manipalcigna.com',
  'Referer':         'https://online.manipalcigna.com/',
};

function encryptECB(obj) {
  const plain  = JSON.stringify(obj);
  const cipher = crypto.createCipheriv('aes-128-ecb', AES_KEY, Buffer.alloc(0));
  cipher.setAutoPadding(true);
  return cipher.update(plain, 'utf8', 'base64') + cipher.final('base64');
}

// Also decrypt a base64 string — paste the URL q= value here to inspect
function decryptECB(b64) {
  const dec = crypto.createDecipheriv('aes-128-ecb', AES_KEY, Buffer.alloc(0));
  dec.setAutoPadding(true);
  return JSON.parse(dec.update(b64, 'base64', 'utf8') + dec.final('utf8'));
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random()*16|0;
    return (c==='x'?r:(r&0x3|0x8)).toString(16);
  });
}
function cuid() {
  return 'c'+Math.random().toString(36).slice(2,12)+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
}

function post(url, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = https.request(url, {
      method:  'POST',
      headers: {
        ...BROWSER_HEADERS,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
      timeout: 15000,
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { resolve({ raw: d }); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function buildPayload(coverType) {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2,'0');
  const mm = String(now.getMonth()+1).padStart(2,'0');
  const yyyy = now.getFullYear();
  return {
    preparedData: {
      coverType,
      sumInsured:  '5000000',
      sumInsured2: '5000000',
      pinCode:     '700041',
      zone:        'ZONE2',
      allInsuredAreResidentIndian: 'Y',
      areaOfCover: null,
      createDate:  `${dd}/${mm}/${yyyy}`,
      majorIllnessCover: 'ALL',
      coverTypeInfo: {
        adultCount:  1,
        peopleCount: 1,
        childCount:  0,
        details: [{
          gender:               'M',
          dob:                  `${dd}/${mm}/${yyyy-35}`,
          adult:                'A',
          infertilityTreatment: 'N',
          maternityBenefit:     'N',
          oocyteBenefit:        'N',
          surrogacyBenefit:     'N',
          partyId:              1,
          paFlag:               'N',
          paOption:             '',
          paSumInsured:         '',
        }],
      },
    },
    leadId:       cuid(),
    isSingleProduct: 'N',
    paymentMode:  '',
    emailAddress: '',
    mobileNumber: '',
    isWorkSite:   'N',
    suggestionSet:'Set0',
    variant:      '',
    tenure:       '1',
    deductable:   '0',
    isEmployee:   'N',
    worldZone:    'WORLDZONE1',
    renewalDiscount: 'N',
    channelId:    '',
    parentAgencyId: '',
    portability:  'N',
    posp:         'N',
    sourceType:   'NB',
    globalIllCoverage: 'All',
    healthPlus:   'N',
    globalPlus:   'N',
    ciRider:      'N',
    ciRiderSA:    null,
    opdRider:     'N',
    opdRiderPackage: null,
    opdRiderSA:   null,
    advanceAddOn: 'N',
    shield:       'N',
    womensPlus:   'N',
    inputMode:    '5',
    isMchiCustomer: 'N',
    isDirectPolicy: 'N',
    socialMedia:  'N',
    waiverOfDeductible: 'N',
    cbb:          'Y',
    infertilityTreatment: 'N',
    loyaltyDiscount: 'N',
    maternityBenefit: 'N',
    pedPolicyTerm: 0,
    pedReduction: 'N',
    surrogacyBenefit: 'N',
    oocyteBenefit: 'N',
    worksiteDiscount: 'N',
    worldwideEmergency: 'Y',
    worldwideEmergencySA: '2500000',
    isZoneUpgrade: 'N',
    agentId:      '', agentName: '', businessFor: '', skip: false,
    agentMobileNum: '', agentEmailId: '', branchId: '',
    employeeCodeOrSpCode: '', employeeNameOrSpName: '',
    parentagencyname: '', mappedirdalocation: '', businesscreditchannel: '',
    pan:          '',
    flowType:     'advisor',
    refA:'', refB:'', refC:'',
    mode:         'all',
    product:      'Lifetime Health',
    product_code: 'LTIN02SBLF',
    quickQuoteId: uuid(),
    medium:'', source:'', campaign:'', applicationNo:'', custAuthFlag:'',
    frequency:    'single',
  };
}

// Decode a URL q= param to see what the website actually sends
const URL_SAMPLE = '9Fq98TDjzGKebP6iJDSyfRN1zE35FV9YhjT7JUcO2fdbrtTngK4hYpbllVathnnXcaQUa/IVM+MmTkcqQFAMY28BRPe+y8G0rvagrsjBZ4sEWUoNrciLHEAyQYCDKQ6sM/EG/5CYilH4eIwuztrCcZz6c7SoQ5qUWY4BBx51Yeyg2Gjj33w7p/DPp5buI7L+YgneVeFceQqutYTfQL07vuFmfk02N8eHkjrtqWIKUSgMp6TygRa0bVjcSA3BiQ965G1869e2KhankBdWJ1BRUpz1lf9oDCwRrfwKnCO/YXDMK2VfKoWu+jRmU3mVycoWDl2xQ/Af6u/1wN1zYEp+jraDDGELwnO5l8B5jPJ6Iq+MWO+UjJYvxH57pqhONtSKJmCZGRSIErtHWM/LqJmdt/G3wiREP195stXaBm50JbfXgsHr4Bv2xMDRMWyV/ZzUD8ga5k57FiFmC++Pitxu31aVWfR+gnlbQv2AZuofsd0bXaIveJtNlsjQPyFjwCzDMrh46R4F1OoNP/qaoL/U7Rz/erYSY0tUxZiffwm4hKI1AmrwZsMa4tIVV+cnYcTXyfyOp/VMUQcz8W5C3FWz9OXnlUhfFvmbG4HZVHE2OTAEbLfAI/FFc4lCz0/d0Kn7LD4H/bBrCMun4YxwO2QuypfYKuwJvva4D6oGn6f14za+uzB7DsNpu3nmfSqd+KZunQJRfUFLfwR7cJ7bKXJ2IBYPpGEE7q3g+jRRT9DMGavQ/zt8KOKp8OICdb4h516TvNht9WcthnFtdobpLLtQXj9QOM7kYt5v1+XEhD3HNF54IPRyHL3TeaOeSYoO3yQAIWo5t5syTrJOSf1FaWVEdhr8BrCqDcj7MsrqwRo+6HxOcImQBxEDHvN+s9IJtKYKbtezOwzOy+FmzwRCYSgo3wHMbZSR3tjGyU5ivVBqoaUwbb3yB2ibXQU5VuGJofK6';

async function main() {
  // 1. Decrypt the working 1-adult URL from browser to see exact coverType
  try {
    const decoded = decryptECB(URL_SAMPLE);
    console.log('\n=== BROWSER URL DECRYPTED ===');
    console.log('coverType       :', decoded.preparedData?.coverType);
    console.log('adultCount      :', decoded.preparedData?.coverTypeInfo?.adultCount);
    console.log('member gender   :', decoded.preparedData?.coverTypeInfo?.details?.[0]?.gender);
    console.log('member dob      :', decoded.preparedData?.coverTypeInfo?.details?.[0]?.dob);
  } catch(e) {
    console.log('Decrypt failed:', e.message);
  }

  // 2. Test each coverType candidate for 1 adult ZONE2
  const candidates = ['IND', 'INFF', 'individual', 'Individual', 'FamilyFloater', 'INDFF', 'FF'];
  console.log('\n=== TESTING COVER TYPES (1 adult, ZONE2, 50L) ===');
  for (const ct of candidates) {
    try {
      const payload  = buildPayload(ct);
      const encoded  = encryptECB(payload);
      const result   = await post(VIEWS, { encodedString: encoded });
      const status   = result?.response?.Status;
      const cards    = result?.response?.Card?.length ?? 0;
      console.log(`coverType=${ct.padEnd(15)} → Status: ${status} | Cards: ${cards}`);
    } catch(e) {
      console.log(`coverType=${ct.padEnd(15)} → ERROR: ${e.message}`);
    }
  }
}

main().catch(console.error);
