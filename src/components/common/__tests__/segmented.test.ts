import { fitColumns } from '../Segmented';

describe('Segmented column fit (360 px + large text cut "Tab…", "Yemekten ö…")', () => {
  const units = ['Tablet', 'Kapsül', 'ml', 'Damla', 'Puf', 'Ölçek', 'Ünite', 'İğne', 'Yama', 'Fitil', 'mg', 'Diğer'];
  it('drops columns until the longest word fits', () => {
    expect(fitColumns(units, 4, 390 - 64, 16)).toBe(4); // normal text on a regular phone
    expect(fitColumns(units, 4, 360 - 64, 20)).toBe(3); // elderly text on a small phone
  });
  it('multi-word labels may wrap, so only the longest word counts', () => {
    expect(fitColumns(['Fark etmez', 'Aç karnına', 'Yemekten önce', 'Yemekle', 'Yemekten sonra'], 2, 360 - 64, 20)).toBe(2);
  });
  it('never below one column', () => {
    expect(fitColumns(['Supercalifragilistic'], 3, 100, 30)).toBe(1);
  });
});
