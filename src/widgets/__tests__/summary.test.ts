import { computeWidgetSummary } from '../summary';
import { Dose, Medication, MedicationStatus } from '../../types/models';

const med = (name: string) => ({ id: name, name } as Medication);
const dose = (name: string, time: string, taken = false): Dose => ({
  medication: med(name), date: '2026-09-29', time, key: `${name}|${time}`,
  log: taken ? ({ status: MedicationStatus.Taken } as any) : undefined,
});
const base = { waterMl: 1000, goalMl: 2000, ceilingMl: 4000, glassMl: 250, doses: [] as Dose[], now: new Date('2026-09-29T12:00:00') };

test('water percent, goal and ceiling', () => {
  expect(computeWidgetSummary(base)).toMatchObject({ percent: 50, goalMet: false, canAddGlass: true });
  expect(computeWidgetSummary({ ...base, waterMl: 2500 })).toMatchObject({ percent: 100, goalMet: true });
  expect(computeWidgetSummary({ ...base, waterMl: 3800 }).canAddGlass).toBe(false);
  expect(computeWidgetSummary({ ...base, waterMl: 3750 }).canAddGlass).toBe(true);
  // ceiling is raw volume: 3800 ml of coffee counts as ~3040 hydration but still blocks another glass
  expect(computeWidgetSummary({ ...base, waterMl: 3040, fluidMl: 3800 }).canAddGlass).toBe(false);
});

test('next and overdue doses (15 min grace)', () => {
  const s = computeWidgetSummary({ ...base, doses: [dose('A', '08:00', true), dose('B', '11:00'), dose('C', '11:50'), dose('D', '20:00')] });
  expect(s.overdue).toEqual({ name: 'B', time: '11:00', count: 1 });
  expect(s.nextDose).toEqual({ name: 'C', time: '11:50' }); // still within grace
  expect(s.allDosesDone).toBe(false);
});

test('all done / no doses', () => {
  const done = computeWidgetSummary({ ...base, doses: [dose('A', '08:00', true)] });
  expect(done).toMatchObject({ allDosesDone: true, nextDose: null, overdue: null });
  expect(computeWidgetSummary(base)).toMatchObject({ allDosesDone: false, dosesToday: 0 });
});
