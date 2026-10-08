import {test,expect} from '@playwright/test';
async function openTwirl(page){
  await page.goto('/');
  await page.getByRole('button',{name:'▦ Explore tools',exact:true}).click();
  await page.locator('.tool-card',{hasText:'Pauli Twirling'}).getByRole('button',{name:'Try this mini-game →'}).click();
  await expect(page.getByRole('heading',{name:'Shuffle the Error'})).toBeVisible();
}
async function run(page){
  await page.getByRole('button',{name:/^(Run both treatments|Run again)$/}).click();
  await expect(page.getByRole('button',{name:'Run again'})).toBeEnabled({timeout:60000});
}
test('toolkit card opens the twirl lab and the shuffler tells the sqrt(N) story',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'▦ Explore tools',exact:true}).click();
  await page.locator('.tool-card',{hasText:'Pauli Twirling'}).getByRole('button',{name:'Try this mini-game →'}).click();
  await expect(page.getByRole('heading',{name:'What is Pauli twirling?'})).toBeVisible();
  await expect(page.getByRole('img',{name:/total 12 of a possible 12/})).toBeVisible();
  const totals=page.locator('.tw-walk-totals span');
  await expect(totals.first()).toContainText('no shots yet');
  for(let i=0;i<3;i++)await page.getByRole('button',{name:'▶ Take a shot'}).click();
  await expect(page.getByText(/Without twirling every shot is identical/)).toBeVisible();
  await expect(page.getByText(/3 shots has reached \+36/)).toBeVisible();
  await expect(totals.first()).toContainText('+36');
  await expect(totals.first()).toContainText('after 3 shots, typically ±6.0 if random');
  await expect(page.getByRole('img',{name:/running total has reached 36 after 3 shots/})).toBeVisible();
  await page.getByRole('button',{name:'Pauli twirling',exact:true}).click();
  await expect(page.getByText(/roughly 3\.5 instead of 12/)).toBeVisible();
  await expect(totals.nth(1)).toContainText('no shots yet');
  for(let i=0;i<4;i++)await page.getByRole('button',{name:'▶ Take a shot'}).click();
  // The twirled walk stays near zero while the untwirled history is kept for comparison.
  await expect(totals.nth(1).locator('strong')).toHaveText(/^[+−]?\d+$/);
  await expect(totals.nth(1)).toContainText('after 4 shots');
  await expect(totals.first()).toContainText('+36');
  await expect(page.getByRole('img',{name:/with Pauli twirling it is at -?\d+ after 4 shots/})).toBeVisible();
  await page.getByRole('button',{name:'↺ Clear both'}).click();
  await expect(totals.first()).toContainText('no shots yet');
  await expect(totals.nth(1)).toContainText('no shots yet');
  await expect(page.getByRole('button',{name:'↺ Clear both'})).toBeDisabled();
});
test('level 1: the frames are visible in the circuit but not in the answer',async({page})=>{
  await openTwirl(page);
  await page.getByRole('button',{name:'Level 1: The same circuit twice'}).click();
  await expect(page.getByRole('img',{name:'Bare circuit diagram'})).toContainText('Rz(-0.8)');
  await expect(page.getByText('8 TWO-QUBIT GATES')).toBeVisible();
  await page.getByRole('button',{name:'With Pauli twirling'}).click();
  const twirled=page.getByRole('img',{name:'Twirled circuit diagram'});
  await expect(twirled).toContainText('Rz(-0.8)');
  await expect(page.getByRole('heading',{name:'The Pauli frame around each two-qubit gate'})).toBeVisible();
  await expect(page.locator('.tw-frame')).toHaveCount(8);
  await expect(page.getByText('8 Pauli frames')).toBeVisible();
  await expect(page.getByText(/the two circuits give the same noiseless outcome/)).toBeVisible();
  const before=await twirled.textContent();
  await page.getByRole('button',{name:'↺ Draw new frames'}).click();
  await expect(twirled).not.toHaveText(before);
  await expect(page.getByText(/the two circuits give the same noiseless outcome/)).toBeVisible();
  await page.getByRole('button',{name:/^A They scramble it/}).click();
  await expect(page.getByText('Not quite.')).toBeVisible();
  await page.getByRole('button',{name:/^C Nothing at all/}).click();
  await expect(page.getByText('✓ Level complete!')).toBeVisible();
  await expect(page.getByText('1 / 4 levels complete')).toBeVisible();
});
test('level 2: twirling fixes a coherent error',async({page})=>{
  await openTwirl(page);
  await page.getByRole('button',{name:'Level 2: The drifting quench'}).click();
  await expect(page.getByText('NOT RUN YET')).toBeVisible();
  await expect(page.getByLabel('Randomizations')).toHaveValue('16');
  await expect(page.getByLabel('Shots per randomization')).toHaveValue('512');
  await run(page);
  await expect(page.getByText('✓ Twirling moved the answer towards the ideal value.')).toBeVisible();
  await expect(page.getByText('✓ Level complete!')).toBeVisible();
  await expect(page.getByLabel(/[1-3] of 3 stars/)).toBeVisible();
  await expect(page.getByRole('img',{name:/Magnetisation of each randomization/})).toBeVisible();
  await page.getByLabel('Randomizations').selectOption('8');
  await expect(page.getByText('You changed the budget. Run again to update the result.')).toBeVisible();
  await page.locator('.tw-details summary').click();
  await expect(page.getByRole('cell',{name:'Total variation distance'})).toBeVisible();
});
test('level 3: twirling a Pauli channel changes nothing',async({page})=>{
  await openTwirl(page);
  await page.getByRole('button',{name:'Level 3: Noise that is already random'}).click();
  await run(page);
  await expect(page.getByText('Twirling changed nothing measurable.')).toBeVisible();
  await expect(page.getByText(/Anything inside that band is shot noise, not mitigation\./)).toBeVisible();
  await page.getByRole('button',{name:/^A There were too few randomizations/}).click();
  await expect(page.getByText('Not quite.')).toBeVisible();
  await page.getByRole('button',{name:/^B Depolarizing noise is already a random Pauli channel/}).click();
  await expect(page.getByText('✓ Level complete!')).toBeVisible();
  await expect(page.getByText(/A channel that is already a Pauli channel is its own twirl/)).toBeVisible();
});
test('twirl lab: Aer runs, IBM is opt-in, and the session history accumulates',async({page})=>{
  await openTwirl(page);
  await page.getByRole('button',{name:'Twirl lab: Aer or IBM'}).click();
  await expect(page.getByLabel('Noise scenario')).toBeVisible();
  await page.getByRole('radio',{name:/IBM quantum computer/}).check();
  await expect(page.getByLabel('Noise scenario')).toHaveCount(0);
  await expect(page.getByLabel('Qubits')).toHaveCount(0);
  await expect(page.getByLabel('IBM coherent-witness preset')).toBeVisible();
  await expect(page.getByText(/target ⟨Z⟩ = \+1/)).toBeVisible();
  await expect(page.getByText(/Z kick 0\.08 rad/)).toBeVisible();
  const submit=page.getByRole('button',{name:'Submit coherent witness to IBM'});
  await expect(submit).toBeVisible();
  if(await page.getByText(/IBM runs are disabled on this server/).isVisible())
    await expect(submit).toBeDisabled();
  await page.getByRole('radio',{name:/Qiskit Aer simulator/}).check();
  await page.getByLabel('Noise scenario').selectOption('mixed');
  await expect(page.getByLabel('Coherent ZZ kick')).toHaveValue('0.08');
  await page.getByRole('button',{name:'Run on Aer'}).click();
  await expect(page.getByText('QISKIT AER SIMULATION')).toBeVisible({timeout:60000});
  await page.getByLabel('Noise scenario').selectOption('clean');
  await expect(page.getByLabel('Coherent ZZ kick')).toHaveValue('0');
  await page.getByRole('button',{name:'Run on Aer'}).click();
  await expect(page.getByRole('heading',{name:'Runs in this session'})).toBeVisible({timeout:60000});
  await expect(page.locator('.tw-compare tbody tr')).toHaveCount(2);
  await expect(page.getByRole('cell',{name:'Both kinds at once'})).toBeVisible();
  await expect(page.getByRole('cell',{name:'No noise at all'})).toBeVisible();
});
test('IBM results appear as soon as the job completes',async({page})=>{
  const datasetId='twirl_ibm_quebec_20261007-191500';
  const runId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const arm={magnetization:0.62,standard_error:0.02,error:0.38,spread:0.01,total_variation:0.2,
    shots:512,values:[0.6,0.64],per_qubit:[0.62,0.62],distribution:{'00':0.81,'01':0.09,'10':0.09,'11':0.01}};
  const twirled={...arm,magnetization:0.91,error:0.09,values:[0.88,0.94],per_qubit:[0.91,0.91],
    distribution:{'00':0.955,'01':0.02,'10':0.02,'11':0.005}};
  const dataset={id:datasetId,backend:'ibm_quebec',simulated:false,experiment:'witness',qubits:2,steps:6,
    field:0,randomizations:2,shots:256,job_id:'job-demo',layout:[0,1],two_qubit_gates:12,
    created:'2026-10-07T19:15:00',scenario:'hardware',scenario_label:'IBM ibm_quebec coherent witness',
    ideal:{magnetization:1,per_qubit:[1,1],distribution:{'00':1,'01':0,'10':0,'11':0}},
    exact:{magnetization:1,per_qubit:[1,1]},unmitigated:arm,twirled,
    comparison:{significant:true,error_change:0.29,shift:0.29,uncertainty:0.1,improved:true,unchanged:false}};
  let polls=0;
  await page.route('**/api/twirl/**',async route=>{
    const url=route.request().url();
    const method=route.request().method();
    const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    if(url.includes('/api/twirl/hardware/runs/')&&method==='GET'){
      polls+=1;
      const status=polls<2?'queued':'completed';
      return reply({id:runId,status,backend:'ibm_quebec',job_id:'job-demo',layout:[0,1],
        dataset_id:status==='completed'?datasetId:undefined});
    }
    if(url.endsWith('/api/twirl/hardware/runs')&&method==='POST')
      return reply({id:runId,status:'submitting',experiment:'witness'},202);
    if(url.includes('/api/twirl/hardware/'+datasetId))return reply(dataset);
    if(/\/api\/twirl\/hardware\/?$/.test(new URL(url).pathname)&&method==='GET')
      return reply({ibm_enabled:true,datasets:[{id:datasetId,backend:'ibm_quebec',simulated:false,
        qubits:2,steps:6,randomizations:2,shots:256,experiment:'witness',job_id:'job-demo',
        created:'2026-10-07T19:15:00'}]});
    if(url.includes('/api/twirl/scenarios')){
      const original=await route.fetch();
      return reply({...await original.json(),ibm_enabled:true});
    }
    return route.continue();
  });
  await openTwirl(page);
  await page.getByRole('button',{name:'Twirl lab: Aer or IBM'}).click();
  await page.getByRole('radio',{name:/IBM quantum computer/}).check();
  await page.getByRole('button',{name:'Submit coherent witness to IBM'}).click();
  await expect(page.getByText(/Status: queued/)).toBeVisible({timeout:10000});
  await expect(page.getByText(/Status: completed/)).toBeVisible({timeout:15000});
  await expect(page.getByText('IBM QPU MEASUREMENTS')).toBeVisible();
  await expect(page.getByLabel('ibm_quebec hardware readout')).toBeVisible();
  await expect(page.getByText('✓ Twirling moved the answer towards the ideal value.')).toBeVisible();
});
test('mobile layout does not overflow',async({page})=>{
  await page.setViewportSize({width:360,height:800});
  await openTwirl(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Level 1: The same circuit twice'}).click();
  await expect(page.getByRole('img',{name:'Bare circuit diagram'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Twirl lab: Aer or IBM'}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('backend errors are shown in the twirl lab',async({page})=>{
  await openTwirl(page);
  await page.getByRole('button',{name:'Level 2: The drifting quench'}).click();
  await page.route('**/api/twirl/play',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'Test backend unavailable'})}));
  await page.getByRole('button',{name:'Run both treatments'}).click();
  await expect(page.getByRole('alert')).toContainText('Test backend unavailable');
});
