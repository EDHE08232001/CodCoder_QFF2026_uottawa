import {test,expect} from '@playwright/test';
async function openZNE(page){
  await page.goto('/');
  await page.getByRole('button',{name:'✦ Tool quiz',exact:true}).click();
  await page.getByRole('button',{name:'B ZNE',exact:true}).click();
  await page.getByRole('button',{name:'Try it yourself →',exact:true}).click();
}
test('mission feedback and progress survive navigation',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'✦ Tool quiz',exact:true}).click();
  await page.getByRole('button',{name:'A Dynamical Decoupling',exact:true}).click();
  await expect(page.getByText('0 / 6 completed')).toBeVisible();
  await expect(page.getByText('Try again — here is a clue.')).toBeVisible();
  await page.getByRole('button',{name:'B ZNE',exact:true}).click();
  await expect(page.getByText('✓ Mission complete',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Next mission →',exact:true}).click();
  await page.getByRole('button',{name:'Mission 1, completed',exact:true}).click();
  await expect(page.getByText('✓ Mission complete',{exact:true})).toBeVisible();
});
test('learn, measure, guess and reveal in both levels',async({page})=>{
  await openZNE(page);
  await expect(page.getByRole('heading',{name:'ZNE Noise Detective'})).toBeVisible();
  for(const level of ['linear','exponential']){
    await page.getByLabel('Learning level').selectOption(level);
    await page.getByRole('button',{name:'Start experiment',exact:true}).click();
    await expect(page.getByText(/Status: completed/)).toBeVisible();
    await page.getByRole('button',{name:'Show 1× measurement'}).click();
    await page.getByRole('button',{name:'Show 3× measurement'}).click();
    await page.getByRole('button',{name:'Show 5× measurement'}).click();
    const slider=page.getByRole('slider',{name:'Zero-noise guess'});
    await slider.press('End');
    for(let step=0;step<10;step++) await slider.press('ArrowLeft');
    await page.getByRole('button',{name:'Submit guess and reveal'}).click();
    await expect(page.getByText('Reference value 0.900')).toBeVisible();
    await expect(page.getByText('Your error 0.000')).toBeVisible();
  }
});
test('mobile layout fits and backend errors are visible',async({page})=>{
  await page.setViewportSize({width:360,height:800});
  await openZNE(page);
  await expect(page.getByRole('button',{name:'Start experiment',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.route('**/api/runs',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'Test backend unavailable'})}));
  await page.getByRole('button',{name:'Start experiment',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Test backend unavailable');
});
