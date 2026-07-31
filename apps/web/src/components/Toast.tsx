export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <button className="toast" type="button" role="alert" onClick={onDismiss}>
      {message}
    </button>
  );
}
