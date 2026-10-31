// The Royal Beacon mark (crowned lighthouse). Same artwork as the favicon in public/beacon.svg.
export default function Logo({ className = 'w-16 h-16' }) {
  return (
    <img src="/beacon.svg" alt="Royal Beacon" draggable={false}
      className={`${className} select-none drop-shadow-[0_8px_24px_rgba(34,197,94,0.35)]`} />
  );
}
