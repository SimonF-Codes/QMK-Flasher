import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SeededLayoutSchema, type SeededLayout } from "./lib/types";
import "./App.css";

// Placeholder shell proving the IPC contract works end-to-end.
// The real UI is built by the UI worker; see docs/CONTRACT.md.
function App() {
  const [layout, setLayout] = useState<SeededLayout | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke("get_layout")
      .then((raw) => setLayout(SeededLayoutSchema.parse(raw)))
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <main className="container">
      <h1>QMK Flasher</h1>
      {error && <p role="alert">Failed to load layout: {error}</p>}
      {layout ? (
        <>
          <p>
            Loaded <strong>{layout.keyboard}</strong> / {layout.keymap} (
            {layout.layout_macro}, {layout.key_count} keys)
          </p>
          <ul>
            {layout.layers.map((layer) => (
              <li key={layer.index}>
                {layer.name}: {layer.keys.join(" ")}
              </li>
            ))}
          </ul>
        </>
      ) : (
        !error && <p>Loading layout…</p>
      )}
    </main>
  );
}

export default App;
