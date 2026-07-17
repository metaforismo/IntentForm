interface BrandMarkProps {
  className?: string;
  size?: number;
}

export function BrandMark({ className = "", size = 24 }: BrandMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={`inline-grid shrink-0 place-items-center ${className}`}
      style={{ width: size, height: size }}
    >
      <img
        src="/brand/intentform-mark.png"
        alt=""
        width={size}
        height={size}
        draggable={false}
        className="size-full object-contain"
      />
    </span>
  );
}
