import { GEOMETRY, viewBox } from "../lib/geometry";
import { useLayoutStore } from "../state/layoutStore";
import Key from "./Key";

const VIEW_BOX = viewBox();

export default function Keyboard() {
  const layout = useLayoutStore((s) => s.layout);
  const selectedLayer = useLayoutStore((s) => s.selectedLayer);
  const selectedKey = useLayoutStore((s) => s.selectedKey);
  const selectKey = useLayoutStore((s) => s.selectKey);

  const layer = layout?.layers[selectedLayer];
  if (!layer) return null;

  return (
    <svg
      viewBox={VIEW_BOX}
      className="mx-auto block h-full w-full max-w-5xl"
      role="group"
      aria-label={`Layer ${selectedLayer} keys`}
    >
      {GEOMETRY.keys.map((geo, i) => (
        <Key
          key={i}
          geo={geo}
          action={layer.keys[i]}
          selected={selectedKey === i}
          onSelect={() => selectKey(selectedKey === i ? null : i)}
        />
      ))}
    </svg>
  );
}
