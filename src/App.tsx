import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LayoutFileSchema, type LayoutFile } from "./lib/types";
import "./App.css";

// Placeholder shell proving the IPC contract works end-to-end.
// The real UI is built by Worker C; see docs/CONTRACT.md.
function App() {
  const [layout, setLayout] = useState<LayoutFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke("load_layout")
      .then((raw) => setLayout(LayoutFileSchema.parse(raw)))
      .catch((e) => setError(JSON.stringify(e)));
  }, []);

  return (
    <main className="container">
      <h1>QMK Flasher</h1>
      {error && <p role="alert">Failed to load layout: {error}</p>}
      {layout ? (
        <>
          <p>
            <strong>{layout.meta.name}</strong> (Oryx{" "}
            {layout.meta.seededFrom.layoutId}/
            {layout.meta.seededFrom.revisionHash}, QMK{" "}
            {layout.meta.seededFrom.qmkVersion}) — {layout.layers.length}{" "}
            layers, {layout.combos.length} combos
          </p>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {layout.layers.map((layer, i) => (
              <li key={i}>
                <span
                  style={{
                    display: "inline-block",
                    width: "0.8em",
                    height: "0.8em",
                    background: layer.color,
                    marginRight: "0.5em",
                  }}
                />
                Layer {i}: {layer.title} ({layer.keys.length} keys)
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
