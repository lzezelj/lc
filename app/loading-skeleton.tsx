export function LoadingSkeleton({
  kind,
}: {
  kind: "channels" | "messages" | "sounds";
}) {
  return (
    <div
      className={`loadingSkeleton skeleton-${kind}`}
      role="status"
      aria-label={`Loading ${kind}`}
    >
      <span className="skeletonLabel">Loading {kind}…</span>
      {Array.from({ length: kind === "sounds" ? 6 : 5 }, (_, index) => (
        <div className="skeletonRow" key={index} aria-hidden="true">
          {kind === "messages" && (
            <span className="skeletonShape skeletonAvatar" />
          )}
          <span className="skeletonText">
            <span className="skeletonShape" />
            {kind === "messages" && <span className="skeletonShape" />}
          </span>
        </div>
      ))}
    </div>
  );
}
