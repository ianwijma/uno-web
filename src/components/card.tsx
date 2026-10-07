import { Card, Color } from "@/lib/game/types";

const labels: Partial<Record<Card["value"], string>> = {
  skip: "Skip",
  reverse: "Reverse",
  draw2: "Draw Two",
  wild: "Wild",
  wild4: "Wild Draw Four",
};
export const cardLabel = (card: Card) =>
  `${card.color ?? ""} ${labels[card.value] ?? card.value}`.trim();
const symbols: Partial<Record<Card["value"], string>> = {
  skip: "⊘",
  reverse: "⇄",
  draw2: "+2",
  wild: "✦",
  wild4: "+4",
};
export function PlayingCard({
  card,
  onClick,
  disabled,
  small = false,
  highlighted = false,
}: {
  card: Card;
  onClick?: () => void;
  disabled?: boolean;
  small?: boolean;
  highlighted?: boolean;
}) {
  const value = symbols[card.value] ?? card.value;
  const className = `playing-card ${card.color ?? "wild"} ${small ? "small" : ""} ${highlighted ? "playable" : ""}`;
  const content = (
    <>
      <span className="card-corner">{value}</span>
      <span className="card-oval">
        <span>{value}</span>
      </span>
      <span className="card-corner bottom">{value}</span>
    </>
  );
  return onClick ? (
    <button
      className={className}
      aria-label={`Play ${cardLabel(card)}`}
      title={cardLabel(card)}
      onClick={onClick}
      disabled={disabled}
    >
      {content}
    </button>
  ) : (
    <div className={className} role="img" aria-label={cardLabel(card)}>
      {content}
    </div>
  );
}
export function CardBack({ small = false }: { small?: boolean }) {
  return (
    <div
      className={`playing-card card-back ${small ? "small" : ""}`}
      aria-hidden="true"
    >
      <span className="card-oval">
        <span>UNO</span>
      </span>
    </div>
  );
}
export function ColorPicker({
  onChoose,
}: {
  onChoose: (color: Color) => void;
}) {
  return (
    <div className="color-grid">
      {(["red", "yellow", "green", "blue"] as const).map((color) => (
        <button
          key={color}
          className={`color-choice ${color}`}
          onClick={() => onChoose(color)}
          aria-label={`Choose ${color}`}
        >
          {color}
        </button>
      ))}
    </div>
  );
}
