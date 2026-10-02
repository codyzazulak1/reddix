"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="standalone-error">
      <h1>Something didn’t load.</h1>
      <p>Your content is safe. Give it another try.</p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
