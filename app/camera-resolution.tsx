"use client";

export const cameraResolutions = {
  "480": { width: 854, height: 480, frameRate: 30 },
  "720": { width: 1280, height: 720, frameRate: 30 },
  "1080": { width: 1920, height: 1080, frameRate: 30 },
  "1440": { width: 2560, height: 1440, frameRate: 30 },
  "2160": { width: 3840, height: 2160, frameRate: 30 },
};
export type CameraResolution = keyof typeof cameraResolutions;

export function readCameraResolution(): CameraResolution {
  const value =
    typeof localStorage === "undefined"
      ? null
      : localStorage.getItem("lc.cameraResolution");
  return value && value in cameraResolutions
    ? (value as CameraResolution)
    : "720";
}

export function cameraCaptureConstraints(
  deviceId: string,
  resolution: CameraResolution,
) {
  const quality = cameraResolutions[resolution];
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    width: { ideal: quality.width, max: quality.width },
    height: { ideal: quality.height, max: quality.height },
    frameRate: { ideal: 30, max: 30 },
  };
}

export function CameraResolutionSelection({
  resolution,
  onChange,
}: {
  resolution: CameraResolution;
  onChange: (resolution: CameraResolution) => void;
}) {
  return (
    <div className="deviceSelection">
      <label>
        Camera resolution
        <select
          value={resolution}
          onChange={(event) => onChange(event.target.value as CameraResolution)}
        >
          {Object.keys(cameraResolutions).map((value) => (
            <option key={value} value={value}>
              {value === "2160" ? "4K (2160p)" : `${value}p`}
            </option>
          ))}
        </select>
      </label>
      <small className="deviceSelectionNote">
        Up to this resolution at 30 fps, depending on your camera and
        connection.
      </small>
    </div>
  );
}
