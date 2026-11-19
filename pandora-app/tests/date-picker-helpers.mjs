export async function selectPickerYear(page, year) {
  const target = Number(year), field = page.locator('[data-picker-year-choice]');
  while (Number(await field.inputValue()) !== target) {
    const years = await field.locator('option').evaluateAll(options => options.map(option => Number(option.value)));
    const next = Math.max(years[0], Math.min(target, years.at(-1)));
    if (next === Number(await field.inputValue())) throw new Error(`Year ${target} is outside the supported range`);
    await field.selectOption(String(next));
  }
}
