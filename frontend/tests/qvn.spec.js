import {test,expect} from '@playwright/test';
const KEY='codfish-qubits-vs-noise:v1';
async function seed(page,progress){
  await page.addInitScript(([key,value])=>localStorage.setItem(key,value),[KEY,JSON.stringify({unlocked:1,stars:{},bestEndless:0,bonusShots:0,muted:true,autoCollect:false,...progress})]);
}
async function startMission(page){
  await page.goto('/');
  await page.getByRole('button',{name:'▶ Start mission',exact:true}).click();
}
// Clicks the centre of a battlefield tile (9 columns × 5 rows in a 1020 × 500 field).
async function clickTile(page,row,col){
  const box=await page.locator('canvas.qn-field').boundingBox();
  await page.mouse.click(box.x+(130+90*col+45)*box.width/1020,box.y+(100*row+50)*box.height/500);
}
test('start mission opens the level 1 briefing, then the battlefield',async({page})=>{
  await seed(page,{});
  await startMission(page);
  await expect(page.getByRole('region',{name:'Mission briefing: Hello, Noise'})).toBeVisible();
  await expect(page.getByText('QUBITS VS NOISE · LEVEL 01 / 07')).toBeVisible();
  await expect(page.getByRole('button',{name:'Level 2: Idle Hands, locked'})).toBeDisabled();
  await expect(page.getByText('0 / 7 cleared · ★ 0 / 21')).toBeVisible();
  await page.getByRole('button',{name:'▶ Start defending!'}).click();
  await expect(page.locator('canvas.qn-field')).toBeVisible();
  await expect(page.locator('.qn-shots strong')).toHaveText('150');
  await page.keyboard.press('1');
  await expect(page.getByRole('button',{name:'Shot Sampler, 50 shots'})).toHaveAttribute('aria-pressed','true');
  await clickTile(page,2,0);
  await expect(page.locator('.qn-shots strong')).toHaveText('100');
  await expect(page.getByRole('button',{name:'Shot Sampler, 50 shots'})).toHaveAttribute('aria-pressed','false');
  await page.getByRole('button',{name:'Zero-Noise Extrapolation, 125 shots'}).click();
  await expect(page.getByText('Not enough Shots')).toBeVisible();
});
test('pause menu, almanac and how to play keep the run',async({page})=>{
  await seed(page,{});
  await startMission(page);
  await page.getByRole('button',{name:'▶ Start defending!'}).click();
  await page.keyboard.press('p');
  await expect(page.getByRole('dialog',{name:'Paused'})).toBeVisible();
  await page.getByRole('button',{name:'Quantum Almanac'}).click();
  await page.getByRole('button',{name:'Matchups'}).click();
  await expect(page.getByText('Special rules')).toBeVisible();
  await page.getByRole('button',{name:'← Back to pause menu'}).click();
  await page.getByRole('button',{name:'▶ Resume'}).click();
  await expect(page.getByRole('dialog',{name:'Paused'})).toBeHidden();
  // Leaving for How to play pauses the running level instead of losing it.
  await page.getByRole('button',{name:'How to play'}).click();
  await expect(page.getByRole('heading',{name:'How to play'})).toBeVisible();
  await page.getByRole('button',{name:'← Back to the game'}).click();
  await expect(page.getByRole('dialog',{name:'Paused'})).toBeVisible();
  await page.getByRole('button',{name:'← Quit to main menu'}).click();
  await expect(page.getByRole('button',{name:'▶ Start mission',exact:true})).toBeVisible();
});
test('saved progress, level chips and lab links',async({page})=>{
  await seed(page,{unlocked:4,stars:{1:3,2:2,3:1}});
  await startMission(page);
  await expect(page.getByRole('region',{name:'Mission briefing: Coherent Chaos'})).toBeVisible();
  await expect(page.getByText('3 / 7 cleared · ★ 6 / 21')).toBeVisible();
  await page.getByRole('button',{name:'Level 2: Idle Hands, completed, 2 of 3 stars'}).click();
  await expect(page.getByRole('region',{name:'Mission briefing: Idle Hands'})).toBeVisible();
  await page.getByRole('button',{name:'Open the Pulse Patrol lab →'}).click();
  await expect(page.getByRole('heading',{name:'Pulse Patrol'})).toBeVisible();
  await page.getByRole('button',{name:'← Qubits vs Noise'}).click();
  await expect(page.getByRole('region',{name:'Mission briefing: Idle Hands'})).toBeVisible();
});
test('mobile layout fits',async({page})=>{
  await seed(page,{});
  await page.setViewportSize({width:360,height:800});
  await startMission(page);
  await expect(page.getByRole('button',{name:'▶ Start defending!'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:'▶ Start defending!'}).click();
  await expect(page.locator('canvas.qn-field')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
