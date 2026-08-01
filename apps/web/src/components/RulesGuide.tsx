import { useEffect, useRef } from 'react';
import type { GameMode } from '@hokm/game-engine';

/**
 * Very short rules for each variant.
 *
 * Deliberately terse: a player opens this mid-lobby and needs the gist in a few
 * seconds, not a manual. Only what differs or decides the game is listed.
 */
/** Shown under every guide when the host enabled the optional redeal rule. */
export const LOW_HAND_RULE =
  'ده‌لو کم: اگر ۵ کارت اول حاکم هیچ کارت عکس‌داری (تک، شاه، بی‌بی، سرباز) نداشت، می‌تواند بخواهد دوباره پخش شود.';

export const BAM_RULE =
  'بام: بازی بعد از ۷ دست ادامه پیدا می‌کند. هرکس همه دست‌ها را ببرد، همان‌جا کل بازی را می‌برد.';

const GUIDES: Record<GameMode, { title: string; steps: string[]; key: string }> = {
  classic4: {
    title: 'حکم ۴ نفره',
    steps: [
      'دو تیم: صندلی ۱ و ۳ مقابل ۲ و ۴.',
      'به هرکس ۱۳ کارت می‌رسد. حاکم خال حکم را می‌گوید.',
      'باید همان خالِ زمینه را بازی کنی؛ نداری، با حکم می‌بُری یا رد می‌دهی.',
      'هر تیم زودتر ۷ دست بگیرد، راند را برده.',
    ],
    key: 'اگر حریف هیچ دستی نبَرد، کوت می‌شود و ۲ امتیاز می‌گیری.',
  },
  solo3: {
    title: 'حکم ۳ نفره',
    steps: [
      'هرکس برای خودش بازی می‌کند؛ یار نداری.',
      'یک کارت ۲ حذف می‌شود تا به هرکس ۱۷ کارت برسد.',
      'بقیه قوانین دقیقاً مثل حکم ۴ نفره است.',
      'هرکس زودتر ۷ دست بگیرد، راند را برده.',
    ],
    key: 'کارتی که حذف می‌شود هیچ‌وقت از خال حکم نیست.',
  },
  duel2: {
    title: 'حکم ۲ نفره',
    steps: [
      'به هرکس ۵ کارت می‌رسد و حاکم حکم را می‌گوید.',
      'هر دو نفر ۲ کارت ضعیف خود را می‌سوزانند.',
      'نوبتی از دسته کارت برمی‌دارید تا هرکدام ۱۳ کارت شوید.',
      'بعد بازی معمولی؛ هرکس زودتر ۷ دست بگیرد، برنده است.',
    ],
    key: 'موقع برداشتن: نگه داری، کارت بعدی سوزانده می‌شود. بسوزانی، کارت بعدی را ندیده باید برداری.',
  },
};

export function RulesGuide({
  mode,
  lowHandRedeal = false,
  bam = false,
  onClose,
}: {
  mode: GameMode;
  /** Only mention the optional rules this table actually uses. */
  lowHandRedeal?: boolean;
  bam?: boolean;
  onClose: () => void;
}) {
  const guide = GUIDES[mode] ?? GUIDES.classic4;
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // A modal dialog must own the keyboard while it is open: Escape closes it and
  // Tab cycles inside it, otherwise focus wanders onto the page behind.
  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = sheetRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="rules-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rules-title"
      onClick={onClose}
    >
      {/* Stop clicks inside the sheet from closing it. */}
      <div ref={sheetRef} className="rules-sheet" onClick={(event) => event.stopPropagation()}>
        <h2 id="rules-title">{guide.title}</h2>
        <ol className="rules-steps">
          {guide.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="rules-key">{guide.key}</p>
        {lowHandRedeal && <p className="rules-key">{LOW_HAND_RULE}</p>}
        {bam && <p className="rules-key">{BAM_RULE}</p>}
        <button ref={closeRef} className="primary full-width" type="button" onClick={onClose}>
          فهمیدم
        </button>
      </div>
    </div>
  );
}
