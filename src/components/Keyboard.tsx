import { GEOMETRY, viewBox } from "../lib/geometry";
import { hasOsSwitchKey } from "../lib/osSwap";
import { useDisplayStore } from "../state/displayStore";
import { useLayoutStore } from "../state/layoutStore";
import Key from "./Key";

const VIEW_BOX = viewBox();

export default function Keyboard() {
  const layout = useLayoutStore((s) => s.layout);
  const selectedLayer = useLayoutStore((s) => s.selectedLayer);
  const selectedKey = useLayoutStore((s) => s.selectedKey);
  const swapSource = useLayoutStore((s) => s.swapSource);
  const selectKey = useLayoutStore((s) => s.selectKey);
  const swapKeys = useLayoutStore((s) => s.swapKeys);
  const cancelSwap = useLayoutStore((s) => s.cancelSwap);
  const mode = useDisplayStore((s) => s.mode);
  const osSwapPreview = useDisplayStore((s) => s.osSwapPreview);

  const layer = layout?.layers[selectedLayer];
  if (!layer) return null;

  const layerNames = layout!.layers.map((l) => l.title);
  const swapping = swapSource !== null;
  // Only honour the preview if the board can actually reach the swapped
  // state — otherwise the keycaps would show behavior you can't produce.
  const osSwapped = osSwapPreview && hasOsSwitchKey(layout);

  // In swap mode a click picks the target (or cancels if it's the anchor);
  // otherwise it toggles the selection as usual.
  const onKey = (i: number) => {
    if (swapping) {
      if (i === swapSource) cancelSwap();
      else swapKeys(swapSource, i);
      return;
    }
    selectKey(selectedKey === i ? null : i);
  };

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
          swapSource={swapping && swapSource === i}
          swapTargeting={swapping && swapSource !== i}
          mode={mode}
          osSwapped={osSwapped}
          layerNames={layerNames}
          onSelect={() => onKey(i)}
        />
      ))}
    </svg>
  );
}
