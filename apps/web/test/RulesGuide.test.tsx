import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RulesGuide } from '../src/components/RulesGuide.js';

afterEach(cleanup);

describe('RulesGuide', () => {
  it('shows the guide for the selected mode only', () => {
    render(<RulesGuide mode="duel2" onClose={() => {}} />);
    expect(screen.getByText('حکم ۲ نفره')).toBeDefined();
    expect(screen.queryByText('حکم ۳ نفره')).toBeNull();
    expect(screen.queryByText('حکم ۴ نفره')).toBeNull();
  });

  it.each([
    ['classic4', 'حکم ۴ نفره'],
    ['solo3', 'حکم ۳ نفره'],
    ['duel2', 'حکم ۲ نفره'],
  ] as const)('renders the %s guide', (mode, title) => {
    render(<RulesGuide mode={mode} onClose={() => {}} />);
    expect(screen.getByText(title)).toBeDefined();
  });

  it('stays short so it can be read at a glance', () => {
    for (const mode of ['classic4', 'solo3', 'duel2'] as const) {
      cleanup();
      render(<RulesGuide mode={mode} onClose={() => {}} />);
      const steps = screen.getAllByRole('listitem');
      expect(steps.length).toBeLessThanOrEqual(4);
      for (const step of steps) {
        expect((step.textContent ?? '').length).toBeLessThan(90);
      }
    }
  });

  it('mentions the rule that decides the two player game', () => {
    render(<RulesGuide mode="duel2" onClose={() => {}} />);
    expect(screen.getByText(/کارت بعدی را ندیده باید برداری/)).toBeDefined();
  });

  it('explains that the removed card is never trump in the three player game', () => {
    render(<RulesGuide mode="solo3" onClose={() => {}} />);
    expect(screen.getByText(/هیچ‌وقت از خال حکم نیست/)).toBeDefined();
  });

  it('closes from the button and from the backdrop', () => {
    const onClose = vi.fn();
    const { container } = render(<RulesGuide mode="classic4" onClose={onClose} />);
    fireEvent.click(screen.getByText('فهمیدم'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector('.rules-backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('does not close when clicking inside the sheet', () => {
    const onClose = vi.fn();
    const { container } = render(<RulesGuide mode="classic4" onClose={onClose} />);
    fireEvent.click(container.querySelector('.rules-sheet')!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('is an accessible dialog', () => {
    render(<RulesGuide mode="solo3" onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('rules-title');
  });
});

describe('TopBar help button', () => {
  it('exposes an accessible always-available help control', async () => {
    const { TopBar } = await import('../src/components/TopBar.js');
    const showRules = vi.fn();
    render(
      <TopBar
        room={{ id: 'r', code: 'ABCDE', status: 'playing', players: [] }}
        me={undefined}
        apiUrl="https://x"
        connection="connected"
        showRules={showRules}
        showProfile={() => {}}
      />,
    );
    const help = screen.getByLabelText('راهنمای قوانین');
    fireEvent.click(help);
    expect(showRules).toHaveBeenCalledTimes(1);
  });
});

describe('optional rule note', () => {
  it('is hidden when the table does not use the redeal rule', () => {
    render(<RulesGuide mode="classic4" onClose={() => {}} />);
    expect(screen.queryByText(/ده‌لو کم/)).toBeNull();
  });

  it('is shown when the host enabled it', () => {
    render(<RulesGuide mode="classic4" lowHandRedeal onClose={() => {}} />);
    expect(screen.getByText(/ده‌لو کم/)).toBeDefined();
  });
});

describe('bam rule note', () => {
  it('is hidden when the table does not use bam', () => {
    render(<RulesGuide mode="classic4" onClose={() => {}} />);
    expect(screen.queryByText(/^بام:/)).toBeNull();
  });

  it('is shown when the host enabled bam', () => {
    render(<RulesGuide mode="classic4" bam onClose={() => {}} />);
    expect(screen.getByText(/^بام:/)).toBeDefined();
  });
});
