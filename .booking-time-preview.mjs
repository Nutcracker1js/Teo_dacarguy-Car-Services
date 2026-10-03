export default async function run(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.locator("#booking-time").waitFor();
  await page.locator("#booking-time").scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.screenshot({ path: "C:/Users/USER/AppData/Local/Temp/teo-time-control.png" });
  return await page.evaluate(() => ({
    type: document.querySelector("#booking-time").type,
    min: document.querySelector("#booking-time").min,
    max: document.querySelector("#booking-time").max,
    size: (() => { const box = document.querySelector("#booking-time").getBoundingClientRect(); return { width: Math.round(box.width), height: Math.round(box.height) }; })(),
  }));
}
