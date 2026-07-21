import { GEOMETRY, viewBox } from "../lib/geometry";
import { useDisplayStore } from "../state/displayStore";
import { useLayoutStore } from "../state/layoutStore";
import Key from "./Key";

const VIEW_BOX = viewBox();

export default function Keyboard() {
  const layout = useLayoutStore((s) => s.layout);
  const selectedLayer = useLayoutStore((s) => s.selectedLayer);
  const selectedKey = useLayoutStore((s) => s.selectedKey);
  const selectKey = useLayoutStore((s) => s.selectKey);
  const mode = useDisplayStore((s) => s.mode);

  const layer = layout?.layers[selectedLayer];
  if (!layer) return null;

  const layerNames = layout!.layers.map((l) => l.title);

  return (
    <svg
      viewBox={VIEW_BOX}
      className="mx-auto block min-h-0 w-full max-w-5xl flex-1"
      role="group"
      aria-label={`Layer ${selectedLayer} keys`}
    >
      {GEOMETRY.keys.map((geo, i) => (
        <Key
          key={i}
          geo={geo}
          action={layer.keys[i]}
          selected={selectedKey === i}
          mode={mode}
          layerNames={layerNames}
          onSelect={() => selectKey(selectedKey === i ? null : i)}
        />
      ))}
    </svg>
  );
}
