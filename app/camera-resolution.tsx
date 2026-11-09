"use client";

export type VideoFrameRate = 30 | 60;
export function readCameraFrameRate(): VideoFrameRate {
  try {
    return typeof localStorage !== "undefined" &&
      localStorage.getItem("lc.cameraFrameRate") === "60"
      ? 60
      : 30;
  } catch {
    return 30;
  }
}
export function videoPublishEncoding(
  height: number,
  frameRate: VideoFrameRate,
) {
  const base =
    height <= 480
      ? 1_500_000
      : height <= 720
        ? 3_000_000
        : height <= 1080
          ? 6_000_000
          : height <= 1440
            ? 10_000_000
            : 16_000_000;
  return {
    maxBitrate: Math.round(base * (frameRate === 60 ? 1.5 : 1)),
    maxFramerate: frameRate,
  };
}
export function FrameRateSelection({
  value,
  onChange,
  label = "Frame rate",
}: {
  value: VideoFrameRate;
  onChange: (value: VideoFrameRate) => void;
  label?: string;
}) {
  return (
    <div className="deviceSelection">
      <label>
        {label}
        <select
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value === "60" ? 60 : 30)}
        >
          <option value="30">30 fps</option>
          <option value="60">60 fps — smoother motion</option>
        </select>
      </label>
    </div>
  );
}

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
  frameRate: VideoFrameRate = readCameraFrameRate(),
) {
  const quality = cameraResolutions[resolution];
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    width: { ideal: quality.width, max: quality.width },
    height: { ideal: quality.height, max: quality.height },
    frameRate: { ideal: frameRate, max: frameRate },
  };
}

export function CameraResolutionSelection({
  resolution,
  onChange,
  frameRate = 30,
  onFrameRateChange,
}: {
  resolution: CameraResolution;
  onChange: (resolution: CameraResolution) => void;
  frameRate?: VideoFrameRate;
  onFrameRateChange?: (value: VideoFrameRate) => void;
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
        Up to this resolution at {frameRate} fps, depending on your camera and
        connection.
      </small>
      {onFrameRateChange && (
        <FrameRateSelection
          value={frameRate}
          onChange={onFrameRateChange}
          label="Camera frame rate"
        />
      )}
    </div>
  );
}
