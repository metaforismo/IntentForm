interface BrandMarkProps {
  className?: string;
  size?: number;
}

export function BrandMark({ className = "", size = 24 }: BrandMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center overflow-hidden rounded-[6px] bg-[#f5f6f8] shadow-[inset_0_0_0_1px_rgba(0,0,0,.08)] ${className}`}
      style={{ width: size, height: size }}
    >
      <img
        src="/brand/intentform-mark.png"
        alt=""
        width={size}
        height={size}
        draggable={false}
        className="size-full scale-[1.42] object-contain"
      />
    </span>
  );
}
