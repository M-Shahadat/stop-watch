interface Props {
  name: string;
  color: string;
  small?: boolean;
}

export default function CategoryBadge({ name, color, small }: Props) {
  return (
    <span
      className={small ? "category-badge category-badge--small" : "category-badge"}
      style={{ "--cat-color": color } as React.CSSProperties}
    >
      <span className="category-badge__dot" />
      {name}
    </span>
  );
}
