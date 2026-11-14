import React, { useRef, useState } from 'react';
import { Medication } from '../types/models';
import { storageService } from '../services/storageService';
import { BottomSheetNumberPicker } from '../components/common/BottomSheetNumberPicker';
import { choose } from '../utils/confirm';
import { t } from '../localization/i18n';
import { useToast } from './useToast';

/**
 * "+1 kutu" for a saved medication. The box size is asked once (number sheet) and then stored
 * on the stock. Render `sheet` somewhere in the screen.
 */
export const useStockBox = () => {
  const { showToast } = useToast();
  const [asking, setAsking] = useState(false);
  const pending = useRef<{ med: Medication; done: (m: Medication | null) => void } | null>(null);

  const apply = async (med: Medication, boxSize: number) => {
    const updated = await storageService.addStockBox(med.id, boxSize);
    if (updated?.stock) showToast({ message: t('stock_box.added', { count: boxSize, remaining: updated.stock.remaining }), type: 'success' });
    return updated;
  };

  /** Adds one box; resolves with the updated medication, or null if cancelled. */
  const addBox = (med: Medication): Promise<Medication | null> => {
    const size = med.stock?.boxSize;
    if (size) return apply(med, size);
    return new Promise(done => { pending.current = { med, done }; setAsking(true); });
  };

  // The sheet calls onConfirm and then onClose; only the first one counts.
  const finish = async (size?: number) => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    setAsking(false);
    p.done(size ? await apply(p.med, size) : null);
  };

  /** After "Aldım" on a medication whose stock had run out: offer to refill. Resolves when handled. */
  const promptStockOut = async (med: Medication, enterStock: () => void) => {
    const i = await choose(t('stock_box.out_title'), t('stock_box.out_body', { name: med.name }), [
      t('stock_box.add_box'), t('stock_box.enter_stock'), t('common.close'),
    ]);
    if (i === 0) await addBox(med);
    else if (i === 1) enterStock();
  };

  const sheet = (
    <BottomSheetNumberPicker
      isVisible={asking}
      onClose={() => finish()}
      title={t('stock_box.size_question')}
      initialValue={28}
      min={1}
      max={1000}
      presets={[10, 14, 20, 28, 30, 60]}
      presetMode="set"
      onConfirm={v => finish(v)}
    />
  );

  return { addBox, promptStockOut, sheet };
};
