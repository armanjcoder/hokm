export function AbandonedNotice({ onNewTable }: { onNewTable: () => void }) {
  return (
    <section className="panel">
      <h2>این میز رها شده است</h2>
      <p>همه بازیکنان میز را ترک کرده‌اند. یک میز جدید بساز.</p>
      {/* Purely local: the server rejects actions on an abandoned table. */}
      <button className="primary" type="button" onClick={onNewTable}>
        ساخت میز جدید
      </button>
    </section>
  );
}
