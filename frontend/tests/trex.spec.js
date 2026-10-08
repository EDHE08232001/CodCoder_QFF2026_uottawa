import {test,expect} from '@playwright/test';
async function openTRex(page){
  await page.goto('/');
  await page.getByRole('button',{name:'▦ Explore tools',exact:true}).click();
  await page.locator('.tool-card',{hasText:'Readout Mitigation'}).getByRole('button',{name:'Try this mini-game →'}).click();
  await expect(page.getByRole('heading',{name:'Detector Decoder'})).toBeVisible();
}
test('toolkit card opens the lab and the Learn playground corrects a biased coin',async({page})=>{
  await openTRex(page);
  await expect(page.getByRole('heading',{name:'What is readout mitigation?'})).toBeVisible();
  await expect(page.getByText(/Total variation: raw/)).toBeVisible();
  await page.getByRole('button',{name:'Start level 1 →'}).click();
  await expect(page.getByRole('heading',{name:'The biased detector'})).toBeVisible();
});
test('level 1: the biased detector passes on the first run',async({page})=>{
  await openTRex(page);
  await page.getByRole('button',{name:'Level 1: The biased detector'}).click();
  await page.getByRole('button',{name:'Calibrate and correct'}).click();
  await expect(page.getByText('✓ Level complete!')).toBeVisible();
  await expect(page.getByRole('button',{name:'Level 1: The biased detector, completed'})).toBeVisible();
  await expect(page.getByText('1 / 4 levels complete')).toBeVisible();
});
test('level 3: tensored calibration fails, correlated fixes it',async({page})=>{
  await openTRex(page);
  await page.getByRole('button',{name:'Level 3: Two detectors gossip'}).click();
  await page.getByRole('button',{name:'Calibrate and correct'}).click();
  await expect(page.getByText('Not yet.')).toBeVisible();
  await page.getByLabel('Correlated (every basis state)').check();
  await page.getByRole('button',{name:'Run again'}).click();
  await expect(page.getByText('✓ Level complete!')).toBeVisible();
  await page.getByRole('button',{name:/B It assumes every qubit misreads independently/}).click();
  await expect(page.getByText('✓ Correct!')).toBeVisible();
  await expect(page.getByText('1 / 4 levels complete')).toBeVisible();
});
test('level 4: direct inversion goes negative, nnls stays physical',async({page})=>{
  await openTRex(page);
  await page.getByRole('button',{name:'Level 4: Correct the entangled state'}).click();
  await page.getByRole('button',{name:'Calibrate and correct'}).click();
  await expect(page.getByText(/unphysical, but mathematically exact/)).toBeVisible();
  await expect(page.getByText('✓ Level complete!')).toBeVisible();
  await page.getByRole('button',{name:/A It introduces a small bias/}).click();
  await expect(page.getByText('✓ Correct!')).toBeVisible();
});
test('sandbox, IBM lab and mobile layout',async({page})=>{
  await page.setViewportSize({width:360,height:800});
  await openTRex(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Calibration sandbox'}).click();
  await expect(page.getByText(/Total variation: raw/)).toBeVisible();
  await page.getByLabel('Qubits').selectOption('1');
  await page.getByLabel('Target').selectOption('bias');
  await page.getByRole('button',{name:'Run'}).click();
  await expect(page.getByText(/Total variation: raw/)).toBeVisible();
  await page.getByRole('button',{name:'IBM hardware lab'}).click();
  await expect(page.getByText('No saved hardware runs yet.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Submit to IBM'})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('backend errors are shown in the lab',async({page})=>{
  await openTRex(page);
  await page.getByRole('button',{name:'Level 1: The biased detector'}).click();
  await page.route('**/api/trex/play',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'Test backend unavailable'})}));
  await page.getByRole('button',{name:'Calibrate and correct'}).click();
  await expect(page.getByRole('alert')).toContainText('Test backend unavailable');
});
