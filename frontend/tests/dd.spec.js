import {test,expect} from '@playwright/test';
async function openDD(page){
  await page.goto('/');
  await page.getByRole('button',{name:'✦ Tool quiz',exact:true}).click();
  await page.getByRole('button',{name:'Mission 2',exact:true}).click();
  await page.getByRole('button',{name:'C Dynamical Decoupling',exact:true}).click();
  await page.getByRole('button',{name:'Try it yourself →',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Pulse Patrol'})).toBeVisible();
}
async function run(page){
  await page.getByRole('button',{name:/^(Run the idle window|Run again)$/}).click();
}
test('toolkit card opens the DD lab and the flip playground echoes',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'▦ Explore tools',exact:true}).click();
  await page.locator('.tool-card',{hasText:'Dynamical Decoupling'}).getByRole('button',{name:'Try this mini-game →'}).click();
  await expect(page.getByRole('heading',{name:'What is dynamical decoupling?'})).toBeVisible();
  await page.getByRole('button',{name:'▶ Start the clock'}).click();
  await page.waitForTimeout(600);
  await page.getByRole('button',{name:'⚡ Flip now (π pulse)'}).click();
  await expect(page.getByText(/Watch for the echo at/)).toBeVisible();
  await expect(page.getByText(/Echo! The crew regrouped/)).toBeVisible({timeout:12000});
});
test('level 1: only a centred echo pulse passes',async({page})=>{
  await openDD(page);
  await page.getByRole('button',{name:'Level 1: The spin echo'}).click();
  await page.getByLabel('Pulse position').fill('30');
  await run(page);
  await expect(page.getByText('Not yet. Here is a clue.')).toBeVisible();
  await expect(page.getByText(/waits 12\.0 µs before the flip and 28\.0 µs after it/)).toBeVisible();
  await page.getByLabel('Pulse position').fill('50');
  await run(page);
  await expect(page.getByText('✓ Level complete!')).toBeVisible();
  await expect(page.getByLabel('3 of 3 stars')).toBeVisible();
  await expect(page.getByRole('button',{name:'Level 1: The spin echo, completed'})).toBeVisible();
  await expect(page.getByText('1 / 5 levels complete')).toBeVisible();
});
test('level 2: timeline editing and an even pulse train',async({page})=>{
  await openDD(page);
  await page.getByRole('button',{name:'Level 2: Drifting noise'}).click();
  const track=page.getByRole('group',{name:/Idle window timeline/});
  const box=await track.boundingBox();
  await track.click({position:{x:box.width*0.5,y:box.height*0.8}});
  await expect(page.getByRole('button',{name:/^Pulse 1 at 50% \(X\)/})).toBeVisible();
  await run(page);
  await expect(page.getByText('Not yet. Here is a clue.')).toBeVisible();
  await page.getByRole('button',{name:/^Pulse 1 at 50% \(X\)/}).click();
  await expect(page.getByRole('button',{name:/^Pulse 1 at/})).toHaveCount(0);
  await page.getByRole('button',{name:'Spread evenly'}).click();
  await expect(page.getByRole('button',{name:/^Pulse \d+ at/})).toHaveCount(10);
  await run(page);
  await expect(page.getByText('✓ Level complete!')).toBeVisible();
  await expect(page.getByRole('button',{name:'Load CPMG (10)'})).toBeVisible();
});
test('level 3: alternating axes beats pulse errors',async({page})=>{
  await openDD(page);
  await page.getByRole('button',{name:'Level 3: Wobbly pulses'}).click();
  await run(page);
  await expect(page.getByText(/Your pattern: X{16}\./)).toBeVisible();
  await page.getByRole('button',{name:/^Pulse 2 at .* \(X\)\. Switch axis/}).click();
  await expect(page.getByRole('button',{name:/^Pulse 2 at .* \(Y\)\. Switch axis/})).toBeVisible();
  await page.getByRole('button',{name:'Alternate X / Y'}).click();
  await run(page);
  await expect(page.getByText('✓ Level complete!')).toBeVisible();
});
test('level 4 and 5: quizzes complete the course',async({page})=>{
  await openDD(page);
  await page.getByRole('button',{name:'Level 4: Fast noise'}).click();
  await page.getByRole('button',{name:'Spread evenly'}).click();
  await run(page);
  await expect(page.getByText('No sequence beats this noise.')).toBeVisible();
  await page.getByRole('button',{name:/B The pulses must alternate/}).click();
  await expect(page.getByText('Not quite.')).toBeVisible();
  await page.getByRole('button',{name:/A The noise changes faster/}).click();
  await expect(page.getByText('✓ Level complete!').first()).toBeVisible();
  await page.getByRole('button',{name:'Level 5: Real IBM data'}).click();
  await expect(page.getByText(/ibm_quebec/).first()).toBeVisible();
  await expect(page.getByRole('img',{name:/P\(0\) versus idle time on ibm_quebec/})).toBeVisible();
  await page.getByRole('button',{name:/A A steady frequency offset/}).click();
  await page.getByRole('button',{name:/B Readout and gate errors/}).click();
  await expect(page.getByText('✓ Level complete!')).toBeVisible();
  await expect(page.getByText('2 / 5 levels complete')).toBeVisible();
});
test('sandbox, IBM lab and mobile layout',async({page})=>{
  await page.setViewportSize({width:360,height:800});
  await openDD(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Sequence sandbox'}).click();
  await expect(page.getByRole('img',{name:/Signal versus idle time, 1\/f noise/})).toBeVisible();
  await page.getByLabel('Model').selectOption('circuit');
  await page.getByLabel('Noise type').selectOption('white');
  await page.getByRole('button',{name:'Run simulation'}).click();
  await expect(page.getByText('EXACT CIRCUIT SIMULATION')).toBeVisible();
  await expect(page.getByRole('img',{name:/white noise/})).toBeVisible();
  await page.getByRole('button',{name:'IBM hardware lab'}).click();
  await expect(page.getByLabel('Dataset')).toContainText('ibm_quebec');
  await expect(page.getByRole('button',{name:'Submit to IBM'})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('backend errors are shown in the DD lab',async({page})=>{
  await openDD(page);
  await page.getByRole('button',{name:'Level 1: The spin echo'}).click();
  await page.route('**/api/dd/play',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'Test backend unavailable'})}));
  await run(page);
  await expect(page.getByRole('alert')).toContainText('Test backend unavailable');
});
